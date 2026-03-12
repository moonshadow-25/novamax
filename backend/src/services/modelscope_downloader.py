#!/usr/bin/env python3
"""
ModelScope downloader script
直接下载到目标目录，使用 .part 文件，完成后重命名为正式文件。
不需要临时目录，支持断点续传，支持并发下载。
"""
import sys
import os
import json
import argparse
import fnmatch
import time

try:
    import requests
except ImportError:
    print(json.dumps({"success": False, "error": "requests not installed. Please install: pip install requests"}))
    sys.exit(1)


BASE_URL = "https://www.modelscope.cn"


def fmt_size(b):
    """格式化字节大小"""
    if b >= 1024 ** 3:
        return f"{b / 1024 ** 3:.2f}G"
    if b >= 1024 ** 2:
        return f"{b / 1024 ** 2:.2f}M"
    if b >= 1024:
        return f"{b / 1024:.2f}K"
    return f"{b}B"


def fmt_speed(bps):
    """格式化速度"""
    if bps >= 1024 ** 3:
        return f"{bps / 1024 ** 3:.1f}GB/s"
    if bps >= 1024 ** 2:
        return f"{bps / 1024 ** 2:.1f}MB/s"
    if bps >= 1024:
        return f"{bps / 1024:.1f}KB/s"
    return f"{bps:.0f}B/s"


def get_model_files(model_id, revision='master'):
    """获取模型文件列表"""
    url = f"{BASE_URL}/api/v1/models/{model_id}/repo/files"
    params = {'Revision': revision, 'Recursive': 'true', 'Root': ''}
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        files = data.get('Data', {}).get('Files', [])
        return [f for f in files if not f.get('IsDir', False)]
    except Exception as e:
        print(f"获取文件列表失败: {e}", file=sys.stderr)
        return []


def match_patterns(filename, patterns):
    """检查文件名是否匹配任意一个 pattern（支持 fnmatch 通配符）"""
    if not patterns:
        return True
    basename = os.path.basename(filename)
    for pattern in patterns:
        pat_base = os.path.basename(pattern)
        if fnmatch.fnmatch(basename, pat_base):
            return True
        if fnmatch.fnmatch(basename, pattern):
            return True
        if fnmatch.fnmatch(filename, pattern):
            return True
    return False


def download_file(model_id, file_name, file_path_in_repo, output_dir, revision='master'):
    """
    下载单个文件，使用 .part 文件。
    下载中文件名为 filename.part，下载完成后重命名为 filename。
    支持断点续传。
    """
    part_path = os.path.join(output_dir, file_name + '.part')
    final_path = os.path.join(output_dir, file_name)

    # 如果已完整下载，跳过
    if os.path.exists(final_path):
        print(f"文件已存在，跳过: {file_name}", file=sys.stderr)
        return True

    # 断点续传：读取已下载的字节数
    resume_pos = os.path.getsize(part_path) if os.path.exists(part_path) else 0

    # 构建下载 URL（ModelScope 文件下载接口会重定向到实际 CDN 地址）
    url = f"{BASE_URL}/api/v1/models/{model_id}/repo"
    params = {'Revision': revision, 'FilePath': file_path_in_repo}

    headers = {}
    if resume_pos > 0:
        headers['Range'] = f'bytes={resume_pos}-'

    print(f"开始下载: {file_name} (续传位置: {fmt_size(resume_pos)})", file=sys.stderr)

    try:
        resp = requests.get(url, params=params, headers=headers, stream=True, timeout=60, allow_redirects=True)

        if resp.status_code == 416:
            # Range Not Satisfiable：文件已完整
            if os.path.exists(part_path):
                os.rename(part_path, final_path)
                print(f"✓ 文件已完整（416续传重命名）: {file_name}", file=sys.stderr)
            return True

        resp.raise_for_status()

        content_length = int(resp.headers.get('content-length', 0))
        total_size = content_length + resume_pos if (resume_pos > 0 and resp.status_code == 206) else content_length

        downloaded = resume_pos
        start_time = time.time()
        last_print = time.time() - 1  # 立即打印第一次进度

        mode = 'ab' if resume_pos > 0 else 'wb'
        with open(part_path, mode) as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    now = time.time()
                    if now - last_print >= 0.5:
                        elapsed = now - start_time
                        speed = (downloaded - resume_pos) / elapsed if elapsed > 0 else 0
                        progress = int(downloaded * 100 / total_size) if total_size > 0 else 0
                        # 格式与 Node.js 进度解析正则匹配：
                        # "Downloading {name}: {N}%|{downloaded}/{total}|{speed}"
                        print(
                            f"Downloading {file_name}: {progress}%|{fmt_size(downloaded)}/{fmt_size(total_size)}|{fmt_speed(speed)}",
                            file=sys.stderr
                        )
                        last_print = now

        # 下载完成，重命名为正式文件（os.replace 在 Windows 上可覆盖已存在的同名文件）
        os.replace(part_path, final_path)
        print(f"✓ 下载完成: {file_name}", file=sys.stderr)
        return True

    except Exception as e:
        print(f"下载失败 {file_name}: {e}", file=sys.stderr)
        raise


