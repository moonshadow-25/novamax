"""
ComfyUI 安装脚本
由 NovaMax 后端调用，路径通过参数传入。
v2.0: 预打包运行环境，无需 venv / pip install。

参数：
  --install-root     ComfyUI 解压目录（external/comfyui/{version}/）
  --project-root     项目根目录
  --runtime-id       运行时 ID（如 rocm:rdna35 / cuda:cu130）
  --skip-runtime-download  跳过运行时下载（由 engineDownloader 处理）
"""

import argparse
import os
import json
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--runtime-id', default='')
    parser.add_argument('--skip-runtime-download', action='store_true', default=False)
    args = parser.parse_args()

    install_root = args.install_root

    print("========================================")
    print("ComfyUI Installation (v2.0 pre-packaged)")
    print("========================================")
    print(f"  Install Root: {install_root}")
    print(f"  Runtime ID:   {args.runtime_id or '(none)'}")
    print()

    if args.skip_runtime_download:
        print("  [OK] 运行环境由引擎下载器处理（已下载并解压）")
    else:
        print("  [OK] 运行环境已内置（预打包）")

    # 验证 ComfyUI 源码已解压（main.py 应存在）
    main_py = os.path.join(install_root, 'main.py')
    if os.path.isfile(main_py):
        print(f"  [OK] ComfyUI 入口: main.py")
    else:
        print("  [INFO] 未在根目录找到 main.py（可能在子目录中）")

    # 写入 .installed 标记
    marker_path = os.path.join(install_root, '.installed')
    marker_data = {
        'installed_at': datetime.now(timezone.utc).isoformat(),
        'engine': 'comfyui',
    }
    if args.runtime_id:
        marker_data['runtime_id'] = args.runtime_id
    version_dir = os.path.basename(install_root)
    marker_data['version'] = version_dir
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump(marker_data, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("ComfyUI installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}")
        import sys
        sys.exit(1)
