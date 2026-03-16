import express from 'express';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';
import downloadStateManager from '../services/downloadStateManager.js';
import { MODELS_RUN_DIR, DOWNLOADS_DIR } from '../config/constants.js';
import eventBus from '../services/eventBus.js';
import { getModelPath } from '../utils/pathHelper.js';

const router = express.Router();

router.get('/models', async (req, res) => {
  try {
    const models = modelManager.getAll();

    const modelsWithStatus = models.map(model => {
      const processStatus = processManager.getStatus(model.id);
      const downloadStates = downloadStateManager.getStatesByModel(model.id);
      const primaryDownload = downloadStates[0] || null;

      return {
        ...model,
        status: processStatus.running ? 'running' : 'stopped',
        port: processStatus.port || null,
        download_states: downloadStates,
        download_status: primaryDownload?.status || null,
        download_progress: primaryDownload?.progress || 0,
        download_error: primaryDownload?.error || null,
        downloading_quantization: primaryDownload?.targetQuantization || null
      };
    });
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

    const processStatus = processManager.getStatus(model.id);
    const downloadStates = downloadStateManager.getStatesByModel(model.id);
    const primaryDownload = downloadStates[0] || null;

    const modelWithStatus = {
      ...model,
      status: processStatus.running ? 'running' : 'stopped',
      port: processStatus.port || null,
      download_states: downloadStates,
      download_status: primaryDownload?.status || null,
      download_progress: primaryDownload?.progress || 0,
      download_error: primaryDownload?.error || null,
      downloading_quantization: primaryDownload?.targetQuantization || null
    };
    res.json(modelWithStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/models/type/:type', async (req, res) => {
  try {
    const models = modelManager.getByType(req.params.type);

    const modelsWithStatus = models.map(model => {
      const processStatus = processManager.getStatus(model.id);
      const downloadStates = downloadStateManager.getStatesByModel(model.id);
      const primaryDownload = downloadStates[0] || null;

      return {
        ...model,
        status: processStatus.running ? 'running' : 'stopped',
        port: processStatus.port || null,
        download_states: downloadStates,
        download_status: primaryDownload?.status || null,
        download_progress: primaryDownload?.progress || 0,
        download_error: primaryDownload?.error || null,
        downloading_quantization: primaryDownload?.targetQuantization || null
      };
    });
    res.json({ models: modelsWithStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      downloaded: updatedFiles.length > 0,
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
      downloaded: false,
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

    // 删除文件
    const runtimeDir = getModelPath(MODELS_RUN_DIR, model);
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }

    const downloadDir = getModelPath(DOWNLOADS_DIR, model);
    if (fs.existsSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursive: true, force: true });
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
    res.json({ downloadedFiles });
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

// 设置激活的文件
router.post('/models/:id/set-active-file', async (req, res) => {
  try {
    const { filename } = req.body;
    const model = modelManager.getById(req.params.id);

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 重新扫描文件以获取正确的 matched_preset（修正历史数据中的错误匹配）
    const scannedFiles = await modelManager.scanDownloadedFiles(req.params.id);

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

export default router;