def download_model(model_id, output_dir, files=None, revision='master'):
    """
    下载模型文件，直接写入 output_dir，过程中使用 .part 后缀。

    Args:
        model_id: ModelScope 模型 ID (例如: 'qwen/Qwen2.5-7B-Instruct')
        output_dir: 输出目录（即最终目标目录，无需临时目录）
        files: 要下载的文件模式列表，如 ['*Q5_K_M*.gguf', '*.json']。None 表示下载所有文件。
        revision: 版本/分支，默认 'master'
    """
    try:
        os.makedirs(output_dir, exist_ok=True)

        print(f"开始下载模型: {model_id}", file=sys.stderr)
        print(f"目标目录: {output_dir}", file=sys.stderr)
        print(f"版本: {revision}", file=sys.stderr)

        # 获取文件列表
        print("获取文件列表...", file=sys.stderr)
        all_files = get_model_files(model_id, revision)

        if not all_files:
            return {"success": False, "error": "无法获取模型文件列表，请检查模型 ID 和网络连接"}

        print(f"共找到 {len(all_files)} 个文件", file=sys.stderr)

        # 过滤要下载的文件
        if files:
            files_to_download = [f for f in all_files if match_patterns(f.get('Path', '') or f.get('Name', ''), files)]
            print(f"匹配 patterns {files}: {len(files_to_download)} 个文件", file=sys.stderr)
        else:
            files_to_download = all_files

        if not files_to_download:
            return {"success": False, "error": f"没有文件匹配指定的 patterns: {files}"}

        # 逐个下载
        for f in files_to_download:
            # Path 包含完整相对路径（含子目录），Name 仅为文件名，子目录文件必须用 Path
            file_path_in_repo = f.get('Path', '') or f.get('Name', '')
            file_name = os.path.basename(file_path_in_repo)
            if not file_name:
                continue
            download_file(model_id, file_name, file_path_in_repo, output_dir, revision)

        return {
            "success": True,
            "model_dir": output_dir,
            "message": f"模型下载成功: {output_dir}"
        }

    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"错误详情: {error_detail}", file=sys.stderr)
        return {
            "success": False,
            "error": str(e),
            "message": f"下载失败: {str(e)}"
        }


def main():
    parser = argparse.ArgumentParser(description='Download models from ModelScope directly to target directory')
    parser.add_argument('model_id', help='ModelScope model ID (e.g., qwen/Qwen2.5-7B-Instruct)')
    parser.add_argument('--output', '-o', required=True, help='Output directory (final destination, no temp dir needed)')
    parser.add_argument('--files', '-f', nargs='+', help='File patterns to download (e.g., *Q5_K_M*.gguf *.json)')
    parser.add_argument('--revision', '-r', default='master', help='Model revision/branch (default: master)')

    args = parser.parse_args()

    result = download_model(
        model_id=args.model_id,
        output_dir=args.output,
        files=args.files,
        revision=args.revision
    )

    # 输出 JSON 结果
    print(json.dumps(result, ensure_ascii=False))

    # 返回退出码
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
