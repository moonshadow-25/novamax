"""
NovaMax 开发模式启动脚本
- 入口: backend/src/index.js
- Node: 优先用 external/node/node.exe，回退到系统 node
"""

import os
import sys
import time
import subprocess
import shutil
import ctypes
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
kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
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


def _apply_pending_update(root_dir):
    pending_file = os.path.join(root_dir, "data", "updates", "pending")
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

    direct_ok = True
    try:
        for name in os.listdir(source_root):
            if name.lower() == "data":
                continue
            src_path = os.path.join(source_root, name)
            dst_path = os.path.join(root_dir, name)

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

    python_exe = os.path.join(root_dir, "external", "python313", "python.exe")
    launcher = os.path.join(root_dir, "start_novamax_dev.py")
    update_bat = os.path.join(root_dir, "_update_dev.bat")

    with open(update_bat, "w", encoding="utf-8") as f:
        f.write(f'''@echo off
setlocal EnableDelayedExpansion
set "LOG={root_dir}\\data\\logs\\novamax_update.log"
if not exist "{root_dir}\\data\\logs" mkdir "{root_dir}\\data\\logs"
echo [NovaMax Updater Dev] Bootstrap started %date% %time% >"!LOG!"
echo Source: "{source_root}" >>"!LOG!"
echo Dest  : "{root_dir}" >>"!LOG!"
timeout /t 2 /nobreak >nul
robocopy "{source_root}" "{root_dir}" /E /XD "data" /NFL /NDL /NJH /NJS /R:3 /W:2 >>"!LOG!" 2>&1
set "RC=!errorlevel!"
echo robocopy exit code: !RC! >>"!LOG!"
if !RC! geq 8 (
    echo [NovaMax Updater Dev] Apply failed, keep pending for retry >>"!LOG!"
    del "%~f0" 2>nul
    exit /b 1
)
del "{pending_file}" 2>nul
rmdir /S /Q "{staging}" 2>nul
echo [NovaMax Updater Dev] Done. Restarting... >>"!LOG!"
start "" /B "{python_exe}" "{launcher}"
del "%~f0" 2>nul
''')

    subprocess.Popen(
        ['cmd.exe', '/c', update_bat],
        creationflags=CREATE_NO_WINDOW
    )
    return False


def _run_node_in_job(root_dir, node_exe, entry_js):
    proc = subprocess.Popen(
        [node_exe, entry_js],
        cwd=root_dir,
        env={**os.environ, "NODE_ENV": "development"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        bufsize=1,
        creationflags=CREATE_NO_WINDOW
    )

    # 实时读取并打印子进程输出
    def _forward_output():
        try:
            for line in proc.stdout:
                line = line.rstrip('\n\r')
                if line:
                    print(line, flush=True)
        except Exception:
            pass

    import threading
    reader = threading.Thread(target=_forward_output, daemon=True)
    reader.start()

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

        # 轮询子进程状态，允许 Ctrl+C 中断
        while True:
            try:
                ret = proc.poll()
                if ret is not None:
                    reader.join(timeout=2)
                    return ret
                time.sleep(0.5)
            except KeyboardInterrupt:
                print('\nStopping...')
                proc.terminate()
                try: proc.wait(timeout=5)
                except: proc.kill()
                return 0
    finally:
        kernel32.CloseHandle(process_handle)
        kernel32.CloseHandle(job)


def _find_node(root_dir):
    """优先使用 external/node/node.exe，回退到系统 PATH 中的 node"""
    bundled = os.path.join(root_dir, "external", "node", "node.exe")
    if os.path.exists(bundled):
        return bundled
    system_node = shutil.which("node") or shutil.which("node.exe")
    if system_node:
        return system_node
    return None


def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))

    node_exe = _find_node(root_dir)
    if not node_exe:
        print("Error: node.exe not found (checked external/node/node.exe and system PATH)")
        sys.exit(1)

    entry_js = os.path.join(root_dir, "backend", "src", "index.js")
    if not os.path.exists(entry_js):
        print(f"Error: backend entry not found at {entry_js}")
        sys.exit(1)

    print(f"Node:   {node_exe}")
    print(f"Entry:  {entry_js}")

    exit_code = 0
    while True:
        exit_code = _run_node_in_job(root_dir, node_exe, entry_js)
        if not _apply_pending_update(root_dir):
            break

    sys.exit(exit_code if isinstance(exit_code, int) else 0)


if __name__ == "__main__":
    main()
