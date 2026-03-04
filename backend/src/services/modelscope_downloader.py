#!/usr/bin/env python3
"""
ModelScope downloader script
使用 ModelScope SDK 下载模型的特定文件
"""
import sys
import os
import json
import argparse
from pathlib import Path

try:
    from modelscope.hub.snapshot_download import snapshot_download
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "ModelScope not installed. Please install: pip install modelscope"
    }))
    sys.exit(1)


def download_model(model_id, output_dir, files=None, revision='master'):
    """
    下载模型的特定文件

    Args:
        model_id: ModelScope 模型 ID (例如: 'qwen/Qwen2.5-7B-Instruct')
        output_dir: 输出目录
        files: 要下载的文件列表，如 ['Q5_K_M.gguf']。如果为 None，下载所有文件
        revision: 版本/分支，默认 'master'

    Returns:
        下载的本地路径
    """
    try:
        # 确保输出目录存在
        os.makedirs(output_dir, exist_ok=True)

        print(f"开始下载模型: {model_id}", file=sys.stderr)
        print(f"目标目录: {output_dir}", file=sys.stderr)
        print(f"版本: {revision}", file=sys.stderr)

        if files:
            print(f"只下载文件: {files}", file=sys.stderr)
        else:
            print("下载所有文件", file=sys.stderr)

        # 构建下载参数
        download_args = {
            'model_id': model_id,
            'cache_dir': output_dir,
            'revision': revision
        }

        # 如果指定了文件，使用 allow_patterns 只下载这些文件
        if files:
            # 直接使用提供的模式
            allow_patterns = files.copy()

            # 对于每个模式，如果不包含通配符且不包含路径，添加子目录匹配
            expanded_patterns = []
            for pattern in allow_patterns:
                expanded_patterns.append(pattern)
                # 如果模式不包含 / 和 *，添加子目录版本
                if '/' not in pattern and '*' not in pattern:
                    expanded_patterns.append(f'*/{pattern}')

            download_args['allow_patterns'] = expanded_patterns
            print(f"Allow patterns: {expanded_patterns}", file=sys.stderr)

        # 下载模型
        model_dir = snapshot_download(**download_args)

        return {
            "success": True,
            "model_dir": model_dir,
            "message": f"模型下载成功: {model_dir}"
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
    parser = argparse.ArgumentParser(description='Download models from ModelScope')
    parser.add_argument('model_id', help='ModelScope model ID (e.g., qwen/Qwen2.5-7B-Instruct)')
    parser.add_argument('--output', '-o', required=True, help='Output directory')
    parser.add_argument('--files', '-f', nargs='+', help='Specific files to download (e.g., Q5_K_M.gguf)')
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
