/**
 * 管理员工具：从 ModelScope 抓取模型信息并添加到配置
 * 支持自动识别量化版本
 * 使用方式：node admin/add-model-from-modelscope.js <modelId> <type>
 * 例如：node admin/add-model-from-modelscope.js unsloth/Qwen3.5-4B-GGUF llm
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_DIR = path.join(__dirname, '../../data/models');

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

// 量化类型分类
const QUANTIZATION_CATEGORIES = {
  'original': { label: '原始精度', order: 1 },
  'high': { label: '高质量', order: 2 },
  'balanced': { label: '平衡推荐', order: 3 },
  'compressed': { label: '极致压缩', order: 4 },
  'ultra_compressed': { label: '超级压缩', order: 5 }
};

async function fetchModelInfo(modelId) {
  console.log(`正在获取模型信息: ${modelId}`);

  // 1. 获取模型基本信息
  const infoUrl = `https://www.modelscope.cn/api/v1/models/${modelId}`;
  const infoResponse = await axios.get(infoUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  const modelData = infoResponse.data.Data;

  // 2. 获取模型文件列表
  const filesUrl = `https://www.modelscope.cn/api/v1/models/${modelId}/repo/files`;
  const filesResponse = await axios.get(filesUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  const files = filesResponse.data.Data.Files;

  // 3. 尝试获取 README 内容作为描述
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
}

/**
 * 从文件名提取量化类型
 */
function extractQuantizationType(filename) {
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
 */
function generateQuantizations(files, modelId) {
  // 筛选 GGUF 模型文件（排除 mmproj）
  const ggufFiles = files.filter(f =>
    f.Name?.toLowerCase().endsWith('.gguf') &&
    !f.Name.toLowerCase().includes('mmproj')
  );

  const quantizations = [];

  for (const file of ggufFiles) {
    const quantType = extractQuantizationType(file.Name);
    if (!quantType) {
      console.warn(`⚠ 无法识别量化类型: ${file.Name}`);
      continue;
    }

    // 获取量化信息（如果没有，使用默认值）
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
 * 生成 mmproj 选项
 */
function generateMmprojOptions(files, modelId) {
  const mmprojFiles = files.filter(f =>
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

function generateModelConfig(modelId, type, modelData, files, description) {
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
    const quantizations = generateQuantizations(files, modelId);
    const mmprojOptions = generateMmprojOptions(files, modelId);

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
      files: defaultQuant ? {
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
      downloads: modelData.Downloads || 0
    };
  }

  // 其他类型的配置可以在这里扩展
  return baseConfig;
}

async function addModelToConfig(modelId, type) {
  try {
    // 验证类型
    const validTypes = ['llm', 'comfyui', 'tts', 'whisper'];
    if (!validTypes.includes(type)) {
      throw new Error(`无效的模型类型: ${type}. 必须是: ${validTypes.join(', ')}`);
    }

    // 获取模型信息
    const { modelData, files, description } = await fetchModelInfo(modelId);
    console.log(`✓ 获取到 ${files.length} 个文件`);

    // 生成配置
    const config = generateModelConfig(modelId, type, modelData, files, description);
    console.log(`✓ 生成配置完成`);

    // 读取现有配置
    const configFile = path.join(MODELS_DIR, `${type}.json`);
    let existingConfig = { models: [] };

    if (fs.existsSync(configFile)) {
      existingConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    }

    // 检查是否已存在
    const existingIndex = existingConfig.models.findIndex(m => m.id === config.id);
    if (existingIndex >= 0) {
      console.log(`⚠ 模型已存在，将更新配置`);
      existingConfig.models[existingIndex] = config;
    } else {
      console.log(`✓ 添加新模型`);
      existingConfig.models.push(config);
    }

    // 保存配置
    fs.writeFileSync(configFile, JSON.stringify(existingConfig, null, 2));
    console.log(`✓ 配置已保存到: ${configFile}`);

    // 打印摘要
    console.log('\n模型配置摘要:');
    console.log(`  ID: ${config.id}`);
    console.log(`  名称: ${config.name}`);
    console.log(`  类型: ${config.type}`);

    if (config.quantizations) {
      console.log(`  量化版本数: ${config.quantizations.length}`);
      console.log('  可用量化版本:');

      // 按分类显示
      const byCategory = {};
      config.quantizations.forEach(q => {
        if (!byCategory[q.category]) byCategory[q.category] = [];
        byCategory[q.category].push(q);
      });

      Object.entries(byCategory).forEach(([category, quants]) => {
        const categoryLabel = QUANTIZATION_CATEGORIES[category]?.label || category;
        console.log(`    ${categoryLabel}:`);
        quants.forEach(q => {
          const marker = q.recommended ? ' ⭐' : '';
          console.log(`      - ${q.label}${marker}`);
        });
      });

      const defaultQuant = config.quantizations.find(q => q.name === config.selected_quantization);
      if (defaultQuant) {
        console.log(`  默认选择: ${defaultQuant.label} ⭐`);
      }
    }

    if (config.mmproj_options && config.mmproj_options.length > 0) {
      console.log(`  多模态投影文件: ${config.mmproj_options.length} 个`);
    }

    return config;
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

// 命令行参数
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('使用方式: node add-model-from-modelscope.js <modelId> <type>');
  console.log('例如: node add-model-from-modelscope.js unsloth/Qwen3.5-4B-GGUF llm');
  console.log('');
  console.log('支持的类型: llm, comfyui, tts, whisper');
  process.exit(1);
}

const [modelId, type] = args;
addModelToConfig(modelId, type);
