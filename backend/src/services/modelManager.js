import fs from 'fs';
import path from 'path';
import { readJSON, writeJSON, generateId } from '../utils/fileHelper.js';
import { MODELS_DIR, MODELS_RUN_DIR, MODEL_STATUS } from '../config/constants.js';

class ModelManager {
  constructor() {
    this.models = {
      llm: [],
      comfyui: [],
      tts: [],
      whisper: []
    };
  }

  async init() {
    for (const type of Object.keys(this.models)) {
      const filePath = path.join(MODELS_DIR, `${type}.json`);
      const data = await readJSON(filePath);
      if (data) {
        this.models[type] = data.models || [];
      } else {
        await this.saveType(type);
      }
    }
  }

  async saveType(type) {
    const filePath = path.join(MODELS_DIR, `${type}.json`);
    await writeJSON(filePath, { models: this.models[type] });
  }

  getAll() {
    return Object.values(this.models).flat();
  }

  getByType(type) {
    return this.models[type] || [];
  }

  getById(id) {
    for (const models of Object.values(this.models)) {
      const model = models.find(m => m.id === id);
      if (model) return model;
    }
    return null;
  }

  async create(type, modelData) {
    const model = {
      id: generateId(),
      type,
      downloaded: false,
      status: MODEL_STATUS.STOPPED,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...modelData
    };

    this.models[type].push(model);
    await this.saveType(type);
    return model;
  }

  async update(id, updates) {
    for (const type of Object.keys(this.models)) {
      const index = this.models[type].findIndex(m => m.id === id);
      if (index !== -1) {
        this.models[type][index] = {
          ...this.models[type][index],
          ...updates,
          updated_at: new Date().toISOString()
        };
        await this.saveType(type);
        return this.models[type][index];
      }
    }
    return null;
  }

  async delete(id) {
    for (const type of Object.keys(this.models)) {
      const index = this.models[type].findIndex(m => m.id === id);
      if (index !== -1) {
        this.models[type].splice(index, 1);
        await this.saveType(type);
        return true;
      }
    }
    return false;
  }

