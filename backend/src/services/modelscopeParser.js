/**
 * ModelScope 模型解析服务
 * 从 ModelScope API 抓取模型信息，解析量化版本和 mmproj 文件
 */

import axios from 'axios';

// 量化类型元数据
const QUANTIZATION_INFO = {
  'BF16': { category: 'original', quality: 100, description: '原始精度，无损', recommended: false },
  'F16': { category: 'original', quality: 100, description: '半精度，无损', recommended: false },
  'F32': { category: 'original', quality: 100, description: '单精度，无损', recommended: false },
  'Q8_0': { category: 'high', quality: 95, description: '几乎无损，推荐高质量场景', recommended: false },
  'Q6_K': { category: 'high', quality: 90, description: '高质量，平衡性能与大小', recommended: false },
  'Q5_K_M': { category: 'balanced', quality: 85, description: '推荐，质量与大小平衡', recommended: true },
  'Q5_K_S': { category: 'balanced', quality: 83, description: '高质量，较小体积', recommended: false },
  'Q4_K_M': { category: 'balanced', quality: 80, description: '常用推荐，适合大多数场景', recommended: true },
  'Q4_K_S': { category: 'balanced', quality: 78, description: '常用，体积较小', recommended: false },
  'Q4_0': { category: 'balanced', quality: 75, description: '标准量化', recommended: false },
  'Q4_1': { category: 'balanced', quality: 76, description: '标准量化', recommended: false },
  'IQ4_NL': { category: 'balanced', quality: 77, description: '改进 Q4', recommended: false },
  'IQ4_XS': { category: 'compressed', quality: 74, description: '极致压缩，适合低显存', recommended: false },
  'Q3_K_M': { category: 'compressed', quality: 70, description: '低显存可用', recommended: false },
  'Q3_K_S': { category: 'compressed', quality: 68, description: '低显存可用', recommended: false },
  'IQ3_XXS': { category: 'compressed', quality: 65, description: '超低显存', recommended: false },
  'Q2_K': { category: 'ultra_compressed', quality: 60, description: '极限压缩', recommended: false },
  'IQ2_M': { category: 'ultra_compressed', quality: 58, description: '极限压缩', recommended: false },
  'IQ2_XXS': { category: 'ultra_compressed', quality: 55, description: '超极限压缩', recommended: false },
};

class ModelscopeParser {
  /**
   * 解析 ModelScope URL，提取 modelId 和可选的文件夹路径
   * @param {string} url - ModelScope URL
   * @returns {Object} { modelId, folder }
   */
  parseModelUrl(url) {
    // 支持的 URL 格式:
    // https://www.modelscope.cn/models/owner/name
    // https://www.modelscope.cn/models/owner/name/tree/master
    // https://www.modelscope.cn/models/owner/name/tree/master/folder

    const urlPattern = /modelscope\.cn\/models\/([^\/]+\/[^\/]+)(?:\/tree\/master\/(.+))?/;
    const match = url.match(urlPattern);

    if (!match) {
      throw new Error('URL 格式不正确，必须是 ModelScope 模型 URL');
    }

    return {
      modelId: match[1],
      folder: match[2] || null
    };
  }

  /**
   * 从 ModelScope 获取模型元数据
   * @param {string} modelId - 模型 ID (owner/name)
   * @returns {Object} { modelData, files, description }
   */
  async fetchModelInfo(modelId) {
    try {
      // 1. 获取模型基本信息
      const infoUrl = `https://www.modelscope.cn/api/v1/models/${modelId}`;
      const infoResponse = await axios.get(infoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });

      if (infoResponse.data.Code !== 200) {
        throw new Error('模型未找到');
      }

      const modelData = infoResponse.data.Data;

      // 2. 获取模型文件列表（递归模式，获取所有子目录文件）
      const filesUrl = `https://www.modelscope.cn/api/v1/models/${modelId}/repo/files?Recursive=true&PageSize=500`;
      console.log(`Fetching files from: ${filesUrl}`);
      const filesResponse = await axios.get(filesUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });

      if (filesResponse.data.Code !== 200) {
        throw new Error('无法获取文件列表');
      }

      const files = filesResponse.data.Data.Files || [];

