"""
Qwen3-ASR 引擎安装脚本
由 NovaMax 后端调用，路径通过参数传入。

Qwen3-ASR 是基于 PyTorch/transformers 的语音识别引擎，通过 serve.py (FastAPI)
提供 HTTP 服务。引擎 zip 仅包含适配器代码和模型文件，运行时环境（ROCm + PyTorch）
需要从 ModelScope 单独下载。

本脚本负责：
  1. 验证引擎核心文件存在（serve.py, contract.json）
  2. 下载运行时环境（ROCm + PyTorch，~1.2 GB）
  3. 解压运行时到 install-root/runtime/
  4. 验证 Python 可 import 关键模块
  5. 写入 .installed 标记

参数：
  --install-root          Qwen3-ASR 解压目录（external/asr/qwen3-asr/{version}/）
  --project-root          项目根目录
  --skip-runtime-download 跳过运行时下载（由 engineDownloader 处理）
"""

import argparse
import subprocess
import sys
import os
import json
import zipfile
import shutil
from datetime import datetime, timezone

MODELSCOPE_REPO = 'shoujiekeji/Novastudio3.0'


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
        result = subprocess.run(
            cmd, cwd=cwd, env=env,
            capture_output=True, text=True, encoding='utf-8', errors='replace'
        )
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.stderr.strip():
            print(result.stderr.strip())
        if check and result.returncode != 0:
            raise RuntimeError(f"命令失败，退出码: {result.returncode}")
        return result


