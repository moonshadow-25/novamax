/**
 * URL转换服务
 * 用于在不同模型托管平台之间转换下载链接
 */
class URLConverter {
  /**
   * 将HuggingFace URL转换为HF Mirror（国内镜像）
   * @param {string} hfUrl - HuggingFace URL
   * @returns {string} HF Mirror URL
   */
  toHFMirror(hfUrl) {
    if (!hfUrl || !hfUrl.includes('huggingface.co')) {
      return hfUrl;
    }
    return hfUrl.replace('huggingface.co', 'hf-mirror.com');
  }

  /**
   * 尝试将HuggingFace URL转换为ModelScope URL
   * 注意：这是尝试性转换，不保证ModelScope上一定有对应模型
   * @param {string} hfUrl - HuggingFace URL
   * @returns {string} ModelScope URL
   */
  toModelScope(hfUrl) {
    if (!hfUrl || !hfUrl.includes('huggingface.co')) {
      return hfUrl;
    }
    // HuggingFace: https://huggingface.co/org/repo/resolve/main/path/to/file
    // ModelScope:   https://modelscope.cn/models/org/repo/resolve/main/path/to/file
    return hfUrl.replace('huggingface.co', 'modelscope.cn/models');
  }

  /**
   * 解析仓库URL信息
   * @param {string} url - 模型URL
   * @returns {Object} 仓库信息 { platform, org, repo, branch, filepath }
   */
  parseRepoInfo(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // HuggingFace格式: /org/repo/resolve/main/path/to/file
      // ModelScope格式: /models/org/repo/resolve/main/path/to/file
      const hfMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)\/resolve\/([^\/]+)\/(.+)$/);
      const msMatch = pathname.match(/^\/models\/([^\/]+)\/([^\/]+)\/resolve\/([^\/]+)\/(.+)$/);

      if (hfMatch) {
        return {
          platform: 'huggingface',
          org: hfMatch[1],
          repo: hfMatch[2],
          branch: hfMatch[3],
          filepath: hfMatch[4]
        };
      } else if (msMatch) {
        return {
          platform: 'modelscope',
          org: msMatch[1],
          repo: msMatch[2],
          branch: msMatch[3],
          filepath: msMatch[4]
        };
      }

      return null;
    } catch (error) {
      console.error('Failed to parse repo URL:', error);
      return null;
    }
  }

  /**
   * 生成多个下载源
   * @param {string} originalUrl - 原始URL
   * @returns {Object} 多个下载源
   */
  generateDownloadSources(originalUrl) {
    if (!originalUrl) {
      return null;
    }

    const sources = {
      original: originalUrl
    };

    if (originalUrl.includes('huggingface.co')) {
      sources.hf_mirror = this.toHFMirror(originalUrl);
      sources.modelscope = this.toModelScope(originalUrl);
      sources.priority = ['modelscope', 'hf_mirror', 'original'];
    } else if (originalUrl.includes('modelscope.cn')) {
      sources.priority = ['original'];
    } else {
      sources.priority = ['original'];
    }

    return sources;
  }

  /**
   * 从文件名推测可能的搜索关键词
   * @param {string} filename - 文件名
   * @param {string} type - 模型类型
   * @returns {string} 搜索关键词
   */
  generateSearchKeyword(filename, type) {
    // 移除扩展名
    let keyword = filename.replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, '');

    // 移除版本号
    keyword = keyword.replace(/[-_]v?\d+(\.\d+)*$/i, '');

    // 添加类型关键词
    const typeKeywords = {
      'clip': 'clip text encoder',
      'vae': 'vae',
      'unet': 'unet',
      'diffusion_models': 'diffusion model',
      'text_encoders': 'text encoder',
      'checkpoints': 'checkpoint',
      'loras': 'lora',
      'controlnet': 'controlnet',
      'upscale_models': 'upscale'
    };

    const typeKeyword = typeKeywords[type] || '';
    return `${keyword} ${typeKeyword}`.trim();
  }
}

export default new URLConverter();
