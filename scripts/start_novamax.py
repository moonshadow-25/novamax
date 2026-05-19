import os
import sys
import shutil
import ctypes
import subprocess
from ctypes import wintypes

CREATE_NO_WINDOW = 0x08000000
PROCESS_SET_QUOTA = 0x0100
PROCESS_TERMINATE = 0x0001
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_ALL_NEEDED = PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION

JobObjectExtendedLimitInformation = 9
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000

kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('PerProcessUserTimeLimit', ctypes.c_longlong),
        ('PerJobUserTimeLimit', ctypes.c_longlong),
        ('LimitFlags', wintypes.DWORD),
        ('MinimumWorkingSetSize', ctypes.c_size_t),
        ('MaximumWorkingSetSize', ctypes.c_size_t),
        ('ActiveProcessLimit', wintypes.DWORD),
        ('Affinity', ctypes.c_size_t),
        ('PriorityClass', wintypes.DWORD),
        ('SchedulingClass', wintypes.DWORD),
    ]

class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ('ReadOperationCount', ctypes.c_ulonglong),
        ('WriteOperationCount', ctypes.c_ulonglong),
        ('OtherOperationCount', ctypes.c_ulonglong),
        ('ReadTransferCount', ctypes.c_ulonglong),
        ('WriteTransferCount', ctypes.c_ulonglong),
        ('OtherTransferCount', ctypes.c_ulonglong),
    ]

class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('BasicLimitInformation', JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ('IoInfo', IO_COUNTERS),
        ('ProcessMemoryLimit', ctypes.c_size_t),
        ('JobMemoryLimit', ctypes.c_size_t),
        ('PeakProcessMemoryUsed', ctypes.c_size_t),
        ('PeakJobMemoryUsed', ctypes.c_size_t),
    ]

kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
kernel32.CreateJobObjectW.restype = wintypes.HANDLE

kernel32.SetInformationJobObject.argtypes = [
    wintypes.HANDLE,
    ctypes.c_int,
    wintypes.LPVOID,
    wintypes.DWORD,
]
kernel32.SetInformationJobObject.restype = wintypes.BOOL

kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel32.AssignProcessToJobObject.restype = wintypes.BOOL

kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE

kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL


def _raise_last_error(prefix):
    err = ctypes.get_last_error()
    raise OSError(f"{prefix} failed, winerr={err}")


def _resolve_update_source(staging):
    expected_backend = os.path.join(staging, "backend", "dist", "index.js")
    expected_node = os.path.join(staging, "external", "node", "node.exe")
    if os.path.exists(expected_backend) and os.path.exists(expected_node):
        return staging

    for name in os.listdir(staging):
        child = os.path.join(staging, name)
        if not os.path.isdir(child):
            continue
        backend = os.path.join(child, "backend", "dist", "index.js")
        node = os.path.join(child, "external", "node", "node.exe")
        if os.path.exists(backend) and os.path.exists(node):
            return child

    return staging


