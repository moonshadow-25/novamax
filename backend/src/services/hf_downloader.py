#!/usr/bin/env python3
"""
HuggingFace downloader script
使用 huggingface_hub SDK 下载模型的特定文件，支持 HF-Mirror 端点
"""
import sys
import os
import json
import argparse

try:
    from huggingface_hub import hf_hub_download, snapshot_download
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "huggingface_hub not installed. Please install: pip install huggingface-hub"
    }))
    sys.exit(1)


def download_model(repo_id, output_dir, files=None, revision='main', endpoint=None):
    """
    下载模型的特定文件

    Args:
        repo_id: HuggingFace 仓库 ID (例如: 'Comfy-Org/z_image_turbo')
        output_dir: 输出目录
        files: 要下载的文件路径列表 (仓库内相对路径)
        revision: 版本/分支，默认 'main'
        endpoint: HF 端点，默认使用官方，传入 'https://hf-mirror.com' 使用镜像
    """
    try:
        os.makedirs(output_dir, exist_ok=True)

        if endpoint:
            os.environ['HF_ENDPOINT'] = endpoint

        print(f"开始下载: {repo_id}", file=sys.stderr)
        print(f"目标目录: {output_dir}", file=sys.stderr)
        print(f"端点: {endpoint or 'https://huggingface.co'}", file=sys.stderr)

        downloaded_files = []

        if files:
            for filepath in files:
                print(f"下载文件: {filepath}", file=sys.stderr)
                local_path = hf_hub_download(
                    repo_id=repo_id,
                    filename=filepath,
                    local_dir=output_dir,
                    revision=revision,
                )
                downloaded_files.append(local_path)
                print(f"已下载: {local_path}", file=sys.stderr)
        else:
            model_dir = snapshot_download(
                repo_id=repo_id,
                local_dir=output_dir,
                revision=revision,
            )
            downloaded_files.append(model_dir)

        return {
            "success": True,
            "files": downloaded_files,
            "message": f"下载成功: {len(downloaded_files)} 个文件"
        }

    except Exception as e:
        import traceback
        print(f"错误详情: {traceback.format_exc()}", file=sys.stderr)
        return {
            "success": False,
            "error": str(e),
            "message": f"下载失败: {str(e)}"
        }


def main():
    parser = argparse.ArgumentParser(description='Download models from HuggingFace')
    parser.add_argument('repo_id', help='HuggingFace repo ID (e.g., Comfy-Org/z_image_turbo)')
    parser.add_argument('--output', '-o', required=True, help='Output directory')
    parser.add_argument('--files', '-f', nargs='+', help='Specific files to download (repo-relative path)')
    parser.add_argument('--revision', '-r', default='main', help='Model revision/branch (default: main)')
    parser.add_argument('--endpoint', '-e', default='https://hf-mirror.com', help='HF endpoint URL')

    args = parser.parse_args()

    result = download_model(
        repo_id=args.repo_id,
        output_dir=args.output,
        files=args.files,
        revision=args.revision,
        endpoint=args.endpoint,
    )

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
