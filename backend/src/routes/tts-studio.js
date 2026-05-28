/**
 * TTS Studio 路由 — 工作区 & 参考音频管理。
 *
 * 文件操作（上传、目录创建、复制）留在主线程。
 * DB 操作和引擎生命周期委托给 TTS Worker。
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import multer from 'multer';
import ttsWorkerManager from '../tts/ttsWorkerManager.js';
import { PROJECT_ROOT } from '../config/constants.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const REF_AUDIO_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'reference_audio');
const WORKSPACES_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'workspaces');
const FFMPEG_DIR = path.join(PROJECT_ROOT, 'external', 'ffmpeg');

function getFfmpegExe() {
  if (!fs.existsSync(FFMPEG_DIR)) return null;
  const dirs = fs.readdirSync(FFMPEG_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const d of dirs) {
    const exe = path.join(FFMPEG_DIR, d.name, 'ffmpeg.exe');
    if (fs.existsSync(path.join(FFMPEG_DIR, d.name, '.installed')) && fs.existsSync(exe)) return exe;
  }
  return null;
}

/** 参考音频支持的输入格式（其他格式会被转码为 wav） */
const REF_AUDIO_FORMATS = ['wav', 'mp3'];
const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const fileUuid = () => crypto.randomUUID().slice(0, 12);

// 统一引擎状态映射
const ENGINE_STATUS_MAP = {
  running:  { label: '引擎运行中', color: '#52c41a' },
  busy:     { label: '引擎生成中', color: '#fa8c16' },
  starting: { label: '引擎启动中', color: '#1890ff' },
  idle:     { label: '引擎空闲',   color: '#d9d9d9' },
  error:    { label: '引擎异常',   color: '#ff4d4f' },
};

function buildIndicator(engineStatus) {
  const status = engineStatus || 'idle';
  const info = ENGINE_STATUS_MAP[status] || ENGINE_STATUS_MAP.idle;
  return { status, reason: info.label, canOpen: status !== 'error' };
}

function normalizeFilename(name = '') {
  const base = path.basename(String(name || ''));
  try { return Buffer.from(base, 'latin1').toString('utf8'); } catch { return base; }
}

/**
 * 无歧义字符集。排除所有易混淆字符（两侧均删除）：
 *   0/O → 均排除    1/I/L → 均排除    2/Z → 均排除
 *   5/S → 均排除    8/B → 均排除
 * 共 25 字符。
 */
const ID_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';

/** MD5 前 4 字节 → base30 → 6 位 */
function hashToId(md5Bytes) {
  const num = md5Bytes.readUInt32BE(0);
  const base = ID_ALPHABET.length;
  let id = '';
  let n = num;
  for (let i = 0; i < 6; i++) {
    id = ID_ALPHABET[n % base] + id;
    n = Math.floor(n / base);
  }
  return id;
}

/** 从字符串生成 model_id（MD5 → base25 → 6位） */
function genModelId(input) {
  const md5 = crypto.createHash('md5').update(input).digest();
  return hashToId(md5);
}

// 兼容 v3/v4 contract 参数格式
function normalizeParamDefs(params) {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  if (params.flat && Array.isArray(params.flat)) return params.flat;
  return [];
}

/* ======================== 参考音频（文件操作在主线程） ======================== */

