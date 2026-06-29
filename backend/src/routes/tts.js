/**
 * TTS 路由 — 语音合成、音色、历史
 *
 * 所有业务逻辑委托给 TTS Worker 线程。
 * 路由只做：解析请求 → 转发消息 → 返回响应。
 *
 * 保持在主线程的：文件读取（音频服务）、模型文件管理。
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import ttsWorkerManager from '../tts/ttsWorkerManager.js';
import modelManager from '../services/modelManager.js';
import commonDownloader from '../services/commonDownloader.js';
import { MODELS_RUN_DIR } from '../config/constants.js';
import eventBus from '../services/eventBus.js';

const router = express.Router();


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

/* ── 删除模型文件 ── */
router.delete('/tts/models/:modelId/files/:filename', async (req, res) => {
  const { modelId, filename } = req.params;
  const model = modelManager.getById(modelId);
  if (!model || model.type !== 'tts') return res.status(404).json({ error: 'Model not found' });
  const filePath = path.join(MODELS_RUN_DIR, 'tts', modelId, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    eventBus.broadcast('model-updated', { modelId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

export default router;
