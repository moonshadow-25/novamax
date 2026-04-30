"""
TTS 引擎安装脚本（自动分发器）
由 NovaMax 后端调用，引擎 ID 为 "tts"。

根据解压目录中的文件特征，自动选择对应的安装脚本：
  - pyproject.toml 存在  →  install_indextts2.py   (IndexTTS2，pip 安装并补齐关键运行时依赖)
  - requirements.txt 存在 →  install_indextts15.py  (IndexTTS1.5，pip)
  - ...后续新增版本只需新建 install_indextts*.py 并在此添加判断

新的原始参数会原样传递给目标脚本，无需修改目标脚本。
"""
import argparse
import os
import subprocess
import sys


def detect_target(install_root):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # 按优先级检测
    detectors = [
        ('pyproject.toml', 'install_indextts2.py'),
        ('requirements.txt', 'install_indextts15.py'),
    ]
    for marker, script_name in detectors:
        if os.path.exists(os.path.join(install_root, marker)):
            target = os.path.join(script_dir, script_name)
            if not os.path.exists(target):
                raise RuntimeError(
                    f"检测到 {marker}，但对应安装脚本未找到: {target}"
                )
            return target
    raise RuntimeError(
        f"无法识别 TTS 版本，install_root 中未找到已知标志文件: {install_root}"
    )


def main():
    # 仅解析 --install-root 用于检测，其余参数原样转发
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--install-root', required=True)
    args, _ = parser.parse_known_args()

    target = detect_target(args.install_root)
    print(f"[install_tts] 分发到: {os.path.basename(target)}")

    result = subprocess.run([sys.executable, target] + sys.argv[1:])
    sys.exit(result.returncode)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