def _find_runtime_python(install_root):
    """查找已安装的运行时 Python"""
    candidates = [
        os.path.join(install_root, 'runtime', 'Scripts', 'python.exe'),
        os.path.join(install_root, 'runtime', 'python.exe'),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _get_bundled_python(project_root):
    return os.path.join(project_root, 'external', 'python313', 'python.exe')


def _find_downloader(project_root):
    """查找 ModelScope 下载脚本"""
    candidates = [
        os.path.join(project_root, 'backend', 'dist', 'scripts', 'modelscope_downloader.py'),
        os.path.join(project_root, 'backend', 'src', 'services', 'modelscope_downloader.py'),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


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
    print("Qwen3-ASR Installation")
    print("========================================")
    print(f"  Install Root:  {install_root}")
    print()

    # [1/4] 验证核心文件
    print("[1/4] Verifying engine files...")
    serve_py = os.path.join(install_root, 'serve.py')
    contract_json = os.path.join(install_root, 'contract.json')

    if not os.path.exists(serve_py):
        raise RuntimeError(f"serve.py not found in: {install_root}")
    print(f"  [OK] serve.py found")

    if not os.path.exists(contract_json):
        raise RuntimeError(f"contract.json not found in: {install_root}")
    print(f"  [OK] contract.json found")

    # [2/4] 确定运行时包
    print("[2/4] Resolving runtime package...")
    engines_json_path = os.path.join(project_root, 'data', 'engines.json')
    if not os.path.exists(engines_json_path):
        raise RuntimeError(f"engines.json not found: {engines_json_path}")

    with open(engines_json_path, 'r', encoding='utf-8') as f:
        engines_data = json.load(f)

    asr_engine = engines_data.get('engines', {}).get('asr', {})
    variant_cfg = None
    for v in asr_engine.get('variants', []):
        if v.get('id') == 'qwen3-asr':
            variant_cfg = v
            break
    if not variant_cfg:
        raise RuntimeError("Variant 'qwen3-asr' not found in engines.json")

    runtimes = variant_cfg.get('runtimes', [])
    if not runtimes:
        print("  [INFO] No runtimes defined — assuming embedded Python in engine zip")
        runtime = None
    else:
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

    # [3/4] 下载/验证运行时
    if args.skip_runtime_download or not runtime:
        print(f"[3/4] Runtime check — {'skipped' if args.skip_runtime_download else 'not required'}...")
        if not args.skip_runtime_download:
            runtime_python = _find_runtime_python(install_root)
            if runtime_python:
                print(f"  [OK] Runtime already present: {runtime_python}")
            else:
                print("  [INFO] No runtime found — engine will need runtime at startup")
    else:
        engine_file = runtime.get('modelscope_file', '')
        zip_filename = os.path.basename(engine_file)
        zip_path = os.path.join(install_root, zip_filename)

        # 检查是否已存在
        runtime_python = _find_runtime_python(install_root)
        if runtime_python:
            print(f"[3/4] Runtime already installed: {runtime_python}")
            print("  [OK] Skipping download")
        else:
            print("[3/4] Downloading runtime environment from ModelScope...")
            downloader_script = _find_downloader(project_root)
            if not downloader_script:
                raise RuntimeError(
                    f"ModelScope 下载脚本未找到。\n"
                    f"请确保项目自带的 Python 环境可用，或手动将运行环境放到: {install_root}"
                )

            python313 = _get_bundled_python(project_root)
            if not os.path.exists(python313):
                raise RuntimeError(f"Python 3.13 not found: {python313}")

            result = run(
                [python313, downloader_script, MODELSCOPE_REPO,
                 '--output', install_root, '--files', engine_file],
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

            # 解压到 runtime/ 子目录（adapter 期望的路径）
            print("[3/4] Extracting runtime environment...")
            runtime_dir = os.path.join(install_root, 'runtime')
            os.makedirs(runtime_dir, exist_ok=True)

            with zipfile.ZipFile(zip_path, 'r') as zf:
                # 检测 zip 内是否有顶层目录
                top_names = set()
                for name in zf.namelist():
                    top = name.split('/')[0]
                    if top:
                        top_names.add(top)

                if len(top_names) == 1 and any(
                    zf.getinfo(n).is_dir() for n in zf.namelist()
                    if n.startswith(list(top_names)[0] + '/')
                ):
                    # 单顶层目录 → 提取后移动内容
                    temp_extract = install_root + '___runtime_tmp'
                    if os.path.exists(temp_extract):
                        shutil.rmtree(temp_extract)
                    zf.extractall(temp_extract)
                    top_dir = os.path.join(temp_extract, list(top_names)[0])
                    for item in os.listdir(top_dir):
                        src = os.path.join(top_dir, item)
                        dst = os.path.join(runtime_dir, item)
                        if os.path.exists(dst):
                            if os.path.isdir(dst):
                                shutil.rmtree(dst)
                            else:
                                os.remove(dst)
                        shutil.move(src, dst)
                    shutil.rmtree(temp_extract)
                else:
                    zf.extractall(runtime_dir)

            print(f"  [OK] Extracted to: {runtime_dir}")

            # 删除 zip
            os.remove(zip_path)
            print(f"  [OK] Removed archive: {zip_filename}")

        # [4/4] 验证运行时 + 写入标记
        print("[4/4] Verifying runtime environment...")
        runtime_python = _find_runtime_python(install_root)
        if runtime_python:
            print(f"  [OK] Runtime Python found: {runtime_python}")

            check_modules = ['torch', 'fastapi', 'uvicorn', 'librosa']
            for mod in check_modules:
                result = run(
                    [runtime_python, '-c', f'import {mod}'],
                    check=False,
                    env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}
                )
                if result.returncode == 0:
                    print(f"  [OK] {mod} import passed")
                else:
                    print(f"  [WARN] {mod} import failed")
        else:
            print("  [WARN] Runtime Python not found after extraction — check logs above")

        # 写入 .installed 标记
        print("[4/4] Writing installation marker...")
        marker_path = os.path.join(install_root, '.installed')
        marker_data = {
            'installed_at': datetime.now(timezone.utc).isoformat(),
            'engine': 'qwen3-asr',
            'variant_id': 'qwen3-asr',
            'version': os.path.basename(install_root),
        }
        if runtime:
            marker_data['runtime_id'] = runtime.get('id')
            marker_data['runtime_name'] = runtime.get('name')
        with open(marker_path, 'w', encoding='utf-8') as f:
            json.dump(marker_data, f)
        print("  [OK] .installed marker written")

    # 无 runtime 定义的引擎：标记完成
    if not runtime:
        marker_path = os.path.join(install_root, '.installed')
        if not os.path.exists(marker_path):
            marker_data = {
                'installed_at': datetime.now(timezone.utc).isoformat(),
                'engine': 'qwen3-asr',
                'variant_id': 'qwen3-asr',
                'version': os.path.basename(install_root),
            }
            with open(marker_path, 'w', encoding='utf-8') as f:
                json.dump(marker_data, f)
            print("  [OK] .installed marker written")

    print()
    print("========================================")
    print("Qwen3-ASR installation completed!")
    print("========================================")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
