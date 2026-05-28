import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { encrypt } from '../utils/crypto.js';
import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';
import downloadStateManager from '../services/downloadStateManager.js';
import parameterService from '../services/parameterService.js';
import engineManager from '../services/engineManager.js';
import { MODELS_RUN_DIR, DOWNLOADS_DIR, DEFAULT_LLM_PARAMETERS } from '../config/constants.js';
import eventBus from '../services/eventBus.js';
import { getModelPath } from '../utils/pathHelper.js';
import { checkActiveFileIntegrity, calcPartFileProgress } from '../utils/fileIntegrity.js';
import remoteConfigService from '../services/remoteConfigService.js';
import modelscopeParser from '../services/modelscopeParser.js';
import { isEmbeddingModelData, EMBEDDING_PATTERN } from '../utils/modelTypeHelper.js';

const router = express.Router();

/*
 * 检查模型运行状态，运行中禁止删除
 */
function assertModelNotRunning(modelId, res) {
  const processStatus = processManager.getStatus(modelId);
  if (processStatus.running) {
    res.status(400).json({ error: '模型正在运行，无法删除。请先停止模型后再操作。' });
    return false;
  }
  return true;
}

/**
 * 对磁盘恢复的 paused 状态，从 .part 文件推算真实进度
 */
function resolveDownloadProgress(m, primaryDownload) {
  if (!primaryDownload) return 0;
  if (primaryDownload.status === 'paused' && primaryDownload._restoredFromDisk) {
    const modelDir = getModelPath(MODELS_RUN_DIR, m);
    const quantInfo = m.quantizations?.find(q => q.name === primaryDownload.targetQuantization);
    return calcPartFileProgress(modelDir, quantInfo, primaryDownload.targetQuantization);
  }
  return primaryDownload.progress || 0;
}

/**
 * 修复 downloaded_files 为空的已下载模型（遗留数据问题）
 * 扫描磁盘重建文件记录，后台写入 DB，返回修复后的模型对象用于当次响应
 */
async function repairDownloadedFiles(model) {
  if (model.downloaded_files && model.downloaded_files.length > 0) {
    return model;
  }
  try {
    const scannedFiles = await modelManager.scanDownloadedFiles(model.id);
    if (!scannedFiles || scannedFiles.length === 0) return model;

    // 根据 selected_quantization 确定激活文件，否则激活第一个
    const selectedQuant = model.selected_quantization;
    const targetFile = selectedQuant
      ? scannedFiles.find(f => f.matched_preset === selectedQuant)
      : null;
    const fileToActivate = targetFile || scannedFiles[0];
    fileToActivate.is_active = true;

    const downloadedQuantizations = [...new Set(scannedFiles.map(f => f.matched_preset).filter(Boolean))];
    const modelDir = getModelPath(MODELS_RUN_DIR, model);
    const updates = {
      downloaded_files: scannedFiles,
      downloaded_quantizations: downloadedQuantizations,
      local_path: modelDir,
    };
    // 激活文件与 selected_quantization 匹配时，清除 selected_quantization
    if (selectedQuant && fileToActivate.matched_preset === selectedQuant) {
      updates.selected_quantization = null;
    }

    console.log(`[repair] 重建 ${model.id} 的 downloaded_files（${scannedFiles.length} 个文件）`);
    // 后台写入 DB，不阻塞当次响应
    modelManager.update(model.id, updates).then(() => {
      eventBus.broadcast('model-updated', { modelId: model.id });
    }).catch(e => console.error('[repair] DB 更新失败:', e));

    return { ...model, ...updates };
  } catch (e) {
    console.error('[repair] 扫描失败:', e);
    return model;
  }
}

