/**
 * ASR 模型文件管理路由。
 *
 * 模型文件状态查询与下载管理。转录走 /v1/audio/transcriptions（openai-asr.js），
 * 工作区文件与历史走 /api/asr-studio（asr-studio.js）。
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import commonDownloader from '../services/commonDownloader.js';
import eventBus from '../services/eventBus.js';
import { MODELS_RUN_DIR } from '../config/constants.js';

const router = Router();
const ASR_MODELS_DIR = path.join(MODELS_RUN_DIR, 'asr');
fs.mkdirSync(ASR_MODELS_DIR, { recursive: true });

/* ── 模型文件状态 ── */
router.get('/models/:modelId/files-status', (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'asr') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const modelDir = path.join(ASR_MODELS_DIR, model.id);
  const files = (model.models || []).map(item => {
    const filePath = path.join(modelDir, item.filename);
    const downloaded = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    return { ...item, downloaded, active_task: null };
  });

  const downloadedCount = files.filter(f => f.downloaded).length;
  const asrFile = files.find(f => f.role === 'asr' && f.downloaded);
  res.json({
    success: true,
    files,
    summary: { total: files.length, downloaded: downloadedCount, missing: files.length - downloadedCount },
    asr_path: asrFile ? path.join(modelDir, asrFile.filename) : null
  });
});

/* ── 下载单个模型文件 ── */
router.post('/models/:modelId/download', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'asr') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const { filename } = req.body;
  const fileInfo = (model.models || []).find(m => m.filename === filename);
  if (!fileInfo) {
    return res.status(400).json({ error: '文件不存在于模型配置中' });
  }

  const url = fileInfo.download_sources?.modelscope;
  if (!url) {
    return res.status(400).json({ error: '该文件没有配置下载源' });
  }

  const modelDir = path.join(ASR_MODELS_DIR, model.id);
  fs.mkdirSync(modelDir, { recursive: true });

  const modelInfo = {
    filename,
    type: 'asr',
    dest: modelDir,
    original_url: url,
    download_sources: { original: url },
    source_model_id: model.id,
    source_model_name: model.name,
    source_model_type: 'asr'
  };

  const taskId = commonDownloader.startDownload(modelInfo, async (result) => {
    if (result.success) {
      const asrFile = (model.models || []).find(m => m.role === 'asr');
      if (fileInfo.role === 'asr' || !asrFile) {
        await modelManager.update(model.id, {
          path: path.join(modelDir, filename)
        });
      }
      eventBus.broadcast('model-updated', { modelId: model.id });
    }
  });

  res.json({ success: true, taskId });
});

/* ── 删除模型文件 ── */
router.delete('/models/:modelId/files/:filename', async (req, res) => {
  const { modelId, filename } = req.params;
  const model = modelManager.getById(modelId);
  if (!model || model.type !== 'asr') return res.status(404).json({ error: 'Model not found' });
  const filePath = path.join(ASR_MODELS_DIR, modelId, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    // 清除 .download-complete 标记（如果有）
    const markerPath = filePath + '.download-complete';
    if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    eventBus.broadcast('model-updated', { modelId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 下载任务管理 ── */
router.get('/download-status/:taskId', (req, res) => {
  const task = commonDownloader.getTask(req.params.taskId);
  if (!task) return res.json({ success: true, task: { status: 'not_found' } });
  res.json({ success: true, task });
});

router.post('/download-pause/:taskId', async (req, res) => {
  try { await commonDownloader.pauseDownload(req.params.taskId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/download-resume/:taskId', async (req, res) => {
  try { await commonDownloader.resumeDownload(req.params.taskId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/download-cancel/:taskId', async (req, res) => {
  try { await commonDownloader.cancelDownload(req.params.taskId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
