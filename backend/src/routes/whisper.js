import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';
import comfyuiDownloader from '../services/comfyuiDownloader.js';
import eventBus from '../services/eventBus.js';
import { DATA_DIR, MODELS_RUN_DIR } from '../config/constants.js';

const router = express.Router();

const uploadDir = path.join(DATA_DIR, 'cache', 'whisper-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 }
});

function getWhisperBase() {
  const runningPort = processManager.getRunningPortByType('whisper');
  const port = runningPort || 8281;
  return `http://127.0.0.1:${port}`;
}

/**
 * POST /whisper/transcribe
 * 接收音频文件，转发到外部 whisper 服务
 */
router.post('/whisper/transcribe', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    const formData = new FormData();
    formData.append('file', new Blob([fs.readFileSync(req.file.path)]), req.file.originalname);
    formData.append('model', req.body.model || 'whisper-1');
    if (req.body.response_format) formData.append('response_format', req.body.response_format);
    if (req.body.language) formData.append('language', req.body.language);
    if (req.body.temperature) formData.append('temperature', req.body.temperature);
    if (req.body.vad_filter) formData.append('vad_filter', req.body.vad_filter);
    if (req.body.prompt) formData.append('prompt', req.body.prompt);

    const response = await fetch(`${getWhisperBase()}/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300000)
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(502).json({ error: `Whisper server error (${response.status}): ${text}` });
    }

    try {
      res.json(JSON.parse(text));
    } catch {
      res.type('text/plain').send(text);
    }
  } catch (error) {
    console.error(`[whisper] Transcription failed:`, error.message);
    res.status(502).json({ error: `Transcription failed: ${error.message}` });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

/**
 * POST /whisper/translate
 * 接收音频文件，翻译为英文
 */
router.post('/whisper/translate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    const formData = new FormData();
    formData.append('file', new Blob([fs.readFileSync(req.file.path)]), req.file.originalname);
    formData.append('model', req.body.model || 'whisper-1');
    if (req.body.response_format) formData.append('response_format', req.body.response_format);
    if (req.body.temperature) formData.append('temperature', req.body.temperature);

    const response = await fetch(`${getWhisperBase()}/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300000)
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(502).json({ error: `Whisper server error (${response.status}): ${text}` });
    }

    try {
      res.json(JSON.parse(text));
    } catch {
      res.type('text/plain').send(text);
    }
  } catch (error) {
    console.error(`[whisper] Translation failed:`, error.message);
    res.status(502).json({ error: `Translation failed: ${error.message}` });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

/* ── 健康检查 ── */
router.get('/whisper/health', async (req, res) => {
  try {
    const r = await fetch(getWhisperBase(), { signal: AbortSignal.timeout(5000) });
    res.json({ status: r.ok ? 'ok' : 'error' });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

/* ── 模型文件状态 ── */
router.get('/whisper/models/:modelId/files-status', (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'whisper') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const modelDir = path.join(MODELS_RUN_DIR, 'whisper', model.id);
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
router.post('/whisper/models/:modelId/download', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'whisper') {
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

  const modelDir = path.join(MODELS_RUN_DIR, 'whisper', model.id);
  fs.mkdirSync(modelDir, { recursive: true });

  // 构造 modelInfo，dest 指定目标目录
  const modelInfo = {
    filename,
    type: 'whisper',
    dest: modelDir,
    original_url: url,
    download_sources: { original: url }
  };

  const taskId = comfyuiDownloader.startDownload(modelInfo, async (result) => {
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

/* ── 查询下载任务状态 ── */
router.get('/whisper/download-status/:taskId', (req, res) => {
  const task = comfyuiDownloader.getTask(req.params.taskId);
  if (!task) {
    return res.json({ success: true, task: { status: 'not_found' } });
  }
  res.json({ success: true, task });
});

/* ── 暂停下载 ── */
router.post('/whisper/download-pause/:taskId', async (req, res) => {
  try {
    await comfyuiDownloader.pauseDownload(req.params.taskId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 继续下载 ── */
router.post('/whisper/download-resume/:taskId', async (req, res) => {
  try {
    await comfyuiDownloader.resumeDownload(req.params.taskId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 取消下载 ── */
router.post('/whisper/download-cancel/:taskId', async (req, res) => {
  try {
    await comfyuiDownloader.cancelDownload(req.params.taskId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
