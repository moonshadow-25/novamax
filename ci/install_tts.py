"""
IndexTTS 安装脚本（通用）
由 NovaMax 后端调用，路径通过参数传入。
支持热更新：可从服务器独立下发，无需重新发布 Node 服务。

参数：
  --install-root   IndexTTS 解压目录
  --rocm-path      ROCm 环境目录（含 python.exe），由 JS 查找后传入
  --project-root   项目根目录
"""

import argparse
import subprocess
import sys
import os
import json
import tempfile
from datetime import datetime, timezone


TORCH_STACK_PACKAGES = ['torch', 'torchvision', 'torchaudio']


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


def build_filtered_requirements(src_path):
    filtered_lines = []
    skip_prefixes = ('torch==', 'torchvision==', 'torchaudio==', 'deepspeed==')
    with open(src_path, 'r', encoding='utf-8') as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                filtered_lines.append(line)
                continue
            if stripped.startswith(skip_prefixes):
                continue
            filtered_lines.append(line)

    tmp = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', suffix='.txt', delete=False)
    tmp.writelines(filtered_lines)
    tmp.flush()
    tmp.close()
    return tmp.name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', required=True)
    parser.add_argument('--project-root', required=True)
    args = parser.parse_args()

    install_root = args.install_root
    project_root = args.project_root
    rocm_python = os.path.join(args.rocm_path, 'python.exe')

    venv_path = os.path.join(install_root, 'venv')
    venv_python = os.path.join(venv_path, 'Scripts', 'python.exe')

    print("========================================")
    print("IndexTTS Installation")
    print("========================================")
    print(f"  Install Root:  {install_root}")
    print(f"  ROCm Python:   {rocm_python}")
    print()

    # [1/4] 检查 ROCm
    print("[1/4] Checking ROCm environment...")
    if not os.path.exists(rocm_python):
        raise RuntimeError(f"ROCm Python not found: {rocm_python}")
    print(f"  [OK] {rocm_python}")

    # [2/4] 创建 venv（复用 ROCm 环境包）
    print("[2/4] Creating virtual environment...")
    if os.path.exists(venv_python):
        print("  [SKIP] venv already exists")
    else:
        run([rocm_python, '-m', 'venv', venv_path, '--system-site-packages'])
        print("  [OK] venv created")

    # [3/4] 安装依赖
    print("[3/4] Installing dependencies...")
    requirements = os.path.join(install_root, 'requirements.txt')

    if not os.path.exists(requirements):
        raise RuntimeError(f"requirements.txt 未找到: {requirements}")

    filtered_requirements = build_filtered_requirements(requirements)
    result = run([venv_python, '-m', 'pip', 'install', '--no-cache-dir', '-r', filtered_requirements], cwd=install_root, check=False)
    if result.returncode != 0:
        raise RuntimeError('pip install 失败（已过滤 torch 系依赖），请检查上方日志')

    run([venv_python, '-m', 'pip', 'uninstall', '-y', *TORCH_STACK_PACKAGES], check=False)

    try:
        os.remove(filtered_requirements)
    except OSError:
        pass

    print("  [OK] Dependencies installed, ROCm torch preserved")

    # [4/4] 验证安装
    print("[4/4] Verifying installation...")

    if not os.path.exists(venv_python):
        raise RuntimeError(f"虚拟环境 Python 未找到于: {venv_python}")
    print(f"  [OK] Python: {venv_python}")

    start_py = os.path.join(install_root, 'start.py')
    if not os.path.exists(start_py):
        raise RuntimeError(f"start.py 未找到: {start_py}")
    print(f"  [OK] start.py: {start_py}")

    # 验证核心模块可导入与设备可见性
    verify_code = """
import torch
import fastapi
import uvicorn
print('torch_version', torch.__version__)
print('fastapi_version', fastapi.__version__)
print('uvicorn_version', uvicorn.__version__)
print('cuda_available', torch.cuda.is_available())
print('cuda_version', torch.version.cuda)
print('device_count', torch.cuda.device_count())
if torch.cuda.is_available() and torch.cuda.device_count() > 0:
    print('device0', torch.cuda.get_device_name(0))
"""
    result = run([venv_python, '-c', verify_code], check=False)
    if result.returncode != 0:
        print("  [WARN] 验证未通过（安装已完成，可能需要手动检查依赖）")
    else:
        print("  [OK] 核心模块与设备检测校验通过")

    marker_path = os.path.join(install_root, '.installed')
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump({'installed_at': datetime.now(timezone.utc).isoformat(), 'engine': 'indextts'}, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("IndexTTS installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
