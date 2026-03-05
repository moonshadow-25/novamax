import fs from 'fs';
import path from 'path';
import { MODELS_RUN_DIR } from '../config/constants.js';

/**
 * ComfyUI模型管理器
 * 负责扫描、检查和管理ComfyUI模型文件
 */
class ComfyUIModelManager {
  constructor() {
    this.comfyuiModelsDir = path.join(MODELS_RUN_DIR, 'comfyui', 'models');
  }

  /**
   * 扫描ComfyUI模型目录，返回已存在的文件列表
   * @returns {Object} 按类型分组的文件列表
   */
  scanModelsDirectory() {
    const modelTypes = [
      'clip',
      'vae',
      'unet',
      'checkpoints',
      'loras',
      'controlnet',
      'upscale_models',
      'diffusion_models',
      'text_encoders',
      'clip_vision',
      'embeddings',
      'hypernetworks',
      'style_models',
      'photomaker',
      'gligen'
    ];

    const scannedFiles = {};

    for (const type of modelTypes) {
      const typeDir = path.join(this.comfyuiModelsDir, type);

      if (!fs.existsSync(typeDir)) {
        console.log(`  ⚠ 目录不存在: ${typeDir}`);
        scannedFiles[type] = [];
        continue;
      }

      try {
        const files = fs.readdirSync(typeDir);
        scannedFiles[type] = files.filter(file => {
          const stats = fs.statSync(path.join(typeDir, file));
          return stats.isFile();
        });

        console.log(`  ✓ ${type}: 找到 ${scannedFiles[type].length} 个文件`);
      } catch (error) {
        console.error(`  ✗ 扫描 ${type} 目录失败:`, error.message);
        scannedFiles[type] = [];
      }
    }

    return scannedFiles;
  }

  /**
   * 检查单个模型文件是否存在
   * @param {string} type - 模型类型
   * @param {string} filename - 文件名
   * @returns {boolean} 文件是否存在
   */
  checkModelExists(type, filename) {
    const filePath = path.join(this.comfyuiModelsDir, type, filename);
    return fs.existsSync(filePath);
  }

  /**
   * 获取模型文件的完整路径
   * @param {string} type - 模型类型
   * @param {string} filename - 文件名
   * @returns {string} 完整路径
   */
  getModelPath(type, filename) {
    return path.join(this.comfyuiModelsDir, type, filename);
  }

  /**
   * 检查并更新工作流的required_models状态
   * @param {Array} requiredModels - 所需模型列表
   * @returns {Array} 更新后的模型列表
   */
  updateModelsStatus(requiredModels) {
    if (!Array.isArray(requiredModels)) {
      return [];
    }

    return requiredModels.map(model => {
      const exists = this.checkModelExists(model.type, model.filename);

      return {
        ...model,
        downloaded: exists,
        local_path: exists ? this.getModelPath(model.type, model.filename) : null
      };
    });
  }

  /**
   * 下载模型文件
   * @param {Object} modelInfo - 模型信息
   * @param {string} modelscopeUrl - ModelScope下载URL
   * @param {Function} onProgress - 进度回调函数
   * @returns {Promise<string>} 下载后的文件路径
   */
  async downloadModel(modelInfo, modelscopeUrl, onProgress) {
    const { type, filename } = modelInfo;
    const targetDir = path.join(this.comfyuiModelsDir, type);
    const targetPath = path.join(targetDir, filename);

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // TODO: 实际的下载逻辑将在这里实现
    // 这里需要复用 downloadService 的下载功能
    throw new Error('下载功能将在完整实现中添加');
  }

  /**
   * 使用LLM生成搜索关键词
   * @param {string} filename - 文件名
   * @param {string} type - 模型类型
   * @returns {Promise<string>} 搜索关键词
   */
  async generateSearchQuery(filename, type) {
    // 基本的关键词提取逻辑
    // 移除文件扩展名
    let query = filename.replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, '');

    // 移除常见的版本标识
    query = query.replace(/[-_]v?\d+(\.\d+)*$/i, '');

    // 添加类型关键词
    const typeKeywords = {
      'clip': 'clip text encoder',
      'vae': 'vae',
      'unet': 'unet diffusion',
      'checkpoints': 'checkpoint',
      'loras': 'lora',
      'controlnet': 'controlnet',
      'upscale_models': 'upscale'
    };

    const typeKeyword = typeKeywords[type] || type;
    query = `${query} ${typeKeyword}`;

    console.log(`生成搜索关键词: "${filename}" (${type}) -> "${query}"`);

    // TODO: 在完整实现中，这里可以调用LLM来优化搜索关键词
    // const llmOptimized = await this.callLLM(prompt);

    return query;
  }

  /**
   * 智能匹配搜索结果
   * @param {Array} searchResults - ModelScope搜索结果
   * @param {string} filename - 目标文件名
   * @returns {Object|null} 最匹配的结果
   */
  findBestMatch(searchResults, filename) {
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    // 提取文件名的核心部分（移除扩展名和版本号）
    const cleanFilename = filename
      .replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, '')
      .replace(/[-_]v?\d+(\.\d+)*$/i, '')
      .toLowerCase();

    // 计算相似度得分
    const scored = searchResults.map(result => {
      const resultName = result.name.toLowerCase();
      const resultPath = result.path.toLowerCase();

      let score = 0;

      // 完全匹配文件名
      if (resultName === cleanFilename || resultPath.includes(cleanFilename)) {
        score += 100;
      }

      // 包含文件名的主要部分
      const filenameParts = cleanFilename.split(/[-_]/);
      for (const part of filenameParts) {
        if (part.length > 2 && (resultName.includes(part) || resultPath.includes(part))) {
          score += 10;
        }
      }

      // 优先选择官方模型
      if (resultPath.includes('official') || resultPath.includes('modelscope')) {
        score += 5;
      }

      return { ...result, score };
    });

    // 按得分排序
    scored.sort((a, b) => b.score - a.score);

    console.log('搜索结果匹配得分:');
    scored.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name} (${r.path}) - 得分: ${r.score}`);
    });

    return scored[0].score > 0 ? scored[0] : searchResults[0];
  }

  /**
   * 获取模型文件信息
   * @param {string} type - 模型类型
   * @param {string} filename - 文件名
   * @returns {Object|null} 文件信息
   */
  getModelInfo(type, filename) {
    const filePath = this.getModelPath(type, filename);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);

    return {
      filename,
      type,
      path: filePath,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString()
    };
  }
}

export default new ComfyUIModelManager();
