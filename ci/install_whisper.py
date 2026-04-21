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


def _python_has_module(python_exe, module_name):
    try:
        result = subprocess.run(
            [python_exe, '-c', f'import {module_name}'],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        return result.returncode == 0
    except Exception:
        return False


def _detect_venv_backend(python_exe):
    if _python_has_module(python_exe, 'venv'):
        return 'venv'
    if _python_has_module(python_exe, 'virtualenv'):
        return 'virtualenv'
    return None


def _get_bundled_python(project_root):
    return os.path.join(project_root, 'external', 'python313', 'python.exe')


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

    venv_backend = _detect_venv_backend(python_exe)
    if not venv_backend:
        raise RuntimeError(
            f"Bundled python missing both venv and virtualenv: {python_exe}\n"
            "Please install venv (stdlib) or virtualenv for external/python313 first."
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

    # [1/3] 创建 venv
    print("[1/3] Creating virtual environment...")
    print(f"  Using backend: {venv_backend}")
    if os.path.exists(venv_path):
        print("  [INFO] Existing venv detected, recreating...")

    if venv_backend == 'venv':
        run([python_exe, '-m', 'venv', '--clear', venv_path])
    else:
        clean_env = os.environ.copy()
        clean_env.pop('PYTHONHOME', None)
        clean_env.pop('PYTHONPATH', None)
        clean_env['VIRTUALENV_CONFIG_FILE'] = os.devnull
        run([python_exe, '-m', 'virtualenv', '--clear', '--reset-app-data', '--activators', 'batch,powershell', venv_path], env=clean_env)
    print("  [OK] venv created")

    pip_env = os.environ.copy()
    pip_env.pop('PYTHONHOME', None)
    pip_env.pop('PYTHONPATH', None)

    # [2/3] 安装依赖
    print("[2/3] Installing dependencies...")
    if os.path.exists(requirements):
        bundled_python_dir = os.path.dirname(python_exe)
        pip_env['PATH'] = f"{bundled_python_dir}{os.pathsep}{pip_env.get('PATH', '')}"

        # 只安装到 Whisper 自己的 venv site-packages，避免污染 external/python313
        venv_site_packages = os.path.join(venv_path, 'Lib', 'site-packages')
        run([
            python_exe, '-m', 'pip', 'install', '--no-cache-dir',
            '--target', venv_site_packages,
            '-r', requirements
        ], env=pip_env)
        print(f"  [OK] Dependencies installed to {venv_site_packages}")
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
