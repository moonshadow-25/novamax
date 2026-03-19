import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import configManager from '../services/configManager.js';
import { DATA_DIR } from '../config/constants.js';

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

export default router;