router.get('/models', async (req, res) => {
  try {
    const models = modelManager.getAll();

    const modelsWithStatus = await Promise.all(models.map(async model => {
      let m = await repairDownloadedFiles(model);

      // 修复 local_path 为 null 但已有下载文件的存量数据
      if (!m.local_path && m.downloaded_files && m.downloaded_files.length > 0) {
        const modelDir = getModelPath(MODELS_RUN_DIR, m);
        m = { ...m, local_path: modelDir };
        modelManager.update(m.id, { local_path: modelDir }).catch(e => console.error('[repair] local_path 更新失败:', e));
      }

      const processStatus = processManager.getStatus(m.id);
      const downloadStates = downloadStateManager.getStatesByModel(m.id);
      const primaryDownload = downloadStates[0] || null;

      return {
        ...m,
        status: processStatus.running ? 'running' : processStatus.starting ? 'starting' : 'stopped',
        port: processStatus.port || null,
        download_states: downloadStates,
        download_status: primaryDownload?.status || null,
        download_progress: resolveDownloadProgress(m, primaryDownload),
        download_error: primaryDownload?.error || null,
        downloading_quantization: primaryDownload?.targetQuantization || null,
        active_file_ok: checkActiveFileIntegrity(m)
      };
    }));
    res.json({ models: modelsWithStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/models/:id', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const m = await repairDownloadedFiles(model);
    const processStatus = processManager.getStatus(m.id);
    const downloadStates = downloadStateManager.getStatesByModel(m.id);
    const primaryDownload = downloadStates[0] || null;

    const modelWithStatus = {
      ...m,
      status: processStatus.running ? 'running' : processStatus.starting ? 'starting' : 'stopped',
      port: processStatus.port || null,
      download_states: downloadStates,
      download_status: primaryDownload?.status || null,
      download_progress: resolveDownloadProgress(m, primaryDownload),
      download_error: primaryDownload?.error || null,
      downloading_quantization: primaryDownload?.targetQuantization || null,
      active_file_ok: checkActiveFileIntegrity(m)
    };
    res.json(modelWithStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/models/type/:type', async (req, res) => {
  try {
    const models = modelManager.getByType(req.params.type);

    const modelsWithStatus = await Promise.all(models.map(async model => {
      const m = await repairDownloadedFiles(model);
      const processStatus = processManager.getStatus(m.id);
      const downloadStates = downloadStateManager.getStatesByModel(m.id);
      const primaryDownload = downloadStates[0] || null;

      return {
        ...m,
        status: processStatus.running ? 'running' : processStatus.starting ? 'starting' : 'stopped',
        port: processStatus.port || null,
        download_states: downloadStates,
        download_status: primaryDownload?.status || null,
        download_progress: resolveDownloadProgress(m, primaryDownload),
        download_error: primaryDownload?.error || null,
        downloading_quantization: primaryDownload?.targetQuantization || null,
        active_file_ok: checkActiveFileIntegrity(m)
      };
    }));

    res.json({ models: modelsWithStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加自定义（本地）模型
router.post('/models/custom', async (req, res) => {
  try {
    const { name, local_path, description, type = 'llm' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '模型名称不能为空' });
    }
    if (!local_path || !local_path.trim()) {
      return res.status(400).json({ error: '请选择模型文件夹' });
    }
    if (!fs.existsSync(local_path)) {
      return res.status(400).json({ error: '文件夹不存在，请检查路径' });
    }

    const trimmedName = name.trim();
    const duplicate = modelManager.getAll().find(m => m.name === trimmedName && m.type === type);
    if (duplicate) {
      return res.status(409).json({ error: `已存在同名模型"${trimmedName}"，请使用其他名称` });
    }

    const entries = fs.readdirSync(local_path);
    const ggufFiles = entries.filter(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));
    if (ggufFiles.length === 0) {
      return res.status(400).json({ error: '该文件夹中没有找到 .gguf 文件（mmproj 文件不计入）' });
    }

    const downloaded_files = ggufFiles.map((filename, idx) => {
      const filePath = path.join(local_path, filename);
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch (_) {}
      return { filename, size, is_active: idx === 0, matched_preset: null };
    });

    const quantizations = ggufFiles.map(filename => ({
      name: filename,
      file: { filename }
    }));

    const model = await modelManager.create(type, {
      id: `custom_${trimmedName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_\-]/g, '_')}`,
      name: trimmedName,
      description: description?.trim() || trimmedName,
      source: 'custom',
      local_path,
      downloaded_files,
      quantizations,
      files: { model: downloaded_files[0], mmproj: null },
      parameters: {
        ...DEFAULT_LLM_PARAMETERS,
        port: EMBEDDING_PATTERN.test(trimmedName) ? 1278 : DEFAULT_LLM_PARAMETERS.port
      },
      user_parameters: null,
      user_parameters_version: null
    });

    eventBus.broadcast('model-updated', { modelId: model.id });
    res.json({ success: true, model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/models/whisper-custom', async (req, res) => {
  try {
    const { engine_path, models } = req.body;

    if (!engine_path || !engine_path.trim()) {
      return res.status(400).json({ error: '请选择引擎路径' });
    }
    if (!fs.existsSync(engine_path.trim())) {
      return res.status(400).json({ error: '引擎路径不存在，请检查后重试' });
    }
    if (!Array.isArray(models) || models.length === 0) {
      return res.status(400).json({ error: '请至少添加一个模型' });
    }

    const createdModels = [];

    for (const item of models) {
      const name = item?.name?.trim();
      const modelPath = item?.path?.trim();

      if (!name) {
        return res.status(400).json({ error: '模型名称不能为空' });
      }
      if (!modelPath) {
        return res.status(400).json({ error: '模型路径不能为空' });
      }
      if (!fs.existsSync(modelPath)) {
        return res.status(400).json({ error: `模型文件不存在: ${modelPath}` });
      }

      const duplicate = modelManager.getAll().find(m => m.name === name && m.type === 'whisper');
      if (duplicate) {
        return res.status(409).json({ error: `已存在同名 Whisper 模型"${name}"，请使用其他名称` });
      }

      const size = fs.statSync(modelPath).size;
      const fileName = path.basename(modelPath);

      const model = await modelManager.create('whisper', {
        id: `whisper_custom_${name.replace(/[^a-zA-Z0-9一-龥_\-]/g, '_')}`,
        name,
        description: name,
        source: 'custom',
        path: modelPath,
        engine_path: engine_path.trim(),
        local_path: path.dirname(modelPath),
        downloaded_files: [
          {
            filename: fileName,
            size,
            is_active: true,
            matched_preset: null
          }
        ],
        quantizations: [
          {
            name: fileName,
            file: { filename: fileName }
          }
        ],
        files: {
          model: {
            filename: fileName,
            size,
            is_active: true
          },
          mmproj: null
        }
      });

      createdModels.push(model);
      eventBus.broadcast('model-updated', { modelId: model.id });
    }

    res.json({ success: true, models: createdModels });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/models/cloudapi', async (req, res) => {
  try {
    const { name, api_base_url, api_key, api_model, description, cloud_platform } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '模型名称不能为空' });
    }
    if (!api_base_url || !api_base_url.trim()) {
      return res.status(400).json({ error: 'API基础URL不能为空' });
    }
    if (!api_key || !api_key.trim()) {
      return res.status(400).json({ error: 'API密钥不能为空' });
    }
    if (!api_model || !api_model.trim()) {
      return res.status(400).json({ error: 'API模型标识不能为空' });
    }

    const trimmedName = name.trim();
    const targetId = `cloudapi_${trimmedName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_\-]/g, '_')}`;
    const duplicate = modelManager.getAll().find(m => m.name === trimmedName && m.type === 'llm');
    if (duplicate) {
      return res.status(409).json({ error: `已存在同名模型"${trimmedName}"，请使用其他名称` });
    }

    const model = await modelManager.create('llm', {
      id: targetId,
      name: trimmedName,
      description: description?.trim() || trimmedName,
      source: 'cloudapi',
      cloud_platform: cloud_platform || '',
      api_base_url: api_base_url.trim(),
      api_key: encrypt(api_key.trim()),
      api_model: api_model.trim(),
    });

    eventBus.broadcast('model-updated', { modelId: model.id });
    res.json({ success: true, model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/models/cloudapi/test', async (req, res) => {
  try {
    const { api_base_url, api_key, api_model } = req.body;

    if (!api_base_url || !api_base_url.trim()) {
      return res.status(400).json({ error: 'API基础URL不能为空' });
    }
    if (!api_key || !api_key.trim()) {
      return res.status(400).json({ error: 'API密钥不能为空' });
    }
    if (!api_model || !api_model.trim()) {
      return res.status(400).json({ error: 'API模型标识不能为空' });
    }

    const tempModel = {
      api_base_url: api_base_url.trim(),
      api_model: api_model.trim(),
      api_key: encrypt(api_key.trim()),
    };

    await processManager.testCloudApiConnection(tempModel);

    res.json({ success: true, message: '云API连接测试成功' });
  } catch (error) {
    res.status(500).json({ error: error.message || '连接测试失败' });
  }
});

router.post('/models', async (req, res) => {
  try {
    const { type, ...modelData } = req.body;

    // 检查是否已存在相同 modelscope_id 的模型
    if (modelData.modelscope_id) {
      const existing = modelManager.getAll().find(
        m => m.modelscope_id === modelData.modelscope_id && m.type === type
      );
      if (existing) {
        return res.status(409).json({ error: `模型已存在：${existing.modelscope_id}` });
      }
    }

    const model = await modelManager.create(type, modelData);
    res.json(model);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/models/:id', async (req, res) => {
  try {
    const updates = req.body;
    console.log('📝 更新模型请求:', req.params.id, updates);

    const currentModel = modelManager.getById(req.params.id);
    if (!currentModel) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 修改名称时检查唯一性
    if (updates.name) {
      const trimmedName = updates.name.trim();
      if (!trimmedName) {
        return res.status(400).json({ error: '模型名称不能为空' });
      }
      const duplicate = modelManager.getAll().find(m => m.id !== req.params.id && m.name === trimmedName && m.type === currentModel.type);
      if (duplicate) {
        return res.status(409).json({ error: `已存在同名模型"${trimmedName}"，请使用其他名称` });
      }
      updates.name = trimmedName;
    }

    // 开启自动启动时检查端口是否已被其他模型占用
    if (updates.auto_start === true) {
      const isEmbedding = isEmbeddingModelData(currentModel);
      const currentParams = parameterService.getEffectiveParameters(currentModel);
      const currentPort = currentParams.port || (isEmbedding ? 1278 : 1234);

      const conflictModel = modelManager.getAll().find(m => {
        if (m.id === req.params.id || !m.auto_start) return false;
        if (m.type !== 'llm') return false;
        const isEmb = isEmbeddingModelData(m);
        const p = parameterService.getEffectiveParameters(m);
        return (p.port || (isEmb ? 1278 : 1234)) === currentPort;
      });

      if (conflictModel) {
        return res.status(409).json({
          error: `端口冲突！模型 "${conflictModel.name}" 已启用自动启动并使用端口 ${currentPort}。\n\n请先更改当前模型的端口号，然后重试启用自动启动。`,
          conflict_model: conflictModel.name,
          port: currentPort
        });
      }
    }

    // 如果更新了 selected_quantization，同步更新 files 字段
    if (updates.selected_quantization) {
      const model = modelManager.getById(req.params.id);
      console.log('📦 当前模型:', model ? model.id : 'not found');
      console.log('📊 模型有量化版本?', !!model?.quantizations);
      console.log('📊 量化版本数量:', model?.quantizations?.length || 0);

      if (model && model.quantizations) {
        const selectedQuant = model.quantizations.find(q => q.name === updates.selected_quantization);
        console.log('✅ 找到选择的量化版本:', selectedQuant ? selectedQuant.name : 'not found');

        if (selectedQuant) {
          if (selectedQuant.is_folder) {
            // 文件夹类型量化版本，不需要更新 files 字段
            console.log('📂 文件夹类型量化版本，跳过 files 更新:', selectedQuant.folder_path);
          } else if (selectedQuant.file) {
            // 更新 files 字段指向新的量化版本
            updates.files = {
              model: selectedQuant.file,
              mmproj: model.mmproj_options && model.mmproj_options.length > 0
                ? model.mmproj_options.find(m => m.name === model.selected_mmproj) || model.mmproj_options[0]
                : null
            };
            console.log('📂 更新 files 字段:', updates.files.model?.name || updates.files.model);
          } else {
            console.log('⚠️ 量化版本没有 file 属性，跳过 files 更新');
          }
        }
      }

      // 设置selected_quantization时，清除所有已下载文件的active状态（已下载和未下载只能有一个默认）
      if (model && model.downloaded_files && model.downloaded_files.length > 0) {
        updates.downloaded_files = model.downloaded_files.map(f => ({
          ...f,
          is_active: false
        }));
        console.log('🔄 清除所有已下载文件的active状态');
      }
    }

    // Whisper 字段归一化
    if (currentModel.type === 'whisper') {
      if (Object.prototype.hasOwnProperty.call(updates, 'engine_version')) {
        updates.engine_version = updates.engine_version ? String(updates.engine_version).trim() : null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'engine_path')) {
        updates.engine_path = updates.engine_path ? String(updates.engine_path).trim() : null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'whisper_config')) {
        const cfg = updates.whisper_config && typeof updates.whisper_config === 'object' ? updates.whisper_config : {};
        const normalized = {};
        if (cfg.threads !== undefined) normalized.threads = Number(cfg.threads) || 8;
        if (cfg.language !== undefined) normalized.language = String(cfg.language || 'auto');
        if (cfg.enable_vad !== undefined) normalized.enable_vad = cfg.enable_vad === true;
        if (cfg.whisper_port !== undefined) normalized.whisper_port = Number(cfg.whisper_port) || 18181;
        if (cfg.flask_port !== undefined) normalized.flask_port = Number(cfg.flask_port) || 8281;
        updates.whisper_config = normalized;
      }
    }

    // TTS 字段归一化
    if (currentModel.type === 'tts') {
      if (Object.prototype.hasOwnProperty.call(updates, 'tts_config')) {
        const cfg = updates.tts_config && typeof updates.tts_config === 'object' ? updates.tts_config : {};
        const normalized = {};
        if (cfg.api_port !== undefined) normalized.api_port = Number(cfg.api_port) || 7863;
        if (cfg.webui_port !== undefined) normalized.webui_port = Number(cfg.webui_port) || 7864;
        if (cfg.workers !== undefined) normalized.workers = Number(cfg.workers) || 1;
        if (cfg.fp16 !== undefined) normalized.fp16 = cfg.fp16 === true;
        updates.tts_config = normalized;
      }
    }

    // 如果更新了 api_key（云API模型），需要加密后再存储
    if (updates.api_key) {
      updates.api_key = encrypt(updates.api_key);
    }

    const updatedModel = await modelManager.update(req.params.id, updates);
    if (!updatedModel) {
      return res.status(404).json({ error: 'Model not found' });
    }
    console.log('✅ 模型更新成功:', updatedModel.id);
    eventBus.broadcast('model-updated', { modelId: req.params.id });
    res.json(updatedModel);
  } catch (error) {
    console.error('❌ 更新模型失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除指定量化版本的文件
router.delete('/models/:id/quantization', async (req, res) => {

  try {
    const { filename } = req.body;
    const model = modelManager.getById(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    // 检查运行状态，运行中禁止删除
    if (!assertModelNotRunning(req.params.id, res)) return;
    if (!filename) return res.status(400).json({ error: 'filename is required' });

    // 删除运行时目录中的文件
    const runtimeFile = path.join(getModelPath(MODELS_RUN_DIR, model), filename);
    if (fs.existsSync(runtimeFile)) {
      fs.unlinkSync(runtimeFile);
      console.log(`✓ 已删除文件: ${runtimeFile}`);
    }

    // 删除下载目录中的文件
    const downloadFile = path.join(getModelPath(DOWNLOADS_DIR, model), filename);
    if (fs.existsSync(downloadFile)) {
      fs.unlinkSync(downloadFile);
      console.log(`✓ 已删除下载文件: ${downloadFile}`);
    }

    // 更新 downloaded_files，移除该文件
    const existingFiles = model.downloaded_files || [];
    const deletedFile = existingFiles.find(f => f.filename === filename);
    let updatedFiles = existingFiles.filter(f => f.filename !== filename);

    // 如果删除的是激活文件，将该量化版本设为 selected_quantization（保持默认不变，只是回到未下载状态）
    let newSelectedQuantization = model.selected_quantization;
    if (deletedFile?.is_active) {
      // 不再自动激活其他文件，而是保留该预设为默认
      if (deletedFile.matched_preset) {
        newSelectedQuantization = deletedFile.matched_preset;
      }
    }

    // 同步更新 downloaded_quantizations，移除被删文件对应的量化版本名
    let updatedQuantizations = model.downloaded_quantizations || [];
    if (deletedFile?.matched_preset) {
      // 只有当没有其他文件也匹配同一个预设时才移除
      const otherFileWithSamePreset = updatedFiles.some(f => f.matched_preset === deletedFile.matched_preset);
      if (!otherFileWithSamePreset) {
        updatedQuantizations = updatedQuantizations.filter(q => q !== deletedFile.matched_preset);
      }
    }

    // 清除该量化版本的下载状态（允许重新下载）
    if (deletedFile?.matched_preset) {
      downloadStateManager.deleteState(req.params.id, deletedFile.matched_preset);
    }

    await modelManager.update(req.params.id, {
      downloaded_files: updatedFiles,
      downloaded_quantizations: updatedQuantizations,
      selected_quantization: newSelectedQuantization
    });

    res.json({ success: true, message: '量化版本文件已删除' });
  } catch (error) {
    console.error('删除量化版本文件失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清理模型文件（不删除配置）
router.delete('/models/:id/files', async (req, res) => {

  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    // 检查运行状态，运行中禁止删除
    if (!assertModelNotRunning(req.params.id, res)) return;

    // 删除运行时目录中的所有量化版本文件
    const runtimeDir = getModelPath(MODELS_RUN_DIR, model);
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      console.log(`✓ 已删除运行时文件: ${runtimeDir}`);
    }

    // 删除下载目录中的所有量化版本文件
    const downloadDir = getModelPath(DOWNLOADS_DIR, model);
    if (fs.existsSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursive: true, force: true });
      console.log(`✓ 已删除下载文件: ${downloadDir}`);
    }

    // 只更新持久字段（不涉及临时下载状态）
    await modelManager.update(req.params.id, {
      downloaded_files: [],
      downloaded_quantizations: [],
      local_path: null
    });

    res.json({ success: true, message: '所有量化版本文件已清理，配置已保留' });
  } catch (error) {
    console.error('清理文件失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 只删除卡片配置，不删除模型文件
router.delete('/models/:id/config', async (req, res) => {
  try {
    // 检查运行状态，运行中禁止删除
    if (!assertModelNotRunning(req.params.id, res)) return;
    const success = await modelManager.delete(req.params.id);
    if (!success) return res.status(404).json({ error: 'Model not found' });
    res.json({ success: true, message: '卡片已删除，模型文件保留' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除模型（包括配置）
router.delete('/models/:id', async (req, res) => {  try {

    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    // 检查运行状态，运行中禁止删除
    if (!assertModelNotRunning(req.params.id, res)) return;

    // 删除文件
    const runtimeDir = getModelPath(MODELS_RUN_DIR, model);
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }

    const downloadDir = getModelPath(DOWNLOADS_DIR, model);
    if (fs.existsSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursive: true, force: true });
    }

    // ComfyUI: 清理 workflows 目录下对应的工作流 JSON 文件
    if (model.type === 'comfyui' && model.workflow_filename) {
      const workflowsDir = path.join(MODELS_RUN_DIR, 'comfyui', 'workflows');
      const filePath = path.join(workflowsDir, model.workflow_filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`已删除工作流文件: ${model.workflow_filename}`);
        }
      } catch {}
    }

    // 删除配置
    const success = await modelManager.delete(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Model not found' });
    }

    res.json({ success: true, message: '模型及配置已完全删除' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/models/search', async (req, res) => {
  try {
    const { q } = req.query;
    const models = modelManager.search(q || '');
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 实时扫描模型已下载的量化版本
router.get('/models/:id/downloaded-quantizations', async (req, res) => {
  try {
    const downloadedQuantizations = await modelManager.scanDownloadedQuantizations(req.params.id);
    res.json({ downloadedQuantizations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 扫描模型已下载的文件（新版本）
router.get('/models/:id/scan-files', async (req, res) => {
  try {
    const downloadedFiles = await modelManager.scanDownloadedFiles(req.params.id);
    res.json({ downloadedFiles: downloadedFiles || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 恢复远程默认配置
router.post('/models/:id/restore-defaults', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (model.source !== 'remote') return res.status(400).json({ error: '仅远程模型支持恢复默认' });

    const updates = {};
    if (model.type === 'llm') {
      updates.selected_quantization = null;
    } else if (model.type === 'comfyui') {
      updates.user_parameter_mapping = null;
    }

    const updated = await modelManager.update(req.params.id, updates);
    eventBus.broadcast('model-updated', { modelId: req.params.id });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 从远端刷新单个模型的最新配置（量化列表、sha256 等）
router.post('/models/:id/refresh-remote', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    if (!model.modelscope_id) return res.status(400).json({ error: '仅 ModelScope 模型支持刷新' });

    // 直接从 ModelScope API 拉取最新文件列表（含 SHA256）
    const { modelData, files, description } = await modelscopeParser.fetchModelInfo(model.modelscope_id);
    const quantizations = modelscopeParser.generateQuantizations(files, model.modelscope_id, model.filter_folder || null);
    const mmprojOptions = modelscopeParser.generateMmprojOptions(files, model.modelscope_id);

    // 重新计算 files 字段（指向当前选择的量化版本）
    const selectedQuant = quantizations.find(q => q.name === model.selected_quantization) || quantizations.find(q => q.recommended) || quantizations[0];
    const filesField = selectedQuant && !selectedQuant.is_folder ? {
      model: selectedQuant.file,
      mmproj: mmprojOptions.length > 0 ? mmprojOptions.find(m => m.name === model.files?.mmproj?.name) || mmprojOptions[0] : null
    } : model.files;

    await modelManager.update(model.id, { quantizations, mmproj_options: mmprojOptions, files: filesField, modelscope_refreshed: true });

    const updated = modelManager.getById(req.params.id);
    eventBus.broadcast('model-updated', { modelId: req.params.id });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置激活的文件
router.post('/models/:id/set-active-file', async (req, res) => {
  try {
    const { filename } = req.body;
    const model = modelManager.getById(req.params.id);

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 重新扫描文件以获取正确的 matched_preset（修正历史数据中的错误匹配）
    const scannedFiles = await modelManager.scanDownloadedFiles(req.params.id) || [];

    // 检查文件是否存在
    const fileExists = scannedFiles.some(f => f.filename === filename);
    if (!fileExists) {
      // 回退到已存储的文件列表检查
      const storedExists = (model.downloaded_files || []).some(f => f.filename === filename);
      if (!storedExists) {
        return res.status(404).json({ error: 'File not found' });
      }
    }

    // 使用扫描结果（含正确的 matched_preset），更新激活状态
    const baseFiles = scannedFiles.length > 0 ? scannedFiles : (model.downloaded_files || []);
    const updatedFiles = baseFiles.map(f => ({
      ...f,
      is_active: f.filename === filename
    }));

    // 设置active文件时，清除selected_quantization（已下载和未下载只能有一个默认）
    await modelManager.update(req.params.id, {
      downloaded_files: updatedFiles,
      selected_quantization: null
    });

    eventBus.broadcast('model-updated', { modelId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 异步生成 AI 总结描述
router.post('/models/:id/generate-description', async (req, res) => {
  const modelId = req.params.id;
  const model = modelManager.getById(modelId);

  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const readmeContent = model.readme_content || '';
  if (!readmeContent) {
    return res.json({ success: false, message: '没有 README 内容可供总结' });
  }

  // 标记正在生成
  await modelManager.update(modelId, { description_generating: true });

  // 立即返回，后台异步执行总结
  res.json({ success: true, message: '已开始生成描述' });

  try {
    const summary = await modelscopeParser.summarizeReadme(readmeContent);
    if (summary) {
      await modelManager.update(modelId, {
        description: summary,
        description_generating: false
      });
      eventBus.broadcast('model-updated', { modelId, field: 'description' });
      console.log(`[generate-description] 模型 ${modelId} 描述已更新:`, summary);
    } else {
      await modelManager.update(modelId, { description_generating: false });
    }
  } catch (e) {
    await modelManager.update(modelId, { description_generating: false });
    console.warn(`[generate-description] 模型 ${modelId} 描述生成失败:`, e.message);
  }
});

export default router;