def _apply_pending_update(script_dir):
    pending_file = os.path.join(script_dir, "data", "updates", "pending")
    if not os.path.exists(pending_file):
        return False

    print("[NovaMax Updater] Applying update...")
    with open(pending_file, "r", encoding="utf-8") as f:
        staging = f.read().strip()

    if not staging or not os.path.isdir(staging):
        print(f"[NovaMax Updater] Invalid staging path: {staging}")
        try:
            os.remove(pending_file)
        except Exception:
            pass
        return False

    source_root = _resolve_update_source(staging)

    # 尝试直接复制（node.exe 已退出时的正常路径）
    direct_ok = True
    try:
        for name in os.listdir(source_root):
            if name.lower() == "data":
                continue
            src_path = os.path.join(source_root, name)
            dst_path = os.path.join(script_dir, name)

            if os.path.isdir(src_path):
                shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
            else:
                os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                shutil.copy2(src_path, dst_path)
    except Exception as e:
        direct_ok = False
        print(f"[NovaMax Updater] Direct copy partially failed (files in use), delegating to bootstrap script...")

    if direct_ok:
        try:
            os.remove(pending_file)
        except Exception:
            pass
        try:
            shutil.rmtree(staging, ignore_errors=True)
        except Exception:
            pass
        print("[NovaMax Updater] Done. Restarting...")
        return True

    # 当前 Python 进程占用了 external\python313 下的文件，
    # 无法直接覆盖自身。委托给 bat 引导脚本：退出 → bat 复制 → 重启
    python_exe = os.path.join(script_dir, "external", "python313", "python.exe")
    launcher = os.path.join(script_dir, "start_novamax.py")
    update_bat = os.path.join(script_dir, "_update.bat")

    with open(update_bat, "w", encoding="utf-8") as f:
        f.write(f'''@echo off
setlocal EnableDelayedExpansion
set "LOG={script_dir}\\data\\logs\\novamax_update.log"
if not exist "{script_dir}\\data\\logs" mkdir "{script_dir}\\data\\logs"
echo [NovaMax Updater] Bootstrap started %date% %time% >"!LOG!"
echo Source: "{source_root}" >>"!LOG!"
echo Dest  : "{script_dir}" >>"!LOG!"
rem 等待 Python 进程完全退出，释放 python313 文件锁
timeout /t 2 /nobreak >nul
robocopy "{source_root}" "{script_dir}" /E /XD "data" /NFL /NDL /NJH /NJS /R:3 /W:2 >>"!LOG!" 2>&1
set "RC=!errorlevel!"
echo robocopy exit code: !RC! >>"!LOG!"
if !RC! geq 8 (
    echo [NovaMax Updater] Apply failed, keep pending for retry >>"!LOG!"
    del "%~f0" 2>nul
    exit /b 1
)
del "{pending_file}" 2>nul
rmdir /S /Q "{staging}" 2>nul
echo [NovaMax Updater] Done. Restarting... >>"!LOG!"
start "" /B "{python_exe}" "{launcher}"
del "%~f0" 2>nul
''')

    # 由 cmd.exe 拉起 bat，当前 Python 进程立即退出
    subprocess.Popen(
        ['cmd.exe', '/c', update_bat],
        creationflags=CREATE_NO_WINDOW
    )

    # 返回 False 停止 main() 循环，bat 脚本负责重启
    return False


def _run_node_in_job(script_dir, node_exe, entry_js):
    proc = subprocess.Popen(
        [node_exe, entry_js],
        cwd=script_dir,
        env={**os.environ, "NODE_ENV": "production"},
        creationflags=CREATE_NO_WINDOW
    )

    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        try:
            proc.kill()
        except Exception:
            pass
        _raise_last_error('CreateJobObjectW')

    process_handle = kernel32.OpenProcess(PROCESS_ALL_NEEDED, False, proc.pid)
    if not process_handle:
        try:
            proc.kill()
        except Exception:
            pass
        kernel32.CloseHandle(job)
        _raise_last_error('OpenProcess')

    try:
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

        ok = kernel32.SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            _raise_last_error('SetInformationJobObject')

        ok = kernel32.AssignProcessToJobObject(job, process_handle)
        if not ok:
            _raise_last_error('AssignProcessToJobObject')

        return proc.wait()
    finally:
        kernel32.CloseHandle(process_handle)
        kernel32.CloseHandle(job)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    node_exe = os.path.join(script_dir, "external", "node", "node.exe")
    entry_js = os.path.join(script_dir, "backend", "dist", "index.js")

    if not os.path.exists(node_exe):
        print(f"Error: node.exe not found at {node_exe}")
        sys.exit(1)

    if not os.path.exists(entry_js):
        print(f"Error: backend entry not found at {entry_js}")
        sys.exit(1)

    exit_code = 0
    while True:
        exit_code = _run_node_in_job(script_dir, node_exe, entry_js)
        if not _apply_pending_update(script_dir):
            break

    sys.exit(exit_code if isinstance(exit_code, int) else 0)


if __name__ == "__main__":
    main()
