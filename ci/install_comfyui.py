"""
ComfyUI 安装脚本
由 NovaMax 后端调用，路径通过参数传入。
支持热更新：可从服务器独立下发，无需重新发布 Node 服务。

参数：
  --install-root   ComfyUI 解压目录（external/comfyui/{version}/）
  --rocm-path      ROCm 环境目录（含 python.exe），由 JS 查找后传入
  --project-root   项目根目录
"""

import argparse
import subprocess
import sys
import os
import json
from datetime import datetime, timezone


def run(cmd, cwd=None, check=True):
    print(f"  > {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())
    if check and result.returncode != 0:
        raise RuntimeError(f"命令失败，退出码: {result.returncode}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', required=True)
    parser.add_argument('--project-root', required=True)
    args = parser.parse_args()

    install_root = args.install_root
    rocm_python = os.path.join(args.rocm_path, 'python.exe')
    venv_path = os.path.join(install_root, 'venv')
    venv_python = os.path.join(venv_path, 'Scripts', 'python.exe')
    requirements = os.path.join(install_root, 'requirements.txt')
    print("========================================")
    print("ComfyUI Installation")
    print("========================================")
    print(f"  Install Root:  {install_root}")
    print(f"  ROCm Python:   {rocm_python}")
    print()

    # [1/3] 检查 ROCm
    print("[1/3] Checking ROCm environment...")
    if not os.path.exists(rocm_python):
        raise RuntimeError(f"ROCm Python not found: {rocm_python}")
    print(f"  [OK] {rocm_python}")

    # [2/3] 创建 venv
    print("[2/3] Creating virtual environment...")
    if os.path.exists(venv_python):
        print("  [SKIP] venv already exists")
    else:
        run([rocm_python, '-m', 'venv', venv_path, '--system-site-packages'])
        print("  [OK] venv created")

    # [3/3] 安装依赖
    print("[3/3] Installing dependencies...")
    if os.path.exists(requirements):
        run([venv_python, '-m', 'pip', 'install', '--no-cache-dir', '-r', requirements])
        run([venv_python, '-m', 'pip', 'uninstall', '-y', 'torch', 'torchvision', 'torchaudio'], check=False)
        print("  [OK] Dependencies installed, ROCm torch preserved")
    else:
        print("  [SKIP] requirements.txt not found")

    # 写入安装标记
    marker_path = os.path.join(install_root, '.installed')
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump({'installed_at': datetime.now(timezone.utc).isoformat(), 'engine': 'comfyui'}, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("ComfyUI installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
