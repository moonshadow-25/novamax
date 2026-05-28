import express from 'express';
import fs from 'fs';
import path from 'path';
import engineManager from '../services/engineManager.js';
import engineDownloader from '../services/engineDownloader.js';
import downloadStateManager from '../services/downloadStateManager.js';
import processManager from '../services/processManager.js';

const router = express.Router();

function injectLocalTtsVariants(ttsEngine, installedVersions) {
  if (!ttsEngine) return ttsEngine;

  const variants = Array.isArray(ttsEngine.variants) ? [...ttsEngine.variants] : [];
  const knownIds = new Set(variants.map(v => String(v?.id || '').toLowerCase()));

  for (const ver of installedVersions || []) {
    const contractPath = path.join(ver.path, 'contract.json');
    if (!fs.existsSync(contractPath)) continue;

    let contract;
    try {
      contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
    } catch {
      continue;
    }

    const type = contract?.engine?.type;
    const name = contract?.engine?.name;
    if (!type || knownIds.has(String(type).toLowerCase())) continue;

    variants.push({
      id: type,
      name: name || type,
      source: 'local',
      versions: [{ version: ver.version, local_only: true }]
    });
    knownIds.add(String(type).toLowerCase());
  }

  return { ...ttsEngine, variants };
}

// TTS 各 variant 的默认运行时环境（当远程配置未提供 runtimes 时兜底）
const TTS_DEFAULT_RUNTIMES = {
  indextts2: [
    { id: 'rocm', name: 'ROCm + PyTorch', modelscope_file: 'tts/engines/index_tts2_engine.zip', description: 'AMD GPU 加速 (ROCm)' }
  ],
  indextts15: [
    { id: 'rocm', name: 'ROCm + PyTorch', modelscope_file: 'tts/engines/index_tts1.5_engine.zip', description: 'AMD GPU 加速 (ROCm)' }
  ]
};

function ensureTtsRuntimes(ttsEngine) {
  if (!ttsEngine || !Array.isArray(ttsEngine.variants)) return ttsEngine;
  const variants = ttsEngine.variants.map(v => {
    if (Array.isArray(v.runtimes) && v.runtimes.length > 0) return v;
    const defaults = TTS_DEFAULT_RUNTIMES[v.id] || [];
    return { ...v, runtimes: defaults };
  });
  return { ...ttsEngine, variants };
}

/**
 * 获取所有引擎列表（含安装状态和下载状态）
 */
router.get('/engines', async (req, res) => {
  try {
    const engines = engineManager.getEngines();
    const result = {};

    for (const [id, engine] of Object.entries(engines)) {
      const installed = engineManager.getInstalledVersions(id);
      const broken = engineManager.getBrokenVersions(id);
      const defaultVersion = engineManager.getDefaultVersion(id);

      // 查找该引擎所有进行中的下载（可能同时下载多个版本）
      const allStates = downloadStateManager.getAllStates();
      const downloadStates = Object.values(allStates).filter(
        s => s.type === 'engine' && (s.engineId === id || s.id === id)
      );

      let engineWithLocalVariants = id === 'tts'
        ? injectLocalTtsVariants(engine, installed)
        : engine;

      // TTS 兜底：远程配置缺少 runtimes 时注入默认值
      if (id === 'tts') {
        engineWithLocalVariants = ensureTtsRuntimes(engineWithLocalVariants);
      }

      result[id] = {
        ...engineWithLocalVariants,
        installed: installed.length > 0,
        installed_versions: installed,
        broken_versions: broken,
        default_version: defaultVersion,
        download_states: downloadStates,
        // 兼容旧字段：取第一个活跃下载
        download_state: downloadStates[0] || null
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取单个引擎详情
 */
router.get('/engines/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const engine = engineManager.getEngine(id);

    if (!engine) {
      return res.status(404).json({ error: 'Engine not found' });
    }

    const installed = engineManager.getInstalledVersions(id);
    const broken = engineManager.getBrokenVersions(id);
    const defaultVersion = engineManager.getDefaultVersion(id);

    let engineWithLocalVariants = id === 'tts'
      ? injectLocalTtsVariants(engine, installed)
      : engine;

    if (id === 'tts') {
      engineWithLocalVariants = ensureTtsRuntimes(engineWithLocalVariants);
    }

    res.json({
      ...engineWithLocalVariants,
      installed: installed.length > 0,
      installed_versions: installed,
      broken_versions: broken,
      default_version: defaultVersion
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 检查引擎是否已安装
 */
router.get('/engines/:id/check', async (req, res) => {
  try {
    const { id } = req.params;
    const engine = engineManager.getEngine(id);

    if (!engine) {
      return res.status(404).json({ error: 'Engine not found' });
    }

    const installed = engineManager.isInstalled(id);
    const defaultVersion = engineManager.getDefaultVersion(id);

    res.json({
      installed,
      engineInfo: engine,
      default_version: defaultVersion
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取已安装版本列表
 */
router.get('/engines/:id/versions', async (req, res) => {
  try {
    const { id } = req.params;
    const versions = engineManager.getInstalledVersions(id);
    res.json({ versions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 验证依赖
 */
router.post('/engines/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;
    const { version } = req.body;

    const result = engineManager.checkDependencies(id, version);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 重新安装指定版本（不重新下载，只重跑安装脚本）
 */
router.post('/engines/:id/versions/:version/reinstall', async (req, res) => {
  try {
    const { id, version } = req.params;
    const result = await engineDownloader.reinstall(id, version);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 卸载指定版本
 */
router.delete('/engines/:id/versions/:version', async (req, res) => {
  try {
    const { id, version } = req.params;

    // 引擎 → 关联模型类型（rocm 作为依赖，检查所有使用它的引擎对应的模型）
    const engineModelTypes = {
      llamacpp: ['llm'],
      comfyui:  ['comfyui'],
      tts:      ['tts'],
      whisper:  ['whisper'],
      rocm:     ['llm', 'comfyui']   // rocm 是 llamacpp/comfyui 的依赖
    };

    const relatedTypes = engineModelTypes[id] || [];
    if (relatedTypes.length > 0) {
      const running = processManager.getAllRunning();
      const blocking = running.filter(p => relatedTypes.includes(p.type));
      if (blocking.length > 0) {
        return res.status(400).json({
          error: `请先停止正在运行的模型，再卸载引擎（当前有 ${blocking.length} 个模型运行中）`
        });
      }
    }

    await engineManager.uninstall(id, version);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 下载引擎（含依赖）
 */
router.post('/engines/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const { version, runtime } = req.body;

    const result = await engineDownloader.startDownloadWithDependencies(id, version, runtime || null);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 查询下载进度（taskId 格式：engineId::version）
 */
router.get('/engines/download/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    // taskId 格式：engineId::version
    const [engineId, version] = taskId.split('::');
    const allStates = downloadStateManager.getAllStates();
    const state = allStates[taskId];

    if (!state) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ taskId, ...state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