router.get('/reference-audios', (req, res) => {
  const { page, page_size } = req.query;
  const pg = parseInt(page) || 1;
  const ps = parseInt(page_size) || 8;
  if (!fs.existsSync(REF_AUDIO_DIR)) return res.json({ items: [], total: 0, page: pg, page_size: ps });
  const all = fs.readdirSync(REF_AUDIO_DIR)
    .filter(f => /\.(wav|mp3|flac)$/i.test(f))
    .sort((a, b) => fs.statSync(path.join(REF_AUDIO_DIR, b)).mtimeMs - fs.statSync(path.join(REF_AUDIO_DIR, a)).mtimeMs);
  const total = all.length;
  const items = all.slice((pg - 1) * ps, pg * ps).map(f => {
    const filePath = path.join(REF_AUDIO_DIR, f);
    const stat = fs.statSync(filePath);
    const baseName = path.parse(f).name;  // e.g. "3XK7NP_演示音频"
    const voiceId = baseName.slice(0, 6); // first 6 chars = Voice ID
    const name = baseName.length > 7 ? baseName.slice(7) : baseName; // rest = display name
    return { id: voiceId, voice_id: voiceId, name: name || voiceId, file_path: filePath, file_size: stat.size, format: path.extname(f).slice(1).toLowerCase(), uploaded_at: stat.mtime.toISOString() };
  });
  res.json({ items, total, page: pg, page_size: ps });
});

router.post('/reference-audios', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未上传文件' });
  const originalName = normalizeFilename(req.file.originalname || 'audio.wav');
  const ext = path.extname(originalName).toLowerCase().slice(1) || 'wav';
  const displayName = path.basename(originalName, path.extname(originalName)) || originalName;

  // 不支持的格式 → ffmpeg 转码为 wav
  let fileBuffer = req.file.buffer;
  let actualExt = ext;
  if (!REF_AUDIO_FORMATS.includes(ext)) {
    if (!getFfmpegExe()) {
      return res.status(400).json({ error: `音频格式 .${ext} 不受支持，且 ffmpeg 未安装。请在引擎管理中下载 ffmpeg 组件。` });
    }
    const tmpIn = path.join(REF_AUDIO_DIR, `_tmp_in_${Date.now()}.${ext}`);
    const tmpOut = path.join(REF_AUDIO_DIR, `_tmp_out_${Date.now()}.wav`);
    try {
      fs.writeFileSync(tmpIn, fileBuffer);
      await new Promise((resolve, reject) => {
        const proc = spawn(getFfmpegExe(), ['-i', tmpIn, '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', tmpOut, '-y'],
          { timeout: 30000 });
        proc.on('close', (code) => {
          if (code !== 0 || !fs.existsSync(tmpOut)) return reject(new Error(`音频转换失败：不支持的格式 ".${ext}"`));
          resolve();
        });
        proc.on('error', (e) => reject(new Error(`音频转换失败：${e.message}`)));
      });
      fileBuffer = fs.readFileSync(tmpOut);
      actualExt = 'wav';
    } catch (e) {
      return res.status(400).json({ error: `音频转换失败：${e.message}` });
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
      try { fs.unlinkSync(tmpOut); } catch {}
    }
  }

  // 基于文件 MD5 生成确定性 Voice ID
  const md5 = crypto.createHash('md5').update(fileBuffer).digest();
  const voiceId = hashToId(md5);

  // 同名 Voice 已存在（按前缀匹配）
  const existing = fs.readdirSync(REF_AUDIO_DIR).find(f => f.startsWith(voiceId) && /\.(wav|mp3|flac)$/i.test(f));
  if (existing && existing !== `${voiceId}_${displayName}.${actualExt}`) {
    const existPath = path.join(REF_AUDIO_DIR, existing);
    const existName = path.parse(existing).name.slice(7) || voiceId;
    return res.json({ id: voiceId, voice_id: voiceId, name: existName, file_path: existPath, file_size: fs.statSync(existPath).size, format: path.extname(existing).slice(1).toLowerCase(), uploaded_at: fs.statSync(existPath).mtime.toISOString() });
  }

  const filename = `${voiceId}_${displayName}.${actualExt}`;
  const filePath = path.join(REF_AUDIO_DIR, filename);
  fs.mkdirSync(REF_AUDIO_DIR, { recursive: true });
  fs.writeFileSync(filePath, fileBuffer);

  // 创建 Voice
  ttsWorkerManager.send('createVoice', {
    id: voiceId, name: displayName, voice_mode: 'clone',
    reference_audio_path: filePath, instruction: null,
    emotion_preset: {}, engine_meta: {}, tags: []
  }).catch(e => console.warn(`[tts-studio] Voice creation failed:`, e.message));

  res.json({ id: voiceId, voice_id: voiceId, name: displayName, file_path: filePath, file_size: req.file.size, format: ext.slice(1), uploaded_at: new Date().toISOString() });
});

