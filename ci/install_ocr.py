"""
OCR 引擎安装脚本（通用）
由 NovaMax 后端调用，路径通过参数传入。
支持热更新：可从服务器独立下发，无需重新发布 Node 服务。

参数：
  --install-root     OCR 解压目录（external/ocr/{variant}/{version}/）
  --rocm-path        （未使用，保持接口统一）
  --project-root     项目根目录
  --runtime-id       运行时 ID，对应 engines.json 中 runtimes[].id
  --skip-runtime-download  跳过运行时下载（由 engineDownloader 处理）
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
    """从 install_root 路径判断 OCR 变体"""
    normalized = install_root.replace('\\', '/').lower()
    if 'mineru' in normalized:
        return 'mineru', 'MinerU'
    raise RuntimeError(f"无法从路径判断 OCR 变体：{install_root}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', required=True)
    parser.add_argument('--rocm-path', default='')
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--runtime-id', default='')
    parser.add_argument('--skip-runtime-download', action='store_true', default=False)
    args = parser.parse_args()

    install_root = args.install_root
    project_root = args.project_root

    print("========================================")
    print("OCR Engine Installation")
    print("========================================")
    print(f"  Install Root:    {install_root}")
    print()

    # [1/4] 检测变体
    print("[1/4] Detecting engine variant...")
    variant_id, variant_name = detect_variant(install_root)
    MODELSCOPE_REPO = 'shoujiekeji/Novastudio3.0'
    print(f"  [OK] Variant: {variant_name} ({variant_id})")

    # [2/4] 确定运行时包
    print("[2/4] Resolving runtime package...")
    engines_json_path = os.path.join(project_root, 'data', 'engines.json')
    if not os.path.exists(engines_json_path):
        raise RuntimeError(f"engines.json not found: {engines_json_path}")

    with open(engines_json_path, 'r', encoding='utf-8') as f:
        engines_data = json.load(f)

    ocr_engine = engines_data.get('engines', {}).get('ocr', {})
    variant_cfg = None
    for v in ocr_engine.get('variants', []):
        if v.get('id') == variant_id:
            variant_cfg = v
            break
    if not variant_cfg:
        raise RuntimeError(f"Variant '{variant_id}' not found in engines.json")

    runtimes = variant_cfg.get('runtimes', [])
    if not runtimes:
        raise RuntimeError(f"No runtimes defined for variant '{variant_id}'")

    # 选择运行时：优先 --runtime-id，否则取第一个
    runtime = None
    if args.runtime_id:
        for rt in runtimes:
            if rt.get('id') == args.runtime_id:
                runtime = rt
                break
        if not runtime:
            print(f"  [WARN] Runtime '{args.runtime_id}' not found, using default")
    if not runtime:
        runtime = runtimes[0]

    engine_file = runtime.get('modelscope_file', '')
    runtime_name = runtime.get('name', args.runtime_id or 'default')
    if not engine_file:
        raise RuntimeError(f"Runtime '{runtime.get('id')}' missing modelscope_file")
    print(f"  [OK] Runtime: {runtime_name}")
    print(f"  [OK] Package: {engine_file}")

    zip_filename = os.path.basename(engine_file)
    zip_path = os.path.join(install_root, zip_filename)

    if args.skip_runtime_download:
        print("[3/4] Download skipped — runtime handled by engine downloader")
        print("[4/4] Extract skipped — runtime handled by engine downloader")
    else:
        # [3/4] 从 ModelScope 下载运行环境
        print("[3/4] Downloading runtime environment from ModelScope...")
        downloader_candidates = [
            os.path.join(project_root, 'backend', 'dist', 'scripts', 'modelscope_downloader.py'),
            os.path.join(project_root, 'backend', 'src', 'services', 'modelscope_downloader.py'),
        ]
        downloader_script = next((p for p in downloader_candidates if os.path.exists(p)), None)
        if not downloader_script:
            raise RuntimeError(f"ModelScope 下载脚本未找到，已查找路径：{downloader_candidates}")

        python313 = os.path.join(project_root, 'external', 'python313', 'python.exe')
        if not os.path.exists(python313):
            raise RuntimeError(f"Python 3.13 not found: {python313}")

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

    # 写入 .installed 标记
    marker_path = os.path.join(install_root, '.installed')
    marker_data = {
        'installed_at': datetime.now(timezone.utc).isoformat(),
        'engine': 'ocr',
        'variant_id': variant_id,
    }
    if args.runtime_id:
        marker_data['runtime_id'] = args.runtime_id
        marker_data['runtime_name'] = runtime_name
    # 从路径提取版本号
    version_dir = os.path.basename(install_root)
    marker_data['version'] = version_dir
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
