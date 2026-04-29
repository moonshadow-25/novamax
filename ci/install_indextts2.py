"""
IndexTTS2 安装脚本
由 NovaMax 后端调用，路径通过参数传入。
支持热更新：可从服务器独立下发，无需重新发布 Node 服务。

参数：
  --install-root   IndexTTS2 解压目录（external/indextts2/{version}/）
  --rocm-path      （未使用，保持接口统一）
  --project-root   项目根目录

依赖：使用项目内置的 external/uv/uv.exe 管理 Python 虚拟环境
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


def _get_uv_exe(project_root):
    uv_path = os.path.join(project_root, 'external', 'uv', 'uv.exe')
    if os.path.exists(uv_path):
        return uv_path
    # Linux/macOS fallback
    uv_path_unix = os.path.join(project_root, 'external', 'uv', 'uv')
    if os.path.exists(uv_path_unix):
        return uv_path_unix
    raise RuntimeError(
        f"uv 可执行文件未找到，请确认 external/uv/ 目录已部署。\n"
        f"检查路径: {os.path.join(project_root, 'external', 'uv')}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', default='')
    parser.add_argument('--project-root', required=True)
    args = parser.parse_args()

    install_root = args.install_root
    project_root = args.project_root
    uv_exe = _get_uv_exe(project_root)

    pyproject = os.path.join(install_root, 'pyproject.toml')
    if not os.path.exists(pyproject):
        raise RuntimeError(f"pyproject.toml 未找到，请确认解压目录正确: {install_root}")

    venv_path = os.path.join(install_root, '.venv')

    print("========================================")
    print("IndexTTS2 Installation")
    print("========================================")
    print(f"  Install Root:  {install_root}")
    print(f"  uv:            {uv_exe}")
    print()

    uv_env = os.environ.copy()
    uv_env.pop('PYTHONHOME', None)
    uv_env.pop('PYTHONPATH', None)
    # 让 uv 将 venv 创建在 install_root/.venv
    uv_env['UV_PROJECT_ENVIRONMENT'] = venv_path
    # uv 托管 Python 缓存目录放在项目内，避免写入用户目录
    uv_env['UV_PYTHON_INSTALL_DIR'] = os.path.join(project_root, 'external', 'uv-python')

    # [1/3] 创建虚拟环境
    print("[1/3] Creating virtual environment...")
    run([uv_exe, 'venv', '--python', '3.10', venv_path], cwd=install_root, env=uv_env)
    print("  [OK] .venv created")

    # [2/3] 安装依赖（使用 uv sync，依据 uv.lock 锁定版本，含 webui extra）
    print("[2/3] Installing dependencies via uv sync...")
    run(
        [uv_exe, 'sync', '--extra', 'webui', '--no-dev', '--frozen'],
        cwd=install_root,
        env=uv_env
    )
    print("  [OK] Dependencies installed")

    # [3/3] 验证安装
    print("[3/3] Verifying installation...")

    venv_python_win = os.path.join(venv_path, 'Scripts', 'python.exe')
    venv_python_unix = os.path.join(venv_path, 'bin', 'python')
    if os.path.exists(venv_python_win):
        venv_python = venv_python_win
    elif os.path.exists(venv_python_unix):
        venv_python = venv_python_unix
    else:
        raise RuntimeError(f"虚拟环境 Python 未找到于: {venv_path}")
    print(f"  [OK] Python: {venv_python}")

    api_main = os.path.join(install_root, 'api', 'main.py')
    if not os.path.exists(api_main):
        raise RuntimeError(f"api/main.py 未找到: {api_main}")
    print(f"  [OK] api/main.py: {api_main}")

    # 验证核心模块可导入
    run([venv_python, '-c', 'import uvicorn; import torch'], check=True)
    print("  [OK] 核心模块 (uvicorn, torch) 导入校验通过")

    marker_path = os.path.join(install_root, '.installed')
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump({'installed_at': datetime.now(timezone.utc).isoformat(), 'engine': 'indextts2'}, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("IndexTTS2 installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
