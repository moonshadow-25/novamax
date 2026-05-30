/**
 * OpenAI-compatible TTS API
 *
 * 对外暴露符合 OpenAI /v1/audio/speech 格式的接口。
 * - model 参数映射到工作区的 model_id（6 位无歧义字符，与 Voice ID 同算法）
 * - voice 参数使用 NovaMax Voice ID
 *
 * 所有端点前缀: /v1
 */
import express from 'express';
import ttsWorkerManager from '../tts/ttsWorkerManager.js';
import modelManager from '../services/modelManager.js';

const router = express.Router();

function resolveModelDir(engineType) {
  const models = modelManager.getByType('tts');
  const norm = String(engineType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const m = models.find(m => {
    if (m.engine_version && String(m.engine_version).toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return true;
    return String(m.id || '').toLowerCase().replace(/[^a-z0-9]/g, '') === norm;
  });
  return m?.local_path || '';
}

/* ========================================================================
 * GET /v1/audio/models  —  列出可用模型（工作区）
 * ======================================================================== */

router.get('/audio/models', async (req, res) => {
  try {
    const workspaces = await ttsWorkerManager.send('getWorkspaces');
    const ttsModels = workspaces
      .filter(ws => ws.model_id)
      .map(ws => ({
        id: ws.model_id,
        object: 'model',
        created: Math.floor(new Date(ws.created_at).getTime() / 1000),
        owned_by: 'novamax',
        engine: ws.engine_type,
        voice_mode: ws.voice_mode,
      }));
    const asrModels = (modelManager.getByType('asr') || []).map(m => ({
      id: m.name,
      object: 'model',
      created: Math.floor(new Date(m.created_at).getTime() / 1000),
      owned_by: 'novamax',
      type: 'asr',
      language: m.asr_config?.language || (m.whisper_config?.language) || 'auto',
    }));
    res.json({ object: 'list', data: [...ttsModels, ...asrModels] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ========================================================================
 * GET /v1/audio/voices  —  列出可用音色
 * ======================================================================== */

router.get('/audio/voices', async (req, res) => {
  try {
    const data = await ttsWorkerManager.send('listVoices', { page: 1, page_size: 500 });
    const voices = (data.items || []).map(v => ({
      voice_id: v.id,
      name: v.name,
      mode: v.voice_mode,
      created_at: v.created_at,
    }));
    res.json({ object: 'list', data: voices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ========================================================================
 * POST /v1/audio/speech  —  OpenAI 兼容 TTS
 * ======================================================================== */

router.post('/audio/speech', async (req, res) => {
  try {
    const { model, input, voice, response_format = 'wav', speed } = req.body;

    if (!input?.trim()) {
      return res.status(400).json({ error: { message: 'input is required', type: 'invalid_request_error' } });
    }

    // model = 工作区 model_id → 查找工作区
    const workspaces = await ttsWorkerManager.send('getWorkspaces');
    const ws = workspaces.find(w => w.model_id === model);
    if (!ws) {
      const available = workspaces.filter(w => w.model_id).map(w => w.model_id).join(', ');
      return res.status(400).json({
        error: { message: `Model '${model}' not found. Available: ${available}`, type: 'invalid_request_error' }
      });
    }

    // 根据 API key 判断来源（固定 key，仅用于区分调用来源，非安全认证）
    const API_KEY_MANUAL = 'novamax-manual';
    const API_KEY_FILE = 'novamax-file';
    const authHeader = (req.headers.authorization || req.headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();
    let sourceType = 'external';
    let sourceFile = '';
    if (authHeader === API_KEY_MANUAL) {
      sourceType = 'manual';
    } else if (authHeader === API_KEY_FILE) {
      sourceType = 'file';
      sourceFile = req.headers['x-source-file'] || '';
    }

    // 检查工作区 voice_mode 参数：非 clone 模式（design/auto）不要求 voice
    const wsParams = ws.params || {};
    const voiceMode = wsParams.voice_mode;
    const isCloneMode = !voiceMode || voiceMode === 'clone';

    // 解析 voice：优先用请求中的 voice，无效则回退到激活的默认 voice
    const voices = await ttsWorkerManager.send('listVoices', { page: 1, page_size: 500 });
    const validVoiceIds = new Set((voices.items || []).map(v => v.id));
    const resolvedVoice = (voice && validVoiceIds.has(voice)) ? voice
      : ws.active_voice_id && validVoiceIds.has(ws.active_voice_id) ? ws.active_voice_id
      : ws.voice_id && validVoiceIds.has(ws.voice_id) ? ws.voice_id
      : '';

    if (isCloneMode && !resolvedVoice) {
      return res.status(400).json({
        error: { message: 'voice is required — no valid voice configured. Upload a reference audio to create one.', type: 'invalid_request_error' }
      });
    }

    // 构建 params：工作区预设 + speed 覆盖
    const params = { ...wsParams };
    if (speed != null) params.speed = speed;

    const result = await ttsWorkerManager.send('synthesize', {
      text: input.trim(),
      voiceId: resolvedVoice,
      engineType: ws.engine_type,
      outputFormat: response_format || 'wav',
      outputDir: ws.output_dir || '',
      params,
      skipVoiceResolve: !isCloneMode,
      workspaceId: ws.id,
      sourceFile,
      sourceType,
      modelDir: resolveModelDir(ws.engine_type)
    });

    const audioBuffer = Buffer.from(result.audio?.data || result.audio || []);
    const mime = response_format === 'mp3' ? 'audio/mpeg'
      : response_format === 'flac' ? 'audio/flac'
      : response_format === 'opus' ? 'audio/ogg'
      : 'audio/wav';

    res.set('Content-Type', mime);
    res.set('X-Audio-Duration', String(result.duration || 0));
    res.set('X-Ffmpeg-Missing', result.ffmpeg_missing ? '1' : '0');
    res.send(audioBuffer);
  } catch (e) {
    res.status(500).json({
      error: { message: e.message, type: 'api_error', code: e.code }
    });
  }
});

/* ========================================================================
 * GET /v1/health
 * ======================================================================== */

router.get('/health', async (req, res) => {
  try {
    const running = await ttsWorkerManager.send('isEngineRunning', {});
    res.json({ status: running?.running ? 'ok' : 'unhealthy', tts_engines: running?.running ? 1 : 0 });
  } catch {
    res.json({ status: 'unhealthy' });
  }
});

export default router;