router.get('/reference-audios/:id/file', (req, res) => {
  if (!fs.existsSync(REF_AUDIO_DIR)) return res.status(404).json({ error: '文件不存在' });
  const file = fs.readdirSync(REF_AUDIO_DIR).find(f => f.startsWith(req.params.id));
  if (!file) return res.status(404).json({ error: '文件不存在' });
  const ext = path.extname(file).slice(1) || 'wav';
  res.set('Content-Type', `audio/${ext}`);
  res.send(fs.readFileSync(path.join(REF_AUDIO_DIR, file)));
});

router.delete('/reference-audios/:id', (req, res) => {
  if (!fs.existsSync(REF_AUDIO_DIR)) return res.json({ success: true });
  const file = fs.readdirSync(REF_AUDIO_DIR).find(f => f.startsWith(req.params.id) && /\.(wav|mp3|flac)$/i.test(f));
  if (file) {
    fs.unlinkSync(path.join(REF_AUDIO_DIR, file));
  }
  // 清理关联的 Voice 和 workspace 引用
  ttsWorkerManager.send('cleanupVoice', { voice_id: req.params.id }).catch(() => {});
  res.json({ success: true });
});

router.put('/reference-audios/:id/rename', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '名称不能为空' });
  const id = req.params.id;
  const oldFile = fs.readdirSync(REF_AUDIO_DIR).find(f => f.startsWith(id) && /\.(wav|mp3|flac)$/i.test(f));
  if (!oldFile) return res.status(404).json({ error: '不存在' });
  const ext = path.extname(oldFile);
  const newFile = `${id}_${name.trim()}${ext}`;
  fs.renameSync(path.join(REF_AUDIO_DIR, oldFile), path.join(REF_AUDIO_DIR, newFile));
  res.json({ success: true, name: name.trim() });
});

/* ======================== 工作区 ======================== */