      // 3. 提取描述
      let description = modelData.Description || '';
      if (!description && modelData.ReadMeContent) {
        const lines = modelData.ReadMeContent.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') ||
              trimmed.startsWith('<') ||
              trimmed.startsWith('!') ||
              trimmed.startsWith('[') ||
              trimmed.length < 20) {
            continue;
          }
          description = trimmed.substring(0, 200);
          break;
        }
      }

      if (!description) {
        description = `${modelData.Name} - ModelScope 模型`;
      }

      return {
        modelData,
        files,
        description
      };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('在 ModelScope 上未找到该模型');
      } else if (error.message) {
        throw error;
      } else {
        throw new Error('无法连接到 ModelScope');
      }
    }
  }

  /**
   * 从文件名提取量化类型
   * @param {string} filename - 文件名
   * @returns {string|null} 量化类型
   */
  extractQuantizationType(filename) {
    // 移除 .gguf 后缀
    const baseName = filename.replace('.gguf', '');

    // 匹配量化类型模式
    const patterns = [
      /-(BF16)$/i,
      /-(F16)$/i,
      /-(F32)$/i,
      /-(Q8_0)$/i,
      /-(Q6_K)$/i,
      /-(Q5_K_M)$/i,
      /-(Q5_K_S)$/i,
      /-(Q4_K_M)$/i,
      /-(Q4_K_S)$/i,
      /-(Q4_0)$/i,
      /-(Q4_1)$/i,
      /-(IQ4_NL)$/i,
      /-(IQ4_XS)$/i,
      /-(Q3_K_M)$/i,
      /-(Q3_K_S)$/i,
      /-(IQ3_XXS)$/i,
      /-(Q2_K)$/i,
      /-(IQ2_M)$/i,
      /-(IQ2_XXS)$/i,
      // UD 系列
      /-(UD-IQ2_M)$/i,
      /-(UD-IQ2_XXS)$/i,
      /-(UD-IQ3_XXS)$/i,
      /-(UD-Q2_K_XL)$/i,
      /-(UD-Q3_K_XL)$/i,
      /-(UD-Q4_K_XL)$/i,
      /-(UD-Q5_K_XL)$/i,
      /-(UD-Q6_K_XL)$/i,
      /-(UD-Q8_K_XL)$/i,
    ];

    for (const pattern of patterns) {
      const match = baseName.match(pattern);
      if (match) {
        return match[1].toUpperCase();
      }
    }

    return null;
  }

  /**
   * 生成量化版本配置
   * @param {Array} files - 文件列表
   * @param {string} modelId - 模型 ID
   * @param {string|null} filterFolder - 可选的文件夹筛选
   * @returns {Array} 量化版本数组
   */
  generateQuantizations(files, modelId, filterFolder = null) {
    const quantizations = [];

    // 处理文件夹结构
    const folderFiles = files.filter(f => f.Type === 'tree');
    const blobFiles = files.filter(f => f.Type === 'blob');

    // 处理文件夹类型（大模型）
    for (const folder of folderFiles) {
      // 如果指定了筛选文件夹，只处理匹配的文件夹
      if (filterFolder && folder.Name !== filterFolder) {
        continue;
      }

      const quantType = folder.Name.toUpperCase();
      const info = QUANTIZATION_INFO[quantType] || {
        category: 'balanced',
        quality: 75,
        description: '标准量化',
        recommended: false
      };

      // 统计文件夹内所有文件大小总和，并按文件名排序（确保分片顺序与下载顺序一致）
      const folderPrefix = folder.Name + '/';
      const filesInFolder = blobFiles
        .filter(f => f.Path && f.Path.startsWith(folderPrefix))
        .sort((a, b) => a.Name.localeCompare(b.Name));
      const totalSize = filesInFolder.reduce((sum, f) => sum + (f.Size || 0), 0);
      const sizeLabel = totalSize > 0
        ? `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`
        : '文件夹';

      // 保存每个文件的 name+size，供下载时计算累计进度用
      const folderFileList = filesInFolder.map(f => ({ name: f.Name, size: f.Size || 0 }));

      quantizations.push({
        name: quantType,
        label: `${quantType} - ${sizeLabel}`,
        is_folder: true,
        folder_path: folder.Name,
        total_size: totalSize,
        folder_files: folderFileList,
        category: info.category,
        quality: info.quality,
        description: info.description,
        recommended: info.recommended
      });
    }

    // 处理 GGUF 文件（排除 mmproj）
    const ggufFiles = blobFiles.filter(f =>
      f.Name?.toLowerCase().endsWith('.gguf') &&
      !f.Name.toLowerCase().includes('mmproj')
    );

    for (const file of ggufFiles) {
      const quantType = this.extractQuantizationType(file.Name);
      if (!quantType) {
        console.warn(`⚠ 无法识别量化类型: ${file.Name}`);
        continue;
      }

      // 获取量化信息
      const info = QUANTIZATION_INFO[quantType] || {
        category: 'balanced',
        quality: 75,
        description: '标准量化',
        recommended: false
      };

      const sizeGB = (file.Size / (1024 * 1024 * 1024)).toFixed(2);

      quantizations.push({
        name: quantType,
        label: `${quantType} - ${sizeGB} GB`,
        is_folder: false,
        category: info.category,
        quality: info.quality,
        description: info.description,
        recommended: info.recommended,
        file: {
          name: file.Name,
          size: file.Size,
          sha256: file.Sha256,
          download_url: `https://www.modelscope.cn/models/${modelId}/resolve/master/${file.Name}`
        }
      });
    }

    // 按质量排序
    quantizations.sort((a, b) => b.quality - a.quality);

    // 如果没有推荐的，自动选择 Q4_K_M 或 Q5_K_M
    const hasRecommended = quantizations.some(q => q.recommended);
    if (!hasRecommended && quantizations.length > 0) {
      const q4km = quantizations.find(q => q.name === 'Q4_K_M');
      const q5km = quantizations.find(q => q.name === 'Q5_K_M');
      if (q4km) q4km.recommended = true;
      else if (q5km) q5km.recommended = true;
      else quantizations[Math.floor(quantizations.length / 2)].recommended = true;
    }

    return quantizations;
  }

  /**
   * 检测并生成 mmproj 选项
   * @param {Array} files - 文件列表
   * @param {string} modelId - 模型 ID
   * @returns {Array} mmproj 选项数组
   */
  generateMmprojOptions(files, modelId) {
    const mmprojFiles = files.filter(f =>
      f.Type === 'blob' &&
      f.Name?.toLowerCase().includes('mmproj') &&
      f.Name?.toLowerCase().endsWith('.gguf')
    );

    return mmprojFiles.map(file => ({
      name: file.Name,
      size: file.Size,
      sha256: file.Sha256,
      download_url: `https://www.modelscope.cn/models/${modelId}/resolve/master/${file.Name}`
    }));
  }

  /**
   * 生成完整模型配置
   * @param {string} modelId - 模型 ID
   * @param {string} type - 模型类型
   * @param {Object} modelData - ModelScope API 返回的模型数据
   * @param {Array} files - 文件列表
   * @param {string} description - 描述
   * @param {string|null} filterFolder - 可选的文件夹筛选
   * @returns {Object} 完整的模型配置
   */
  generateModelConfig(modelId, type, modelData, files, description, filterFolder = null) {
    const baseConfig = {
      id: modelId.replace('/', '_'),
      name: modelData.Name || modelId.split('/').pop(),
      description: description || '暂无描述',
      type: type,
      modelscope_id: modelId,
      downloaded: false,
      status: 'stopped',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (type === 'llm') {
      // 生成量化版本列表
      const quantizations = this.generateQuantizations(files, modelId, filterFolder);
      const mmprojOptions = this.generateMmprojOptions(files, modelId);

      // 验证是否有量化版本
      if (quantizations.length === 0) {
        throw new Error('该仓库中没有 GGUF 文件');
      }

      // 默认选择推荐版本
      const defaultQuant = quantizations.find(q => q.recommended) || quantizations[0];

      return {
        ...baseConfig,

        // 量化版本配置
        quantizations,
        selected_quantization: defaultQuant?.name || null,

        // mmproj 配置
        mmproj_options: mmprojOptions,
        selected_mmproj: mmprojOptions.length > 0 ? mmprojOptions[0].name : null,

        // 向后兼容：保留 files 字段（指向当前选择的量化版本）
        files: defaultQuant && !defaultQuant.is_folder ? {
          model: defaultQuant.file,
          mmproj: mmprojOptions.length > 0 ? mmprojOptions[0] : null
        } : null,

        capabilities: {
          chat: true,
          vision: mmprojOptions.length > 0,
          completion: true
        },

        parameters: {
          version: '1.0.0',
          context_length: 131072,
          gpu_layers: -1,
          threads: 8,
          parallel: 2,
          batch: 512,
          ubatch: 512,
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.1
        },

        user_parameters: null,
        user_parameters_version: null,

        frameworks: modelData.Frameworks || [],
        tags: modelData.Tags || [],
        license: modelData.License || '',
        stars: modelData.Stars || 0,
        downloads: modelData.Downloads || 0,

        // 标记是否从文件夹 URL 创建
        filter_folder: filterFolder
      };
    }

    // 其他类型的配置可以在这里扩展
    return baseConfig;
  }

  /**
   * 搜索 ModelScope 模型
   * @param {string} query - 搜索查询
   * @returns {Object} 搜索结果 { models, totalCount }
   */
  async searchModels(query) {
    try {
      // 如果查询中不包含 "gguf"，自动追加
      const searchQuery = query.toLowerCase().includes('gguf') ? query : `${query} gguf`;

      const response = await axios.post(
        'https://www.modelscope.cn/api/v1/dolphin/model/suggestv2',
        {
          PageSize: 30,
          PageNumber: 1,
          SortBy: 'Default',
          Target: '',
          SingleCriterion: [],
          Name: searchQuery
        },
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      if (response.data.Code !== 200 || !response.data.Success) {
        throw new Error('搜索失败');
      }

      const suggests = response.data.Data?.Model?.Suggests || [];
      const totalCount = response.data.Data?.Model?.TotalCount || 0;

      const models = suggests.map(item => ({
        id: item.Id,
        name: item.Name,
        path: item.Path,
        description: item.ChineseName || '',
        url: `https://www.modelscope.cn/models/${item.Path}/${item.Name}`
      }));

      return {
        models,
        totalCount
      };
    } catch (error) {
      if (error.message) {
        throw error;
      } else {
        throw new Error('搜索失败，请稍后重试');
      }
    }
  }
}

export default new ModelscopeParser();
