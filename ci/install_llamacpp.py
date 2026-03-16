"""
llama.cpp 安装脚本
解压即可用，验证关键文件存在后写入 .installed 标记。

参数：
  --install-root   llama.cpp 解压目录（external/llamacpp/{version}/）
  --rocm-path      （未使用，保持接口统一）
  --project-root   项目根目录
"""

import argparse
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
    server_exe = os.path.join(install_root, 'llama-server.exe')

    print("========================================")
    print("llama.cpp Installation")
    print("========================================")
    print(f"  Install Root: {install_root}")
    print()

    # [1/1] 验证关键文件
    print("[1/1] Verifying installation...")
    if not os.path.exists(server_exe):
        raise RuntimeError(f"llama-server.exe not found: {server_exe}")
    print(f"  [OK] {server_exe}")

    # 写入安装标记
    marker_path = os.path.join(install_root, '.installed')
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump({'installed_at': datetime.now(timezone.utc).isoformat(), 'engine': 'llamacpp'}, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("llama.cpp installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
