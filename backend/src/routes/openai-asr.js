/**
 * OpenAI 兼容 ASR 端点 — 全部委托 ASR Worker
 */
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import asrWorkerManager from '../asr/asrWorkerManager.js';
import { DATA_DIR, ASR_DEFAULTS } from '../config/constants.js';

const router = Router();
const uploadDir = path.join(DATA_DIR, 'cache', 'asr-uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 500 * 1024 * 1024 } });

router.post('/audio/transcriptions', upload.single('file'), async (req, res) => {
  try { await handleRequest(req, res); }
  finally { if (req.file?.path) fs.unlink(req.file.path, () => {}); }
});

async function handleRequest(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: { message: '未提供音频文件' } });

  const { model, language, response_format = 'json', temperature, prompt, stream, output_mode } = req.body;

  const asrModels = modelManager.getByType('asr') || [];
  const defaultModel = asrModels.find(m => m.asr_config?.is_default);
  let asrModel = null;
  if (model) {
    // 优先按 ID 查找，再按名称查找（兼容 OpenAI API 的 model 名称参数）
    asrModel = modelManager.getById(model) || asrModels.find(m => m.name === model);
  }
  if (!asrModel) asrModel = defaultModel || asrModels[0];
  if (!asrModel) {
    const available = asrModels.map(m => m.name).join(', ') || '(无)';
    return res.status(400).json({ error: { message: `模型未找到。可用: ${available}`, type: 'invalid_request_error', code: 'model_not_found' } });
  }

  // 检查是否存在旧的 whisper_config（迁移后不应存在）
  if (asrModel.whisper_config) {
    console.warn(`[openai-asr] 模型 ${asrModel.id} 仍有旧字段 whisper_config，应已迁移为 asr_config`);
  }

  // 源追踪（同 TTS 的 Bearer token 模式）
  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  let sourceType = 'external';
  if (authHeader === 'novamax-manual') sourceType = 'manual';
  else if (authHeader === 'novamax-file') sourceType = 'file';

  try {
    const cfg = asrModel.asr_config || {};
    const result = await asrWorkerManager.send('transcribe', {
      modelId: asrModel.id, engineType: asrModel.engine_id,
      audioPath: file.path, language, outputFormat: response_format, temperature, prompt,
      stream: stream === 'true' || stream === true,
      modelFilePath: asrModel.path, threads: cfg.threads || ASR_DEFAULTS.DEFAULT_THREADS,
      outputDir: cfg.output_dir,
      sourceType,
    });

    if (response_format === 'text') res.type('text/plain').send(result.text || '');
    else res.json({ text: result.text || '', model: asrModel.name });
  } catch (e) {
    res.status(502).json({ error: { message: e.message, type: 'api_error' } });
  }
}

export default router;
