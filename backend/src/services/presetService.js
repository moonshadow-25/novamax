/**
 * 预设配置服务 - 生成和管理 llama-server INI 配置文件
 */
import fs from 'fs';
import path from 'path';
import { PRESETS_DIR, MODELS_RUN_DIR, MODEL_TYPES } from '../config/constants.js';
import modelManager from './modelManager.js';
import parameterService from './parameterService.js';
import { getModelPath } from '../utils/pathHelper.js';

class PresetService {
  constructor() {
    this.ensurePresetsDir();
  }

  /**
   * 确保 presets 目录存在
   */
  ensurePresetsDir() {
    if (!fs.existsSync(PRESETS_DIR)) {
      fs.mkdirSync(PRESETS_DIR, { recursive: true });
    }
  }

  /**
   * 从模型列表生成 INI 配置文件
   * @param {string} type - 模型类型 (llm, tts, whisper)
   */
  async generatePresetFile(type) {
    const models = modelManager.getByType(type);
    const iniPath = path.join(PRESETS_DIR, `${type}.ini`);

    const iniContent = this._buildIniContent(type, models);
    fs.writeFileSync(iniPath, iniContent, 'utf-8');

    console.log(`✓ 生成预设文件: ${iniPath}`);
    return iniPath;
  }

  /**
   * 构建 INI 文件内容
   */
  _buildIniContent(type, models) {
    const lines = [];

    // 版本号
    lines.push('version = 1.0.0');
    lines.push('');

    // 全局默认配置
    lines.push('; ===== 全局默认配置 =====');
    lines.push('[*]');
    lines.push('');

    // 根据类型设置默认参数
    if (type === MODEL_TYPES.LLM) {
      lines.push('; 运行时参数');
      lines.push('ctx-size = 8192');
      lines.push('gpu-layers = -1');
      lines.push('threads = 8');
      lines.push('parallel = 2');
      lines.push('batch = 512');
      lines.push('ubatch = 512');
      lines.push('flash-attn = auto');
      lines.push('');
      lines.push('; 采样参数');
      lines.push('temperature = 0.7');
      lines.push('top-p = 0.9');
      lines.push('top-k = 40');
      lines.push('repeat-penalty = 1.1');
      lines.push('');
      lines.push('; 服务器参数');
      lines.push('host = 127.0.0.1');
      lines.push('timeout = 600');
      lines.push('');
    }

    // 每个模型的特定配置
    models.forEach(model => {
      if (!model.downloaded && !model.files) {
        return; // 跳过未配置的模型
      }

      lines.push('');
      lines.push(`; ===== ${model.name} =====`);
      lines.push(`[${model.id}]`);

      // 模型路径
      const modelPath = this._getModelPath(model);
      if (modelPath) {
        lines.push(`model = ${modelPath}`);
      }

      // mmproj 路径（多模态）
      if (model.files?.mmproj) {
        const mmprojPath = this._getMmprojPath(model);
        if (mmprojPath) {
          lines.push(`mmproj = ${mmprojPath}`);
        }
      }

      // 模型别名
      if (model.alias) {
        lines.push(`alias = ${model.alias}`);
      }

      // 模型特定参数 - 使用有效参数（默认 + 用户覆盖）
      const effectiveParams = parameterService.getEffectiveParameters(model);

      // 移除内部字段
      const { _source, _version, _note, version, ...params } = effectiveParams;

      if (params.context_length) {
        lines.push(`ctx-size = ${params.context_length}`);
      }
      if (params.gpu_layers !== undefined) {
        lines.push(`gpu-layers = ${params.gpu_layers}`);
      }
      if (params.threads) {
        lines.push(`threads = ${params.threads}`);
      }
      if (params.parallel) {
        lines.push(`parallel = ${params.parallel}`);
      }
      if (params.batch) {
        lines.push(`batch = ${params.batch}`);
      }
      if (params.ubatch) {
        lines.push(`ubatch = ${params.ubatch}`);
      }
      if (params.temperature) {
        lines.push(`temperature = ${params.temperature}`);
      }
      if (params.top_p) {
        lines.push(`top-p = ${params.top_p}`);
      }
      if (params.top_k) {
        lines.push(`top-k = ${params.top_k}`);
      }
      if (params.repeat_penalty) {
        lines.push(`repeat-penalty = ${params.repeat_penalty}`);
      }

      // 自定义参数（所有其他非标准参数）
      const standardKeys = ['context_length', 'gpu_layers', 'threads', 'parallel',
                            'batch', 'ubatch', 'temperature', 'top_p', 'top_k', 'repeat_penalty'];
      Object.entries(params).forEach(([key, value]) => {
        if (!standardKeys.includes(key)) {
          lines.push(`${key} = ${value}`);
        }
      });

      // 默认不自动加载（按需加载）
      lines.push('load-on-startup = false');
      lines.push('stop-timeout = 10');

      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * 获取模型文件路径（扁平化目录结构）
   */
  _getModelPath(model) {
    const modelDir = getModelPath(MODELS_RUN_DIR, model);

    // 检查目录是否存在
    if (!fs.existsSync(modelDir) || !fs.statSync(modelDir).isDirectory()) {
      return null;
    }

    // 只扫描根目录的 .gguf 文件
    const files = fs.readdirSync(modelDir);
    const ggufFiles = files.filter(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));

    if (ggufFiles.length === 0) {
      console.warn(`⚠ 未找到任何 .gguf 模型文件: ${modelDir}`);
      return null;
    }

    // 获取当前选择的量化版本
    const quantization = model.selected_quantization;

    if (quantization) {
      // 查找匹配的量化版本文件
      const modelFile = ggufFiles.find(f => f.includes(quantization));

      if (modelFile) {
        const modelPath = path.join(modelDir, modelFile);
        console.log(`✓ 找到量化版本模型: ${modelFile}`);
        return modelPath;
      }

      console.warn(`⚠ 未找到量化版本 ${quantization} 的模型文件`);
    }

    // 如果没有指定量化版本或未找到，返回第一个找到的 .gguf 文件
    const firstFile = path.join(modelDir, ggufFiles[0]);
    console.log(`✓ 找到模型文件: ${ggufFiles[0]}`);
    return firstFile;
  }

  /**
   * 获取 mmproj 文件路径（扁平化目录结构）
   */
  _getMmprojPath(model) {
    const modelDir = getModelPath(MODELS_RUN_DIR, model);

    if (!fs.existsSync(modelDir) || !fs.statSync(modelDir).isDirectory()) {
      return null;
    }

    // 只扫描根目录
    const files = fs.readdirSync(modelDir);
    const mmprojFile = files.find(f => f.startsWith('mmproj') && f.endsWith('.gguf'));

    if (mmprojFile) {
      return path.join(modelDir, mmprojFile);
    }

    return null;
  }

  /**
   * 读取 INI 文件版本
   */
  getPresetVersion(type) {
    const iniPath = path.join(PRESETS_DIR, `${type}.ini`);

    if (!fs.existsSync(iniPath)) {
      return '0.0.0';
    }

    const content = fs.readFileSync(iniPath, 'utf-8');
    const versionMatch = content.match(/^version\s*=\s*(.+)$/m);

    return versionMatch ? versionMatch[1].trim() : '1.0.0';
  }

  /**
   * 获取预设文件路径
   */
  getPresetPath(type) {
    return path.join(PRESETS_DIR, `${type}.ini`);
  }

  /**
   * 检查预设文件是否存在
   */
  presetExists(type) {
    return fs.existsSync(this.getPresetPath(type));
  }

  /**
   * 为所有类型生成预设文件
   */
  async generateAllPresets() {
    const types = Object.values(MODEL_TYPES);
    const results = {};

    for (const type of types) {
      try {
        const iniPath = await this.generatePresetFile(type);
        results[type] = { success: true, path: iniPath };
      } catch (error) {
        results[type] = { success: false, error: error.message };
      }
    }

    return results;
  }
}

export default new PresetService();
