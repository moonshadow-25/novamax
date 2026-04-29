import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import configManager from '../services/configManager.js';
import modelManager from '../services/modelManager.js';
import commonDownloader from '../services/commonDownloader.js';
import eventBus from '../services/eventBus.js';
import { DATA_DIR, MODELS_RUN_DIR } from '../config/constants.js';

const router = express.Router();

const uploadDir = path.join(DATA_DIR, 'cache', 'tts-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });

function getTtsBase() {
  const port = configManager.get('ports')?.tts || 7863;
  return `http://127.0.0.1:${port}`;
}

/* ── 语音合成 ── */
router.post('/tts/speech', async (req, res) => {
  try {
    const resp = await fetch(`${getTtsBase()}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(300000)
    });
    if (!resp.ok) return res.status(resp.status).send(await resp.text());
    res.set('Content-Type', resp.headers.get('content-type') || 'audio/wav');
    res.send(Buffer.from(await resp.arrayBuffer()));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ── 音色 ── */
router.get('/tts/voices', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/voices`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.json({ data: [] }); }
});

router.post('/tts/voices', upload.single('file'), async (req, res) => {
  try {
    const fd = new FormData();
    if (req.file) {
      fd.append('file', new Blob([fs.readFileSync(req.file.path)]), req.file.originalname);
    }
    if (req.body.name) fd.append('name', req.body.name);
    if (req.body.description) fd.append('description', req.body.description);
    const r = await fetch(`${getTtsBase()}/v1/audio/voices`, { method: 'POST', body: fd });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
  finally { if (req.file?.path) fs.unlink(req.file.path, () => {}); }
});

router.post('/tts/voices/auto-register', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/voices/auto-register`, { method: 'POST' });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/tts/voices/:voiceId', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/voices/${req.params.voiceId}`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/tts/voices/:voiceId/audio', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/voices/${req.params.voiceId}/audio`);
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.set('Content-Type', r.headers.get('content-type') || 'audio/wav');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.delete('/tts/voices/:voiceId', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/voices/${req.params.voiceId}`, { method: 'DELETE' });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ── 历史 ── */
router.get('/tts/history', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/history`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.json({ data: [] }); }
});

router.get('/tts/history/:itemId/audio', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/history/${req.params.itemId}/audio`);
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.set('Content-Type', r.headers.get('content-type') || 'audio/wav');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.delete('/tts/history/:itemId', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/history/${req.params.itemId}`, { method: 'DELETE' });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.delete('/tts/history', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/audio/history`, { method: 'DELETE' });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ── 健康检查 ── */
router.get('/tts/health', async (req, res) => {
  try {
    const r = await fetch(`${getTtsBase()}/v1/health`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ── 模型文件状态 ── */
router.get('/tts/models/:modelId/files-status', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'tts') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const modelscopeId = (model.models || [])[0]?.download_sources?.modelscope?.match(/models\/([^/]+\/[^/]+)\//)?.[1] || null;
  let repoSizeMap = new Map();

  if (modelscopeId) {
    try {
      const fileRes = await fetch(`https://www.modelscope.cn/api/v1/models/${modelscopeId}/repo/files?Revision=master&Recursive=true&Root=`);
      if (fileRes.ok) {
        const data = await fileRes.json();
        const fileList = data?.Data?.Files || [];
        repoSizeMap = new Map(fileList.filter(f => !f.IsDir).map(f => [f.Path || f.Name, f.Size || 0]));
      }
    } catch {}
  }

  const modelDir = path.join(MODELS_RUN_DIR, 'tts', model.id);
  const files = (model.models || []).map(item => {
    const relPath = item.filename || item.local_path || item.name;
    const filePath = path.join(modelDir, relPath);
    const downloaded = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    const size = item.size || repoSizeMap.get(relPath) || 0;
    return {
      ...item,
      filename: relPath,
      size,
      downloaded,
      active_task: null
    };
  });

  const downloadedCount = files.filter(f => f.downloaded).length;
  res.json({
    success: true,
    files,
    summary: { total: files.length, downloaded: downloadedCount, missing: files.length - downloadedCount }
  });
});

/* ── 下载单个模型文件 ── */
router.post('/tts/models/:modelId/download', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'tts') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const { filename } = req.body;
  const fileInfo = (model.models || []).find(m => (m.filename || m.local_path || m.name) === filename);
  if (!fileInfo) {
    return res.status(400).json({ error: '文件不存在于模型配置中' });
  }

  const url = fileInfo.download_sources?.modelscope;
  if (!url) {
    return res.status(400).json({ error: '该文件没有配置下载源' });
  }

  const modelDir = path.join(MODELS_RUN_DIR, 'tts', model.id);
  fs.mkdirSync(path.dirname(path.join(modelDir, filename)), { recursive: true });

  const modelInfo = {
    filename,
    type: 'tts',
    dest: modelDir,
    original_url: url,
    download_sources: { original: url },
    source_model_id: model.id,
    source_model_name: model.name,
    source_model_type: 'tts'
  };

  const taskId = commonDownloader.startDownload(modelInfo, async (result) => {
    if (result.success) {
      await modelManager.update(model.id, {
        local_path: modelDir
      });
      eventBus.broadcast('model-updated', { modelId: model.id });
    }
  });

  res.json({ success: true, taskId });
});

/* ── 查询下载任务状态 ── */
router.get('/tts/download-status/:taskId', (req, res) => {
  const task = commonDownloader.getTask(req.params.taskId);
  if (!task) {
    return res.json({ success: true, task: { status: 'not_found' } });
  }
  res.json({ success: true, task });
});

/* ── 暂停下载 ── */
router.post('/tts/download-pause/:taskId', async (req, res) => {
  try {
    await commonDownloader.pauseDownload(req.params.taskId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 继续下载 ── */
router.post('/tts/download-resume/:taskId', async (req, res) => {
  try {
    await commonDownloader.resumeDownload(req.params.taskId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 取消下载 ── */
router.post('/tts/download-cancel/:taskId', async (req, res) => {
  try {
    await commonDownloader.cancelDownload(req.params.taskId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