router.get('/workspaces', async (req, res) => {
  try {
    const [wss, engStatus, contracts] = await Promise.all([
      ttsWorkerManager.send('getWorkspaces'),
      ttsWorkerManager.send('isEngineRunning', {}),
      ttsWorkerManager.send('listEngineContracts'),
    ]);
    const perEngine = engStatus?.engines || {};
    const nameMap = new Map(contracts.map(c => [normalizeEngineType(c.engine_type), c.engine_name]));
    const result = wss.map(ws => {
      const model = getModelForEngine(ws.engine_type);
      const wsNorm = normalizeEngineType(ws.engine_type);
      const match = Object.entries(perEngine).find(([k]) => normalizeEngineType(k) === wsNorm);
      const wsEngineStatus = match?.[1]?.status || 'idle';
      return {
        ...ws, indicator: buildIndicator(wsEngineStatus), engine_status: wsEngineStatus,
        engine_name: model?.name || nameMap.get(wsNorm) || ws.engine_type,
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/workspaces', upload.single('reference_file'), async (req, res) => {
  try {
    const body = req.body;
    if (!body.name?.trim()) return res.status(400).json({ error: '工作区名称不能为空' });

    // 检查名称唯一性
    const existing = await ttsWorkerManager.send('getWorkspaces');
    if (existing.some(w => w.name === body.name.trim())) {
      return res.status(400).json({ error: `工作区名称 "${body.name}" 已存在` });
    }

    const id = genId('ws');
    const modelId = genModelId(id);
    const folderPath = path.join(WORKSPACES_DIR, modelId);
    const uploadsDir = path.join(folderPath, 'uploads');
    const jobsDir = path.join(folderPath, 'jobs');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(jobsDir, { recursive: true });

    const outputDir = body.output_dir || path.join(folderPath, 'outputs');
    const config = { name: body.name, engine_type: body.engine_type, created_at: new Date().toISOString() };
    fs.writeFileSync(path.join(folderPath, 'config.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(folderPath, 'uploads_meta.json'), '[]');

    const ws = await ttsWorkerManager.send('createWorkspace', {
      id, name: body.name.trim(), engine_type: body.engine_type,
      voice_mode: body.voice_mode || 'clone',
      voice_id: body.voice_id || null,
      params: body.params ? (typeof body.params === 'string' ? JSON.parse(body.params) : body.params) : {},
      folder_path: folderPath, output_dir: outputDir,
      model_id: modelId
    });
    res.json(ws);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/workspaces/:id', async (req, res) => {
  try {
    const [ws, engStatus, contracts] = await Promise.all([
      ttsWorkerManager.send('getWorkspace', { id: req.params.id }),
      ttsWorkerManager.send('isEngineRunning', {}),
      ttsWorkerManager.send('listEngineContracts'),
    ]);
    if (!ws) return res.status(404).json({ error: '工作区不存在' });
    const files = fs.existsSync(path.join(ws.folder_path, 'uploads_meta.json'))
      ? JSON.parse(fs.readFileSync(path.join(ws.folder_path, 'uploads_meta.json'), 'utf-8')) : [];
    const perEngine = engStatus?.engines || {};
    const wsNorm = normalizeEngineType(ws.engine_type);
    const match = Object.entries(perEngine).find(([k]) => normalizeEngineType(k) === wsNorm);
    const wsEngineStatus = match?.[1]?.status || 'idle';
    const model = getModelForEngine(ws.engine_type);
    const nameMap = new Map(contracts.map(c => [normalizeEngineType(c.engine_type), c.engine_name]));
    res.json({
      ...ws, files, indicator: buildIndicator(wsEngineStatus), engine_status: wsEngineStatus,
      engine_name: model?.name || nameMap.get(wsNorm) || ws.engine_type,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/workspaces/:id', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (ws?.folder_path && fs.existsSync(ws.folder_path)) {
      fs.rmSync(ws.folder_path, { recursive: true, force: true });
    }
    await ttsWorkerManager.send('deleteWorkspace', { id: req.params.id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/workspaces/:id/clone', async (req, res) => {
  try {
    const source = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!source) return res.status(404).json({ error: '源工作区不存在' });

    const newId = genId('ws');
    const modelId = genModelId(newId);
    const folderPath = path.join(WORKSPACES_DIR, modelId);
    const body = req.body;

    ['uploads', 'jobs'].forEach(d => fs.mkdirSync(path.join(folderPath, d), { recursive: true }));

    const outputDir = body.output_dir || source.output_dir;
    const cloneName = body.name || `${source.name}(副本)`;
    const config = { name: cloneName, engine_type: body.engine_type || source.engine_type, params: { ...source.params, ...(body.params || {}) }, created_at: new Date().toISOString() };
    fs.writeFileSync(path.join(folderPath, 'config.json'), JSON.stringify(config, null, 2));
    fs.writeFileSync(path.join(folderPath, 'uploads_meta.json'), '[]');

    const ws = await ttsWorkerManager.send('createWorkspace', {
      id: newId, name: config.name, engine_type: config.engine_type,
      voice_mode: '', voice_instruction: null,
      voice_id: null, reference_audio_id: null,
      params: config.params, folder_path: folderPath, output_dir: outputDir,
      model_id: modelId
    });
    res.json(ws);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/workspaces/:id/output-dir', async (req, res) => {
  try {
    await ttsWorkerManager.send('updateOutputDir', { id: req.params.id, output_dir: req.body.output_dir });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/workspaces/:id/params', async (req, res) => {
  try {
    await ttsWorkerManager.send('updateWorkspaceParams', { id: req.params.id, params: req.body.params || {} });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 统一的引擎启动：workspace 也走同一逻辑
async function doStartEngine(engineType) {
  const model = getModelForEngine(engineType);
  return ttsWorkerManager.send('startEngine', {
    engine_type: engineType,
    model_dir: model?.local_path || '',
    device_id: -1,
    custom: {}
  });
}

// 启动指定引擎
router.post('/engines/:engineType/start', async (req, res) => {
  try {
    const result = await doStartEngine(req.params.engineType);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message || '引擎启动失败' });
  }
});

// 停止指定引擎
router.post('/engines/:engineType/stop', async (req, res) => {
  try {
    await ttsWorkerManager.send('stopEngine', { engine_type: req.params.engineType });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/workspaces/:id/activate-voice', async (req, res) => {
  try {
    const result = await ttsWorkerManager.send('activateVoice', {
      workspace_id: req.params.id,
      voice_id: req.body.voice_id
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================== 工作区文件 ======================== */

router.get('/workspaces/:id/files', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.json([]);
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    res.json(fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : []);
  } catch { res.json([]); }
});

router.post('/workspaces/:id/files', upload.array('files', 20), async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.status(404).json({ error: '工作区不存在' });
    const uploadsDir = path.join(ws.folder_path, 'uploads');
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
    const added = [];
    for (const file of req.files) {
      const uuid = fileUuid();
      const originalName = normalizeFilename(file.originalname || 'upload.bin');
      const filename = `${uuid}_${originalName}`;
      fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
      const content = file.buffer.toString('utf-8');
      const meta = { uuid, original_name: originalName, filename, size: file.size, char_count: content.length, uploaded_at: new Date().toISOString() };
      existing.push(meta); added.push(meta);
    }
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2));
    res.json(added);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 批量更新文件状态
router.put('/workspaces/:id/files/status', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.status(404).json({ error: '工作区不存在' });
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    let existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
    const { filename, status } = req.body;
    existing = existing.map(f => f.filename === filename ? { ...f, status: status || undefined } : f);
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2));
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 清除已完成文件（从磁盘和元数据中删除）
router.delete('/workspaces/:id/files/completed', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.json({ success: true, deleted: 0 });
    const uploadsDir = path.join(ws.folder_path, 'uploads');
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    let existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
    const completed = existing.filter(f => f.status === 'completed');
    for (const f of completed) {
      const filePath = path.join(uploadsDir, f.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    existing = existing.filter(f => f.status !== 'completed');
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2));
    res.json({ success: true, deleted: completed.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/workspaces/:id/files', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.json({ success: true });
    const uploadsDir = path.join(ws.folder_path, 'uploads');
    const metaPath = path.join(ws.folder_path, 'uploads_meta.json');
    let existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];
    for (const fn of req.body.filenames || []) {
      if (fs.existsSync(path.join(uploadsDir, fn))) fs.unlinkSync(path.join(uploadsDir, fn));
      existing = existing.filter(f => f.filename !== fn);
    }
    fs.writeFileSync(metaPath, JSON.stringify(existing, null, 2));
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/workspaces/:id/files/:filename/content', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.status(404).json({ error: '工作区不存在' });
    const filePath = path.join(ws.folder_path, 'uploads', req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ filename: req.params.filename, content });
  } catch { res.status(400).json({ error: '无法读取文件内容' }); }
});

router.post('/workspaces/:id/open-output-dir', async (req, res) => {
  const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
  if (!ws) return res.status(404).json({ error: '工作区不存在' });
  const dir = req.body.output_dir || ws.output_dir;
  if (!dir || !fs.existsSync(dir)) return res.status(400).json({ error: '目录不存在' });
  exec(process.platform === 'win32' ? `start "" "${dir}"` : `open "${dir}"`);
  res.json({ success: true });
});

router.post('/open-file', (req, res) => {
  const { file_path } = req.body;
  if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: '文件不存在' });
  // 安全检查：仅允许打开 NovaMax 数据目录内的文件
  const dataRoot = path.join(PROJECT_ROOT, 'data');
  if (!path.resolve(file_path).startsWith(path.resolve(dataRoot))) {
    return res.status(403).json({ error: '禁止访问' });
  }
  exec(process.platform === 'win32' ? `start "" "${file_path}"` : `open "${file_path}"`);
  res.json({ success: true });
});

/* ======================== 工作区参数 ======================== */

router.get('/workspaces/:id/params', async (req, res) => {
  try {
    const ws = await ttsWorkerManager.send('getWorkspace', { id: req.params.id });
    if (!ws) return res.status(404).json({ error: '工作区不存在' });
    const contracts = await ttsWorkerManager.send('listEngineContracts');
    const contract = contracts.find(c => normalizeEngineType(c.engine_type) === normalizeEngineType(ws.engine_type));
    res.json({ engine_type: ws.engine_type, current: ws.params || {}, definitions: normalizeParamDefs(contract?.contract?.parameters) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ======================== 引擎合约 ======================== */

router.get('/engine-contracts', async (req, res) => {
  try {
    const contracts = await ttsWorkerManager.send('listEngineContracts');
    res.json(contracts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ======================== 引擎运行时配置 & 内存 ======================== */

router.get('/engine-runtime-config', async (req, res) => {
  try {
    const { engine_type } = req.query;
    if (!engine_type) return res.status(400).json({ error: 'engine_type 不能为空' });
    const cfg = await ttsWorkerManager.send('getEngineRuntimeConfig', { engine_type });
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/engine-runtime-config', async (req, res) => {
  try {
    const { engine_type, key, value } = req.body;
    if (!engine_type || !key) return res.status(400).json({ error: 'engine_type 和 key 不能为空' });
    const result = await ttsWorkerManager.send('setEngineRuntimeConfig', { engine_type, key, value });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ======================== 引擎主动报告端点 ======================== */

router.post('/engine-report', async (req, res) => {
  try {
    const { engine_type, event, health, pid, memory, error } = req.body;
    if (!engine_type) return res.status(400).json({ error: 'engine_type 不能为空' });
    await ttsWorkerManager.send('storeEngineReport', { engine_type, event, health, pid, memory, error });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================== 引擎运行时配置 & 内存 ======================== */

router.get('/engine-memory', async (req, res) => {
  try {
    const { engine_type } = req.query;
    if (!engine_type) return res.status(400).json({ error: 'engine_type 不能为空' });
    const info = await ttsWorkerManager.send('getEngineMemoryInfo', { engine_type });
    res.json(info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ======================== TTS 全局配置 ======================== */

const TTS_CONFIG_PATH = path.join(PROJECT_ROOT, 'data', 'tts_services', 'config.json');
const DEFAULT_TTS_CONFIG = { idle_timeout_minutes: 5 };

function getTtsConfig() {
  try {
    if (fs.existsSync(TTS_CONFIG_PATH)) {
      return { ...DEFAULT_TTS_CONFIG, ...JSON.parse(fs.readFileSync(TTS_CONFIG_PATH, 'utf-8')) };
    }
  } catch {}
  return { ...DEFAULT_TTS_CONFIG };
}

router.get('/config', (req, res) => {
  res.json(getTtsConfig());
});

router.put('/config', (req, res) => {
  try {
    const current = getTtsConfig();
    const updated = { ...current, ...req.body };
    if (updated.idle_timeout_minutes != null) {
      updated.idle_timeout_minutes = Math.max(3, Math.min(30, Number(updated.idle_timeout_minutes) || 5));
    }
    fs.mkdirSync(path.dirname(TTS_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(TTS_CONFIG_PATH, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ======================== 辅助 ======================== */

import modelManager from '../services/modelManager.js';

function getModelForEngine(engineType) {
  const models = modelManager.getByType('tts');
  const norm = normalizeEngineType(engineType);
  return models.find(m =>
    normalizeEngineType(m.engine_version) === norm
    || normalizeEngineType(m.id) === norm
  ) || null;
}

export default router;
