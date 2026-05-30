/**
 * ASR Studio 路由 — 共享文件/历史/输出目录 (不区分模型)
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../config/constants.js';
import modelManager from '../services/modelManager.js';
import asrWorkerManager from '../asr/asrWorkerManager.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const SHARED_ID = '__shared__';

// Files
router.post('/files', upload.array('files', 20), async (req, res) => {
  try {
    const files = (req.files || []).map(f => ({ originalName: f.originalname, buffer: f.buffer, size: f.size }));
    res.json(await asrWorkerManager.send('uploadFiles', { modelId: SHARED_ID, files }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/files', async (req, res) => {
  try { res.json(await asrWorkerManager.send('getFiles', { modelId: SHARED_ID })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/files', async (req, res) => {
  try { res.json(await asrWorkerManager.send('deleteFiles', { modelId: SHARED_ID, filenames: req.body.filenames || [] })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/files/status', async (req, res) => {
  try { res.json(await asrWorkerManager.send('updateFileStatus', { modelId: SHARED_ID, filename: req.body.filename, status: req.body.status })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/files/completed', async (req, res) => {
  try { res.json(await asrWorkerManager.send('deleteCompletedFiles', { modelId: SHARED_ID })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/files/:filename/play', (req, res) => {
  const p = path.join(PROJECT_ROOT, 'data', 'asr_services', SHARED_ID, 'uploads', req.params.filename);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(p);
});

// History (shared, model_id column preserved for display)
router.get('/history', async (req, res) => {
  try { res.json(await asrWorkerManager.send('getHistory', { page: +req.query.page || 1, pageSize: +req.query.page_size || 20 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/history/:id', async (req, res) => {
  try { res.json(await asrWorkerManager.send('deleteHistoryItem', { id: req.params.id })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Output dir (shared)
router.get('/output-dir', async (req, res) => {
  try { res.json({ output_dir: path.join(PROJECT_ROOT, 'data', 'asr_services', SHARED_ID, 'outputs') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/output-dir', async (req, res) => {
  const dir = req.body.output_dir;
  fs.mkdirSync(dir, { recursive: true });
  res.json({ success: true });
});
router.post('/output-dir/open', async (req, res) => {
  const { execSync } = await import('child_process');
  const dir = req.body.output_dir || path.join(PROJECT_ROOT, 'data', 'asr_services', SHARED_ID, 'outputs');
  fs.mkdirSync(dir, { recursive: true });
  execSync(`start "" "${dir}"`, { shell: true });
  res.json({ success: true });
});

// Engine
router.post('/engines/:modelId/start', async (req, res) => {
  try {
    const m = modelManager.getById(req.params.modelId);
    if (!m) return res.status(404).json({ error: 'Model not found' });
    const cfg = m.asr_config || m.whisper_config || {};
    res.json(await asrWorkerManager.send('startEngine', {
      modelId: req.params.modelId, engineType: m.engine_id || m.engine_type,
      modelFilePath: m.path, language: cfg.language, threads: cfg.threads,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/engines/:modelId/stop', async (req, res) => {
  try { res.json(await asrWorkerManager.send('stopEngine', { modelId: req.params.modelId })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/engines/status', async (req, res) => {
  try { res.json(await asrWorkerManager.send('isEngineRunning')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Logs
router.get('/logs', async (req, res) => {
  try { res.json(await asrWorkerManager.send('getAsrLogs', { limit: +req.query.limit || 500 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/logs', async (req, res) => {
  try { res.json(await asrWorkerManager.send('clearAsrLogs')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Save output to file (JSON body)
router.post('/save-output', async (req, res) => {
  try {
    const { text, format, filename, model_id } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    const outputDir = path.join(PROJECT_ROOT, 'data', 'asr_services', '__shared__', 'outputs');
    fs.mkdirSync(outputDir, { recursive: true });
    const baseName = filename ? path.basename(filename, path.extname(filename)) : 'output';
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const fmt = format || 'json';
    const ext = fmt === 'text' ? 'txt' : fmt === 'verbose_json' ? 'json' : fmt;
    const outPath = path.join(outputDir, `${baseName}_${ts}.${ext}`);
    if (fmt === 'text') fs.writeFileSync(outPath, text, 'utf-8');
    else if (fmt === 'srt') fs.writeFileSync(outPath, text, 'utf-8');
    else if (fmt === 'vtt') fs.writeFileSync(outPath, text, 'utf-8');
    else fs.writeFileSync(outPath, JSON.stringify({ text }, null, 2), 'utf-8');
    res.json({ success: true, path: outPath });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