  search(query) {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(model =>
      model.name.toLowerCase().includes(lowerQuery) ||
      model.description?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 扫描模型目录，返回实际下载的文件列表（新版本）
   * 不再使用正则提取量化标识，直接记录文件信息
   */
  async scanDownloadedFiles(modelId) {
    const model = this.getById(modelId);
    if (!model) {
      return [];
    }

    const modelDir = path.join(MODELS_RUN_DIR, model.type, model.id);

    // 检查目录是否存在
    if (!fs.existsSync(modelDir)) {
      console.log(`  ⚠ 模型目录不存在: ${modelDir}`);
      return [];
    }

    const files = fs.readdirSync(modelDir);
    const ggufFiles = files.filter(f =>
      f.endsWith('.gguf') &&
      !f.startsWith('mmproj')
    );

    console.log(`  找到 ${ggufFiles.length} 个 .gguf 文件`);

    return ggufFiles.map(filename => {
      const filePath = path.join(modelDir, filename);
      const stats = fs.statSync(filePath);

      // 尝试匹配预设（可选）
      let matchedPreset = null;
      if (model.quantizations) {
        const preset = model.quantizations.find(q => {
          // 优先使用配置的 filename
          if (q.filename && filename === q.filename) {
            return true;
          }
          // 否则尝试通配符匹配
          const pattern = q.filename || `*${q.name}*.gguf`;
          const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
          return regex.test(filename);
        });
        matchedPreset = preset?.name || null;
      }

      return {
        filename,
        size: stats.size,
        downloaded_at: stats.birthtime.toISOString(),
        matched_preset: matchedPreset,
        is_active: false  // 默认不激活
      };
    });
  }

  /**
   * 扫描模型目录，检测已下载的量化版本（旧版本，兼容保留）
   */
  async scanDownloadedQuantizations(modelId) {
    const model = this.getById(modelId);
    if (!model) {
      return [];
    }

    const modelDir = path.join(MODELS_RUN_DIR, model.type, model.id);

    // 检查目录是否存在
    if (!fs.existsSync(modelDir) || !fs.statSync(modelDir).isDirectory()) {
      console.log(`  ⚠ 模型目录不存在: ${modelDir}`);
      return [];
    }

    // 只扫描根目录的文件（扁平化结构）
    const files = fs.readdirSync(modelDir);
    const ggufFiles = files.filter(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));
    const downloadedQuantizations = [];

    console.log(`  找到 ${ggufFiles.length} 个 .gguf 文件`);

    for (const fileName of ggufFiles) {
      // 从文件名中提取量化版本
      // 支持多种格式:
      // - Q4_K_M (带下划线)
      // - Q4KM (不带下划线)
      // - BF16, F16, F32
      const match = fileName.match(/[-_](Q\d+[_]?[KM0]+[_]?[MS]?|BF16|F16|F32|IQ\d+[_]?[XSML]+)/i);
      if (match) {
        let quantName = match[1].toUpperCase();

        // 标准化格式：统一转换为带下划线的格式
        // Q4KM -> Q4_K_M
        // Q4K -> Q4_K
        quantName = quantName
          .replace(/^(Q\d+)([KM])([MS]?)$/, '$1_$2_$3')  // Q4KM -> Q4_K_M
          .replace(/^(Q\d+)_([KM])_$/, '$1_$2')          // Q4_K_ -> Q4_K
          .replace(/^(IQ\d+)([XSML]+)$/, '$1_$2');       // IQ3XXS -> IQ3_XXS

        console.log(`  检测到文件 ${fileName} -> 量化版本: ${quantName}`);

        if (!downloadedQuantizations.includes(quantName)) {
          downloadedQuantizations.push(quantName);
        }
      } else {
        console.log(`  ⚠ 无法识别的文件名格式: ${fileName}`);
      }
    }

    console.log(`✓ 模型 ${model.id} 已下载的量化版本:`, downloadedQuantizations);
    return downloadedQuantizations;
  }

  /**
   * 扫描所有模型，同步已下载的文件列表（新版本）
   */
  async syncAllDownloadedFiles() {
    console.log('同步所有模型的下载文件...');

    for (const model of this.getAll()) {
      const scannedFiles = await this.scanDownloadedFiles(model.id);

      // 保留旧的 is_active 状态
      const existingFiles = model.downloaded_files || [];
      const activeFile = existingFiles.find(f => f.is_active);

      // 如果有激活的文件，保持激活状态
      if (activeFile) {
        const file = scannedFiles.find(f => f.filename === activeFile.filename);
        if (file) file.is_active = true;
      } else if (scannedFiles.length > 0) {
        // 否则激活第一个文件
        scannedFiles[0].is_active = true;
      }

      await this.update(model.id, {
        downloaded_files: scannedFiles,
        downloaded: scannedFiles.length > 0
      });
    }

    console.log('✓ 文件同步完成');
  }

  /**
   * 扫描所有模型，同步已下载的量化版本列表（旧版本，兼容保留）
   */
  async syncAllDownloadedQuantizations() {
    console.log('开始扫描所有模型的已下载量化版本...');
    let updatedCount = 0;

    for (const model of this.getAll()) {
      if (model.quantizations && model.quantizations.length > 0) {
        const scannedQuantizations = await this.scanDownloadedQuantizations(model.id);

        // 更新模型配置
        const currentQuantizations = model.downloaded_quantizations || [];
        const needsUpdate = JSON.stringify(scannedQuantizations.sort()) !== JSON.stringify(currentQuantizations.sort());

        if (needsUpdate) {
          await this.update(model.id, {
            downloaded_quantizations: scannedQuantizations,
            downloaded: scannedQuantizations.length > 0
          });
          updatedCount++;
          console.log(`  ✓ 更新模型 ${model.id}: ${scannedQuantizations.join(', ')}`);
        }
      }
    }

    if (updatedCount > 0) {
      console.log(`✓ 已同步 ${updatedCount} 个模型的量化版本信息`);
    } else {
      console.log('✓ 所有模型的量化版本信息已是最新');
    }
  }
}

export default new ModelManager();
