"""
Whisper 引擎安装脚本
由 NovaMax 后端调用，路径通过参数传入。
支持热更新：可从服务器独立下发，无需重新发布 Node 服务。

参数：
  --install-root   Whisper 解压目录（external/whisper/{version}/）
  --rocm-path      （未使用，保持接口统一）
  --project-root   项目根目录
"""

import argparse
import subprocess
import sys
import os
import json
from datetime import datetime, timezone


def run(cmd, cwd=None, check=True, env=None):
    print(f"  > {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())
    if check and result.returncode != 0:
        raise RuntimeError(f"命令失败，退出码: {result.returncode}")
    return result


def _find_whisper_server(install_root):
    candidates = [
        os.path.join(install_root, 'whisper-server.exe'),
        os.path.join(install_root, 'whisper-server'),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _get_bundled_python(project_root):
    return os.path.join(project_root, 'external', 'python313', 'python.exe')


def _check_venv_available(python_exe):
    result = subprocess.run(
        [python_exe, '-c', 'import venv'],
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace'
    )
    return result.returncode == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', default='')
    parser.add_argument('--project-root', required=True)
    args = parser.parse_args()

    install_root = args.install_root
    python_exe = _get_bundled_python(args.project_root)
    if not os.path.exists(python_exe):
        raise RuntimeError(f"Bundled python not found: {python_exe}")

    if not _check_venv_available(python_exe):
        raise RuntimeError(
            f"Bundled python 缺少 venv 模块，无法创建隔离环境: {python_exe}\n"
            "请为 external/python313 提供完整 venv 模块后重试。"
        )

    venv_path = os.path.join(install_root, 'venv')
    venv_python = os.path.join(venv_path, 'Scripts', 'python.exe')
    requirements = os.path.join(install_root, 'requirements.txt')

    print("========================================")
    print("Whisper Installation")
    print("========================================")
    print(f"  Install Root:  {install_root}")
    print(f"  Python:        {python_exe}")
    print()

    # [1/3] 创建 venv（标准库 venv，不使用 virtualenv）
    print("[1/3] Creating virtual environment...")
    run([python_exe, '-m', 'venv', '--clear', venv_path])
    print("  [OK] venv created")

    # 校验 venv 中 ctypes 可用，避免后续 pip 或运行时随机失败
    run([venv_python, '-c', 'import ctypes'])
    print("  [OK] ctypes import check passed")

    pip_env = os.environ.copy()
    pip_env.pop('PYTHONHOME', None)
    pip_env.pop('PYTHONPATH', None)

    # [2/3] 安装依赖（安装到 venv，不污染 external/python313）
    print("[2/3] Installing dependencies...")
    if os.path.exists(requirements):
        run([venv_python, '-m', 'pip', 'install', '--no-cache-dir', '-r', requirements], env=pip_env)
        print("  [OK] Dependencies installed into whisper venv")
    else:
        print("  [SKIP] requirements.txt not found")

    # [3/3] 验证关键文件
    print("[3/3] Verifying installation...")
    server_bin = _find_whisper_server(install_root)
    if not server_bin:
        raise RuntimeError(f"whisper-server not found in: {install_root}")
    print(f"  [OK] {server_bin}")

    vad_model = os.path.join(install_root, 'ggml-silero-v6.2.0.bin')
    if os.path.exists(vad_model):
        print(f"  [OK] Optional VAD model found: {vad_model}")
    else:
        print("  [SKIP] Optional VAD model not found")

    marker_path = os.path.join(install_root, '.installed')
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump({'installed_at': datetime.now(timezone.utc).isoformat(), 'engine': 'whisper'}, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("Whisper installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
