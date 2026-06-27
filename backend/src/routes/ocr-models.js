/**
 * OCR 模型文件管理路由。
 * 使用 commonDownloader 下载单个模型文件（与 TTS/ASR 一致）。
 * 下载完成后更新 mineru.json 配置。
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import commonDownloader from '../services/commonDownloader.js';
import eventBus from '../services/eventBus.js';
import { MODELS_RUN_DIR } from '../config/constants.js';

const router = Router();
const OCR_MODELS_DIR = path.join(MODELS_RUN_DIR, 'ocr');
fs.mkdirSync(OCR_MODELS_DIR, { recursive: true });

function getModelBaseDir(modelId) {
  return path.join(OCR_MODELS_DIR, modelId);
}

function getRoleBaseDir(modelId, item) {
  const modelDir = getModelBaseDir(modelId);
  if (item.role === 'pipeline') return path.join(modelDir, 'pipeline');
  if (item.role === 'vlm') return path.join(modelDir, 'vlm');
  return modelDir;
}

function getItemLocalPath(modelId, item) {
  const baseDir = getRoleBaseDir(modelId, item);
  if (item.download_type === 'repo') {
    return baseDir;
  }
  return path.join(baseDir, item.filename);
}

/* ── 模型文件状态 ── */
router.get('/models/:modelId/files-status', (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'ocr') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const files = (model.models || []).map(item => {
    const itemPath = getItemLocalPath(model.id, item);
    let downloaded = false;
    if (item.download_type === 'file') {
      downloaded = fs.existsSync(itemPath) && fs.statSync(itemPath).size > 0;
    } else {
      // folder / repo：必须有 .download-complete 标记才判定为完整下载
      downloaded = fs.existsSync(path.join(itemPath, '.download-complete'));
    }
    return { ...item, downloaded, active_task: null };
  });

  const downloadedCount = files.filter(f => f.downloaded).length;
  res.json({
    success: true,
    files,
    summary: { total: files.length, downloaded: downloadedCount, missing: files.length - downloadedCount },
  });
});

/* ── 获取文件直接下载 URL ── */
function getDownloadUrl(fileInfo) {
  // 优先使用已配置的直接下载链接
  if (fileInfo.download_sources?.modelscope) {
    return fileInfo.download_sources.modelscope;
  }
  if (fileInfo.download_sources?.original) {
    return fileInfo.download_sources.original;
  }
  // 从 modelscope_repo 构造下载 URL
  const repo = fileInfo.modelscope_repo;
  if (repo) {
    const revision = fileInfo.revision || 'master';
    const filePath = fileInfo.repo_path || fileInfo.filename;
    return `https://www.modelscope.cn/models/${repo}/tree/${revision}/${filePath}`;
  }
  return null;
}

/* ── 下载单个模型文件 ── */
router.post('/models/:modelId/download', async (req, res) => {
  const model = modelManager.getById(req.params.modelId);
  if (!model || model.type !== 'ocr') {
    return res.status(404).json({ error: 'Model not found' });
  }

  const { filename } = req.body;
  const fileInfo = (model.models || []).find(m => m.filename === filename);
  if (!fileInfo) {
    return res.status(400).json({ error: '文件不存在于模型配置中' });
  }

  const url = getDownloadUrl(fileInfo);
  if (!url) {
    return res.status(400).json({ error: '该文件没有配置下载源' });
  }

  const destDir = getRoleBaseDir(model.id, fileInfo);
  fs.mkdirSync(destDir, { recursive: true });

  const taskId = commonDownloader.startRepoDownload({
    filename: fileInfo.filename,
    type: 'ocr',
    dest: destDir,
    original_url: url,
    download_sources: { original: url },
    download_type: fileInfo.download_type || 'file',
    size: fileInfo.size || 0,
    source_model_id: model.id,
    source_model_name: model.name,
    source_model_type: 'ocr'
  }, async (result) => {
    if (result.success) {
      writeMineruConfig(model.id);
      eventBus.broadcast('model-updated', { modelId: model.id });
    }
  });

  res.json({ success: true, taskId });
});

/* ── 写入 mineru.json 配置 ── */
function writeMineruConfig(modelId) {
  const modelDir = path.join(OCR_MODELS_DIR, modelId);
  const pipelineDir = path.join(modelDir, 'pipeline');
  const vlmDir = path.join(modelDir, 'vlm');
  const configPath = path.join(modelDir, 'mineru.json');
  const config = {
    'models-dir': {
      pipeline: fs.existsSync(pipelineDir) ? pipelineDir : '',
      vlm: fs.existsSync(vlmDir) ? vlmDir : '',
    },
    'model-source': 'local'
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

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
