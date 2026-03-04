import express from 'express';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';
import downloadStateManager from '../services/downloadStateManager.js';
import { MODELS_RUN_DIR, DOWNLOADS_DIR } from '../config/constants.js';

const router = express.Router();

router.get('/models', async (req, res) => {
  try {
    const models = modelManager.getAll();
    const allDownloadStates = downloadStateManager.getAllStates();

    // 实时从进程管理器和下载状态管理器获取状态
    const modelsWithStatus = models.map(model => {
      const processStatus = processManager.getStatus(model.id);
      const downloadState = allDownloadStates[model.id];

      return {
        ...model,
        // 进程状态（实时）
        status: processStatus.running ? 'running' : 'stopped',
        port: processStatus.port || null,
        // 下载状态（实时，从内存）
        download_status: downloadState?.status || null,
        download_progress: downloadState?.progress || 0,
        download_error: downloadState?.error || null,
        downloading_quantization: downloadState?.targetQuantization || null
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

    // 实时从进程管理器和下载状态管理器获取状态
    const processStatus = processManager.getStatus(model.id);
    const downloadState = downloadStateManager.getState(model.id);

    const modelWithStatus = {
      ...model,
      // 进程状态（实时）
      status: processStatus.running ? 'running' : 'stopped',
      port: processStatus.port || null,
      // 下载状态（实时，从内存）
      download_status: downloadState?.status || null,
      download_progress: downloadState?.progress || 0,
      download_error: downloadState?.error || null,
      downloading_quantization: downloadState?.targetQuantization || null
    };
    res.json(modelWithStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/models/type/:type', async (req, res) => {
  try {
    const models = modelManager.getByType(req.params.type);
    const allDownloadStates = downloadStateManager.getAllStates();

    // 实时从进程管理器和下载状态管理器获取状态
    const modelsWithStatus = models.map(model => {
      const processStatus = processManager.getStatus(model.id);
      const downloadState = allDownloadStates[model.id];

      return {
        ...model,
        // 进程状态（实时）
        status: processStatus.running ? 'running' : 'stopped',
        port: processStatus.port || null,
        // 下载状态（实时，从内存）
        download_status: downloadState?.status || null,
        download_progress: downloadState?.progress || 0,
        download_error: downloadState?.error || null,
        downloading_quantization: downloadState?.targetQuantization || null
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
          // 更新 files 字段指向新的量化版本
          updates.files = {
            model: selectedQuant.file,
            mmproj: model.mmproj_options && model.mmproj_options.length > 0
              ? model.mmproj_options.find(m => m.name === model.selected_mmproj) || model.mmproj_options[0]
              : null
          };
          console.log('📂 更新 files 字段:', updates.files.model.name);
        }
      }
    }

    const updatedModel = await modelManager.update(req.params.id, updates);
    if (!updatedModel) {
      return res.status(404).json({ error: 'Model not found' });
    }
    console.log('✅ 模型更新成功:', updatedModel.id);
    res.json(updatedModel);
  } catch (error) {
    console.error('❌ 更新模型失败:', error);
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
    const runtimeDir = path.join(MODELS_RUN_DIR, model.type, req.params.id);
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      console.log(`✓ 已删除运行时文件: ${runtimeDir}`);
    }

    // 删除下载目录中的所有量化版本文件
    const downloadDir = path.join(DOWNLOADS_DIR, model.type, req.params.id);
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

// 删除模型（包括配置）
router.delete('/models/:id', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 删除文件
    const runtimeDir = path.join(MODELS_RUN_DIR, model.type, req.params.id);
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }

    const downloadDir = path.join(DOWNLOADS_DIR, model.type, req.params.id);
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

// 设置激活的文件
router.post('/models/:id/set-active-file', async (req, res) => {
  try {
    const { filename } = req.body;
    const model = modelManager.getById(req.params.id);

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const downloadedFiles = model.downloaded_files || [];

    // 检查文件是否存在
    const fileExists = downloadedFiles.some(f => f.filename === filename);
    if (!fileExists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // 更新激活状态
    const updatedFiles = downloadedFiles.map(f => ({
      ...f,
      is_active: f.filename === filename
    }));

    await modelManager.update(req.params.id, {
      downloaded_files: updatedFiles
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
