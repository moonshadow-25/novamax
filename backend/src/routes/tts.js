/**
 * TTS 路由 — 语音合成、音色、历史
 *
 * 所有业务逻辑委托给 TTS Worker 线程。
 * 路由只做：解析请求 → 转发消息 → 返回响应。
 *
 * 保持在主线程的：文件读取（音频服务）、模型文件管理。
 */
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import ttsWorkerManager from '../tts/ttsWorkerManager.js';
import modelManager from '../services/modelManager.js';
import commonDownloader from '../services/commonDownloader.js';
import { DATA_DIR, MODELS_RUN_DIR } from '../config/constants.js';
import eventBus from '../services/eventBus.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function resolveModelDir(engineType) {
  const models = modelManager.getByType('tts');
  const norm = String(engineType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const m = models.find(m => {
    if (m.engine_version && String(m.engine_version).toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return true;
    return String(m.id || '').toLowerCase().replace(/[^a-z0-9]/g, '') === norm;
  });
  return m?.local_path || '';
}

/* ────────────────────────────────────────────────────────────────────────
 * 语音合成（通过 TTS Worker）
 * ──────────────────────────────────────────────────────────────────────── */
router.post('/tts/speech', async (req, res) => {
  try {
    const { text, voice: voiceId, engine_type, engine_version, output_format, workspace_id, source_file, ...params } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text 不能为空' });
    if (!voiceId) return res.status(400).json({ error: 'voice 不能为空' });

    const result = await ttsWorkerManager.send('synthesize', {
      text: text.trim(),
      voiceId,
      engineType: engine_type || '',
      engineVersion: engine_version,
      outputFormat: output_format || 'wav',
      params,
      workspaceId: workspace_id,
      outputDir: '',
      sourceFile: source_file || '',
      modelDir: resolveModelDir(engine_type || '')
    });

    res.set('Content-Type', `audio/${output_format || 'wav'}`);
    res.set('X-Audio-Duration', String(result.duration || 0));
    res.set('X-Segment-Count', String(result.segment_count || 1));
    res.send(Buffer.from(result.audio?.data || result.audio || []));
  } catch (e) {
    const status = e.code === 'INVALID_TEXT' || e.code === 'INVALID_VOICE' ? 400
      : e.code === 'MODEL_NOT_READY' ? 503
      : e.code === 'TEXT_TOO_LONG' ? 413
      : e.code === 'GPU_OOM' ? 507
      : 500;
    res.status(status).json({ error: e.message, code: e.code, retryable: e.retryable });
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * 音色（通过 TTS Worker）
 * ──────────────────────────────────────────────────────────────────────── */
router.get('/tts/voices', async (req, res) => {
  try {
    const { page, page_size, search } = req.query;
    const result = await ttsWorkerManager.send('listVoices', {
      page: parseInt(page) || 1,
      page_size: parseInt(page_size) || 100,
      search
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tts/voices', upload.single('file'), async (req, res) => {
  try {
    if (!req.file && !req.body.reference_audio_id && req.body.voice_mode !== 'random') {
      return res.status(400).json({ error: 'clone 模式需要上传参考音频或指定 reference_audio_id' });
    }
    // Voice 创建涉及文件写入，仍在主线程处理
    // 但 DB 写入需要通过 Worker
    const voice = await createVoiceLocally(req);
    res.json(voice);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 音频文件服务（主线程直接读文件）
router.get('/tts/voices/:voiceId/audio', (req, res) => {
  const voicesDir = path.join(DATA_DIR, 'tts_services', 'voices');
  const dir = fs.readdirSync(voicesDir);
  const file = dir.find(f => f.startsWith(req.params.voiceId));
  if (!file || !fs.existsSync(path.join(voicesDir, file))) {
    return res.status(404).json({ error: '音频不存在' });
  }
  const ext = path.extname(file).slice(1);
  res.set('Content-Type', `audio/${ext}`);
  res.send(fs.readFileSync(path.join(voicesDir, file)));
});

router.delete('/tts/voices/:voiceId', async (req, res) => {
  try {
    const voicesDir = path.join(DATA_DIR, 'tts_services', 'voices');
    const dir = fs.readdirSync(voicesDir);
    const file = dir.find(f => f.startsWith(req.params.voiceId));
    if (file) fs.unlinkSync(path.join(voicesDir, file));
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * 历史（通过 TTS Worker 查 DB，音频文件主线程直接读）
 * ──────────────────────────────────────────────────────────────────────── */
router.get('/tts/history', async (req, res) => {
  try {
    const { page, page_size, workspace_id } = req.query;
    const result = await ttsWorkerManager.send('getHistory', {
      page: parseInt(page) || 1,
      page_size: parseInt(page_size) || 20,
      workspace_id
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tts/history/:itemId/audio', async (req, res) => {
  try {
    // 从 Worker 获取历史记录的实际文件路径
    const history = await ttsWorkerManager.send('getHistory', { page: 1, page_size: 500 });
    const item = (history?.items || []).find(h => h.id === req.params.itemId);
    if (!item?.output_file || !fs.existsSync(item.output_file)) {
      return res.status(404).json({ error: '音频不存在' });
    }
    const ext = path.extname(item.output_file).slice(1) || 'wav';
    res.set('Content-Type', `audio/${ext}`);
    res.send(fs.readFileSync(item.output_file));
  } catch {
    res.status(404).json({ error: '音频不存在' });
  }
});

router.delete('/tts/history/:itemId', async (req, res) => {
  try {
    await ttsWorkerManager.send('deleteHistoryItem', { id: req.params.itemId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tts/history', async (req, res) => {
  try {
    const { page_size } = req.query;
    const history = await ttsWorkerManager.send('getHistory', { page: 1, page_size: parseInt(page_size) || 100 });
    for (const item of history.items) {
      await ttsWorkerManager.send('deleteHistoryItem', { id: item.id });
    }
    res.json({ success: true, deleted: history.items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * 健康检查
 * ──────────────────────────────────────────────────────────────────────── */
router.get('/tts/health', async (req, res) => {
  try {
    const engStatus = await ttsWorkerManager.send('isEngineRunning', {});
    res.json({ status: engStatus.running ? 'ok' : 'unhealthy', engines: engStatus.engines || {} });
  } catch {
    res.json({ status: 'unhealthy', engines: {} });
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * 模型文件管理（保持不变，主线程处理）
 * ──────────────────────────────────────────────────────────────────────── */
router.get('/tts/models/:modelId/files-status', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'tts') return res.status(404).json({ error: 'Model not found' });

  let repoSizeMap = new Map();
  const modelscopeId = (model.models || [])[0]?.download_sources?.modelscope?.match(/models\/([^/]+\/[^/]+)\//)?.[1] || null;
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
    return { ...item, filename: relPath, size, downloaded, active_task: null };
  });
  res.json({ success: true, files, summary: { total: files.length, downloaded: files.filter(f => f.downloaded).length, missing: files.length - files.filter(f => f.downloaded).length } });
});

router.post('/tts/models/:modelId/download', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'tts') return res.status(404).json({ error: 'Model not found' });
  const { filename } = req.body;
  const fileInfo = (model.models || []).find(m => (m.filename || m.local_path || m.name) === filename);
  if (!fileInfo) return res.status(400).json({ error: '文件不存在于模型配置中' });
  const url = fileInfo.download_sources?.modelscope;
  if (!url) return res.status(400).json({ error: '该文件没有配置下载源' });
  const modelDir = path.join(MODELS_RUN_DIR, 'tts', model.id);
  fs.mkdirSync(path.dirname(path.join(modelDir, filename)), { recursive: true });
  const taskId = commonDownloader.startDownload({ filename, type: 'tts', dest: modelDir, original_url: url, download_sources: { original: url }, source_model_id: model.id, source_model_name: model.name, source_model_type: 'tts' }, async (result) => {
    if (result.success) { await modelManager.update(model.id, { local_path: modelDir }); eventBus.broadcast('model-updated', { modelId: model.id }); }
  });
  res.json({ success: true, taskId });
});

router.get('/tts/download-status/:taskId', (req, res) => {
  res.json({ success: true, task: commonDownloader.getTask(req.params.taskId) || { status: 'not_found' } });
});

router.post('/tts/download-pause/:taskId', async (req, res) => {
  try { await commonDownloader.pauseDownload(req.params.taskId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tts/download-resume/:taskId', async (req, res) => {
  try { await commonDownloader.resumeDownload(req.params.taskId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tts/download-cancel/:taskId', async (req, res) => {
  try { await commonDownloader.cancelDownload(req.params.taskId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ────────────────────────────────────────────────────────────────────────
 * Voice 创建辅助（主线程写文件 + Worker DB 未直接暴露，临时直接写 DB）
 * ──────────────────────────────────────────────────────────────────────── */
import crypto from 'crypto';
const genVid = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

async function createVoiceLocally(req) {
  const id = genVid('voice');
  const now = new Date().toISOString();
  let refPath = null;
  const mode = req.body.voice_mode || 'clone';
  const voicesDir = path.join(DATA_DIR, 'tts_services', 'voices');

  if (mode === 'clone') {
    if (req.file) {
      const ext = path.extname(req.file.originalname || '.wav');
      refPath = path.join(voicesDir, `${id}${ext}`);
      fs.writeFileSync(refPath, req.file.buffer);
    } else if (req.body.reference_audio_id) {
      // 从参考音频复制
      const refDir = path.join(DATA_DIR, 'tts_services', 'reference_audio');
      const refs = fs.readdirSync(refDir);
      const match = refs.find(f => f.startsWith(req.body.reference_audio_id));
      if (match) {
        const ext = path.extname(match);
        refPath = path.join(voicesDir, `${id}${ext}`);
        fs.copyFileSync(path.join(refDir, match), refPath);
      }
    }
  }

  return ttsWorkerManager.send('createVoice', {
    id, name: req.body.name || req.file?.originalname || '未命名',
    voice_mode: mode,
    reference_audio_path: refPath,
    instruction: req.body.instruction || null,
    emotion_preset: req.body.emotion_preset ? (typeof req.body.emotion_preset === 'string' ? JSON.parse(req.body.emotion_preset) : req.body.emotion_preset) : {},
    engine_meta: {},
    tags: req.body.tags || []
  });
}

export default router;
