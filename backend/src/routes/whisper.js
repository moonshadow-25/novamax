import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import configManager from '../services/configManager.js';
import { DATA_DIR } from '../config/constants.js';

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
  const port = configManager.get('ports')?.whisper || 8281;
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

    const response = await fetch(`${getWhisperBase()}/v1/audio/transcriptions`, {
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

    const response = await fetch(`${getWhisperBase()}/v1/audio/translations`, {
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

export default router;
