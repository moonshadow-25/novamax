import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { generateId } from '../utils/fileHelper.js';
import { DB_PATH, MODELS_RUN_DIR } from '../config/constants.js';
import { getModelPath } from '../utils/pathHelper.js';
import { isEmbeddingModelData } from '../utils/modelTypeHelper.js';

class ModelManager {
  constructor() {
    this.models = {
      llm: [],
      comfyui: [],
      tts: [],
      asr: []
    };
    this.db = null;

    // 预编译 SQL 语句（init 后设置）
    this._stmtUpdate = null;
    this._stmtInsert = null;
    this._stmtDelete = null;
  }

  async init() {
    // 确保数据目录存在
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(DB_PATH);

    // WAL 模式 + 建表
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS models (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_models_type ON models(type);
    `);

    // 预编译常用语句
    this._stmtUpdate = this.db.prepare('UPDATE models SET data = ?, updated_at = ? WHERE id = ?');
    this._stmtInsert = this.db.prepare('INSERT INTO models (id, type, data, updated_at) VALUES (?, ?, ?, ?)');
    this._stmtDelete = this.db.prepare('DELETE FROM models WHERE id = ?');

    // 加载所有数据到内存
    this._loadFromDB();

    // 重新计算推荐量化版本
    await this._recalcRecommendations();
  }

  _loadFromDB() {
    const rows = this.db.prepare('SELECT id, type, data FROM models ORDER BY rowid').all();
    this.models = { llm: [], comfyui: [], tts: [], asr: [] };
    for (const row of rows) {
      try {
        const model = JSON.parse(row.data);
        // 归一化：旧 type='whisper' → 'asr'
        if (row.type === 'whisper') { row.type = 'asr'; model.type = 'asr'; this.db.prepare('UPDATE models SET type = ? WHERE id = ?').run('asr', row.id); }
        let dataChanged = false;
        // 归一化：旧 whisper_config → asr_config（同时清除端口字段）
        if (model.whisper_config && !model.asr_config) {
          model.asr_config = model.whisper_config;
          delete model.whisper_config;
          delete model.asr_config.whisper_port;
          delete model.asr_config.flask_port;
          dataChanged = true;
        }
        // 归一化：旧 model.path 中的 models_dir/whisper/ → models_dir/asr/
        if (model.path && (/models_dir[\\/]whisper[\\/]/).test(model.path)) {
          model.path = model.path.replace(/models_dir[\\/]whisper[\\/]/, 'models_dir/asr/');
          dataChanged = true;
        }
        if (dataChanged) {
          this.db.prepare('UPDATE models SET data = ? WHERE id = ?').run(JSON.stringify(model), row.id);
        }
        if (this.models[row.type]) {
          this.models[row.type].push(model);
        }
      } catch (e) {
        console.error(`[DB] 解析模型数据失败 id=${row.id}:`, e.message);
      }
    }
  }

  async _recalcRecommendations() {
    let changed = false;

    for (const type of Object.keys(this.models)) {
      for (const model of this.models[type]) {
        const quants = model.quantizations;
        if (!quants || quants.length === 0) continue;

        quants.forEach(q => { q.recommended = false; });

        const q4km = quants.find(q => q.name.includes('Q4_K_M'));
        const q5km = quants.find(q => q.name.includes('Q5_K_M'));
        if (q4km) q4km.recommended = true;
        else if (q5km) q5km.recommended = true;
        else quants[Math.floor(quants.length / 2)].recommended = true;

        const hasActiveFile = model.downloaded_files?.some(f => f.is_active);
        if (!hasActiveFile && !model.selected_quantization) {
          const rec = quants.find(q => q.recommended);
          if (rec) {
            model.selected_quantization = rec.name;
            changed = true;
          }
        }

        changed = true;
      }
    }

    if (changed) {
      const saveAll = this.db.transaction(() => {
        for (const model of this.getAll()) {
          model.updated_at = model.updated_at || new Date().toISOString();
          this._stmtUpdate.run(JSON.stringify(model), model.updated_at, model.id);
        }
      });
      saveAll();
    }
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

  _isEmbeddingModel(type, modelData) {
    if (type !== 'llm') return false;
    return isEmbeddingModelData(modelData);
  }

  async create(type, modelData) {
    // 归一化：旧 type='whisper' → 'asr'
    if (type === 'whisper') type = 'asr';
    const normalizedModelData = { ...modelData };

    if (type === 'llm') {
      if (normalizedModelData.parameters && typeof normalizedModelData.parameters === 'object' && !Array.isArray(normalizedModelData.parameters)) {
        if (normalizedModelData.parameters.embedding === true) {
          normalizedModelData.embedding = true;
        }
      }

      if (this._isEmbeddingModel(type, normalizedModelData)) {
        const baseParams =
          normalizedModelData.parameters &&
          typeof normalizedModelData.parameters === 'object' &&
          !Array.isArray(normalizedModelData.parameters)
            ? normalizedModelData.parameters
            : {};

        normalizedModelData.parameters = {
          ...baseParams,
          ...(baseParams.embedding === undefined ? { embedding: true } : {})
        };
        normalizedModelData.embedding = true;
      }
    }

    const model = {
      id: generateId(),
      type,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...normalizedModelData
    };

    this._stmtInsert.run(model.id, type, JSON.stringify(model), model.updated_at);
    this.models[type].push(model);
    return model;
  }

  async update(id, updates) {
    for (const type of Object.keys(this.models)) {
      const index = this.models[type].findIndex(m => m.id === id);
      if (index !== -1) {
        const updated = {
          ...this.models[type][index],
          ...updates,
          updated_at: new Date().toISOString()
        };

        if (type === 'llm') {
          if (this._isEmbeddingModel(type, updated)) {
            updated.embedding = true;
          } else {
            delete updated.embedding;
          }
        }

        this._stmtUpdate.run(JSON.stringify(updated), updated.updated_at, id);
        this.models[type][index] = updated;
        return updated;
      }
    }
    return null;
  }

  async delete(id) {
    for (const type of Object.keys(this.models)) {
      const index = this.models[type].findIndex(m => m.id === id);
      if (index !== -1) {
        this._stmtDelete.run(id);
        this.models[type].splice(index, 1);
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
    if (!model) return [];

    const modelDir = getModelPath(MODELS_RUN_DIR, model);

    // 检查目录是否存在
    if (!fs.existsSync(modelDir)) {
      return null; // 返回 null 表示目录不存在，与空数组（目录存在但无文件）区分
    }

    const files = fs.readdirSync(modelDir);
    const ggufFiles = files.filter(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));

    // console.log(`  找到 ${ggufFiles.length} 个 .gguf 文件`);

    const existingFiles = model.downloaded_files || [];

    return ggufFiles.map(filename => {
      const filePath = path.join(modelDir, filename);
      const stats = fs.statSync(filePath);

      // 尝试匹配预设（可选）
      let matchedPreset = null;
      if (model.quantizations) {
        const preset = model.quantizations.find(q => {
          // 优先使用配置的 filename
          if (q.filename && filename === q.filename) return true;
          // 否则尝试通配符匹配
          const pattern = q.filename || `*${q.name}*.gguf`;
          const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
          return regex.test(filename);
        });
        matchedPreset = preset?.name || null;
      }

      // 保留已存储的 is_active 状态
      const existing = existingFiles.find(f => f.filename === filename);
      return {
        filename,
        size: stats.size,
        downloaded_at: stats.birthtime.toISOString(),
        matched_preset: matchedPreset,
        is_active: existing?.is_active || false
      };
    });
  }

  /**
   * 扫描模型目录，检测已下载的量化版本（旧版本，兼容保留）
   */
  async scanDownloadedQuantizations(modelId) {
    const model = this.getById(modelId);
    if (!model) return [];

    const modelDir = getModelPath(MODELS_RUN_DIR, model);
    if (!fs.existsSync(modelDir) || !fs.statSync(modelDir).isDirectory()) {
      return [];
    }

    // 只扫描根目录的文件（扁平化结构）
    const files = fs.readdirSync(modelDir);
    const ggufFiles = files.filter(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));
    const downloadedQuantizations = [];

    // console.log(`  找到 ${ggufFiles.length} 个 .gguf 文件`);

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
          .replace(/^(Q\d+)([KM])([MS]?)$/, '$1_$2_$3')
          .replace(/^(Q\d+)_([KM])_$/, '$1_$2')
          .replace(/^(IQ\d+)([XSML]+)$/, '$1_$2');
        if (!downloadedQuantizations.includes(quantName)) {
          downloadedQuantizations.push(quantName);
        }
      } else {
        console.log(`  ⚠ 无法识别的文件名格式: ${fileName}`);
      }
    }

    // console.log(`✓ 模型 ${model.id} 已下载的量化版本:`, downloadedQuantizations);
    return downloadedQuantizations;
  }

  /**
   * 扫描所有模型，同步已下载的文件列表（新版本）
   */
  async syncAllDownloadedFiles() {
    for (const model of this.getAll()) {
      const scannedFiles = await this.scanDownloadedFiles(model.id);

      // 目录不存在（null）：保留现有记录不覆写，避免外接盘/离线场景丢失数据
      if (scannedFiles === null) continue;

      const existingFiles = model.downloaded_files || [];
      const activeFile = existingFiles.find(f => f.is_active);

      // 把现有记录的 sha256 / file_mtime 等字段合并进扫描结果，避免丢失
      const mergedFiles = scannedFiles.map(f => {
        const prev = existingFiles.find(e => e.filename === f.filename);
        return prev ? { ...prev, ...f } : f;
      });

      if (activeFile) {
        const file = mergedFiles.find(f => f.filename === activeFile.filename);
        if (file) file.is_active = true;
      } else if (mergedFiles.length > 0 && !model.selected_quantization) {
        mergedFiles[0].is_active = true;
      }

      const updates = { downloaded_files: mergedFiles };

      // ASR 模型：自动设置 path（指向已下载的 asr 角色文件）
      if ((model.type === 'asr') && !model.path && model.models?.length) {
        const asrFile = model.models.find(f => f.role === 'asr');
        if (asrFile) {
          const filePath = path.join(MODELS_RUN_DIR, 'asr', model.id, asrFile.filename);
          if (fs.existsSync(filePath)) updates.path = filePath;
        }
      }

      await this.update(model.id, updates);
    }
  }

  /**
   * 扫描所有模型，同步已下载的量化版本列表（旧版本，兼容保留）
   */
  async syncAllDownloadedQuantizations() {
    for (const model of this.getAll()) {
      if (model.quantizations && model.quantizations.length > 0) {
        const scannedQuantizations = await this.scanDownloadedQuantizations(model.id);
        const currentQuantizations = model.downloaded_quantizations || [];
        const needsUpdate = JSON.stringify(scannedQuantizations.sort()) !== JSON.stringify(currentQuantizations.sort());

        if (needsUpdate) {
          await this.update(model.id, {
            downloaded_quantizations: scannedQuantizations
          });
        }
      }
    }
  }
}

export default new ModelManager();
