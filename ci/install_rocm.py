"""
ROCm 安装脚本
解压后运行 conda-unpack 修复路径，写入 .installed 标记。

参数：
  --install-root   ROCm 解压目录（external/rocm/{version}/）
  --rocm-path      （未使用，保持接口统一）
  --project-root   项目根目录
"""

import argparse
import subprocess
import sys
import os
import json
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', default='')
    parser.add_argument('--project-root', required=True)
    args = parser.parse_args()

    install_root = args.install_root
    conda_unpack = os.path.join(install_root, 'Scripts', 'conda-unpack.exe')

    print("========================================")
    print("ROCm Installation")
    print("========================================")
    print(f"  Install Root: {install_root}")
    print()

    # [1/2] conda-unpack 修复路径
    print("[1/2] Running conda-unpack...")
    if not os.path.exists(conda_unpack):
        print("  [SKIP] conda-unpack.exe not found, skipping")
    else:
        result = subprocess.run(
            [conda_unpack],
            cwd=install_root,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.stderr.strip():
            print(result.stderr.strip())
        if result.returncode != 0:
            raise RuntimeError(f"conda-unpack failed with code {result.returncode}")
        print("  [OK] conda-unpack completed")

    # [2/2] 验证 python.exe 存在
    print("[2/2] Verifying installation...")
    python_exe = os.path.join(install_root, 'python.exe')
    if not os.path.exists(python_exe):
        raise RuntimeError(f"python.exe not found after installation: {python_exe}")
    print(f"  [OK] {python_exe}")

    # 写入安装标记
    marker_path = os.path.join(install_root, '.installed')
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump({'installed_at': datetime.now(timezone.utc).isoformat(), 'engine': 'rocm'}, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("ROCm installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
