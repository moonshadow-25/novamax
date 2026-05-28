"""
IndexTTS 安装脚本（通用）
由 NovaMax 后端调用，路径通过参数传入。
支持热更新：可从服务器独立下发，无需重新发布 Node 服务。

参数：
  --install-root     IndexTTS 解压目录
  --project-root     项目根目录（python313 路径由此推导：external/python313）

流程：
  1. 从 install-root 路径判断变体（tts2 / tts1.5）
  2. 从 ModelScope (shoujiekeji/Novastudio3.0) 下载对应运行环境 zip
  3. 解压到 install-root，删除压缩包
  4. 写入 .installed 标记
"""

import argparse
import subprocess
import sys
import os
import json
import zipfile
from datetime import datetime, timezone


def run(cmd, cwd=None, check=True, env=None, stream=False):
    print(f"  > {' '.join(str(c) for c in cmd)}")
    if stream:
        import threading
        proc = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', errors='replace'
        )
        def _pipe(src, dest):
            for line in src:
                line = line.rstrip('\n')
                if line:
                    print(line, file=dest, flush=True)
        t1 = threading.Thread(target=_pipe, args=(proc.stdout, sys.stdout))
        t2 = threading.Thread(target=_pipe, args=(proc.stderr, sys.stderr))
        t1.start(); t2.start()
        t1.join(); t2.join()
        proc.wait()
        if check and proc.returncode != 0:
            raise RuntimeError(f"命令失败，退出码: {proc.returncode}")
        return proc
    else:
        result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.stderr.strip():
            print(result.stderr.strip())
        if check and result.returncode != 0:
            raise RuntimeError(f"命令失败，退出码: {result.returncode}")
        return result


def detect_variant(install_root):
    """从 install_root 路径判断 TTS 变体（tts2 或 tts15）"""
    normalized = install_root.replace('\\', '/').lower()
    # 先匹配 tts2，避免 tts1.5 中的子串误匹配
    if 'index-tts2' in normalized or 'index_tts2' in normalized or 'indextts2' in normalized:
        return 'tts2'
    if 'index-tts1' in normalized or 'index_tts1' in normalized or 'indextts1' in normalized or 'tts1.5' in normalized:
        return 'tts15'
    raise RuntimeError(f"无法从路径判断 TTS 变体（tts2/tts1.5）：{install_root}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', default='')
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--runtime-id', default='')
    args = parser.parse_args()

    install_root = args.install_root
    project_root = args.project_root
    python313 = os.path.join(project_root, 'external', 'python313', 'python.exe')

    print("========================================")
    print("IndexTTS Installation")
    print("========================================")
    print(f"  Install Root:    {install_root}")
    print(f"  Python 3.13:     {python313}")
    print()

    # [1/4] 检查 Python 3.13
    print("[1/4] Checking Python 3.13 environment...")
    if not os.path.exists(python313):
        raise RuntimeError(f"Python 3.13 not found: {python313}")
    print(f"  [OK] {python313}")

    # [2/4] 检测变体，确定运行环境包
    print("[2/4] Detecting engine variant...")
    variant = detect_variant(install_root)
    MODELSCOPE_REPO = 'shoujiekeji/Novastudio3.0'
    if variant == 'tts2':
        variant_id = 'indextts2'
        variant_name = 'IndexTTS 2.0'
        default_engine_file = 'tts/engines/index_tts2_engine.zip'
    else:
        variant_id = 'indextts15'
        variant_name = 'IndexTTS 1.5'
        default_engine_file = 'tts/engines/index_tts1.5_engine.zip'

    # 若指定了 --runtime-id，从 engines.json 中查找对应的 modelscope_file
    engine_file = default_engine_file
    runtime_name = ''
    if args.runtime_id:
        engines_json_path = os.path.join(project_root, 'data', 'engines.json')
        if os.path.exists(engines_json_path):
            with open(engines_json_path, 'r', encoding='utf-8') as f:
                engines_data = json.load(f)
            tts_engine = engines_data.get('engines', {}).get('tts', {})
            for v in tts_engine.get('variants', []):
                if v.get('id') == variant_id:
                    for rt in v.get('runtimes', []):
                        if rt.get('id') == args.runtime_id:
                            engine_file = rt.get('modelscope_file', engine_file)
                            runtime_name = rt.get('name', args.runtime_id)
                            print(f"  [OK] Runtime selected: {runtime_name}")
                            break
                    break
            if not runtime_name:
                print(f"  [WARN] Runtime '{args.runtime_id}' not found, using default")
        else:
            print(f"  [WARN] engines.json not found, using default runtime")

    zip_filename = os.path.basename(engine_file)
    zip_path = os.path.join(install_root, zip_filename)
    print(f"  [OK] Variant: {variant_name}")
    print(f"  [OK] Engine package: {engine_file}")

    # [3/4] 从 ModelScope 下载运行环境
    print("[3/4] Downloading runtime environment from ModelScope...")
    # 兼容开发环境（src/services/）和打包后生产环境（dist/scripts/）
    downloader_candidates = [
        os.path.join(project_root, 'backend', 'dist', 'scripts', 'modelscope_downloader.py'),
        os.path.join(project_root, 'backend', 'src', 'services', 'modelscope_downloader.py'),
    ]
    downloader_script = next((p for p in downloader_candidates if os.path.exists(p)), None)
    if not downloader_script:
        raise RuntimeError(f"ModelScope 下载脚本未找到，已查找路径：{downloader_candidates}")

    result = run(
        [python313, downloader_script, MODELSCOPE_REPO, '--output', install_root, '--files', engine_file],
        cwd=project_root,
        check=False,
        stream=True,
        env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}
    )
    if result.returncode != 0:
        raise RuntimeError('ModelScope 下载失败，请检查上方日志')
    if not os.path.exists(zip_path) or os.path.getsize(zip_path) == 0:
        raise RuntimeError(f"下载后未找到文件或文件为空: {zip_path}")
    print(f"  [OK] Downloaded: {zip_path}")

    # [4/4] 解压并清理
    print("[4/4] Extracting runtime environment...")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(install_root)
    print(f"  [OK] Extracted to: {install_root}")

    os.remove(zip_path)
    print(f"  [OK] Removed archive: {zip_filename}")

    marker_path = os.path.join(install_root, '.installed')
    marker_data = {
        'installed_at': datetime.now(timezone.utc).isoformat(),
        'engine': f'indextts_{variant}'
    }
    if args.runtime_id:
        marker_data['runtime_id'] = args.runtime_id
        marker_data['runtime_name'] = runtime_name
    with open(marker_path, 'w', encoding='utf-8') as f:
        json.dump(marker_data, f)
    print("  [OK] .installed marker written")

    print()
    print("========================================")
    print(f"{variant_name} installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
