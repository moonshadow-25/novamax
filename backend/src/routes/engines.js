import express from 'express';
import engineManager from '../services/engineManager.js';
import engineDownloader from '../services/engineDownloader.js';
import downloadStateManager from '../services/downloadStateManager.js';
import processManager from '../services/processManager.js';
import { getGpuInfo } from './system.js';

const router = express.Router();

function getLlamacppVariantPriority(gpus) {
  const gpuNames = Array.isArray(gpus)
    ? gpus.map(gpu => String(gpu?.name || '').toLowerCase())
    : [];
  const preferRocm = gpuNames.some(name => name.includes('8060s'));
  return preferRocm ? ['rocm', 'vulkan', 'other'] : ['vulkan', 'rocm', 'other'];
}

function orderLlamacppEngine(engine, gpus) {
  if (!engine || !Array.isArray(engine.variants)) return engine;

  const priority = getLlamacppVariantPriority(gpus);
  const rankMap = new Map(priority.map((variantId, index) => [variantId, index]));
  const variants = [...engine.variants].sort((a, b) => {
    const ar = rankMap.has(a?.id) ? rankMap.get(a.id) : Number.MAX_SAFE_INTEGER;
    const br = rankMap.has(b?.id) ? rankMap.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });

  return {
    ...engine,
    variants
  };
}

async function getOrderedEngine(engineId, engine) {
  if (engineId !== 'llamacpp') return engine;
  const gpus = await getGpuInfo({ namesOnly: true }).catch(() => null);
  return orderLlamacppEngine(engine, gpus);
}

/**
 * 获取所有引擎列表（含安装状态和下载状态）
 */
router.get('/engines', async (req, res) => {
  try {
    const engines = engineManager.getEngines();
    const result = {};

    for (const [id, rawEngine] of Object.entries(engines)) {
      const engine = await getOrderedEngine(id, rawEngine);
      const installed = engineManager.getInstalledVersions(id);
      const broken = engineManager.getBrokenVersions(id);
      const installedSet = new Set(installed.map(v => v.version));
      const defaultVersion = (engineManager.getEngineVersions(id).find(v => installedSet.has(v.version))?.version) || null;

      const allStates = downloadStateManager.getAllStates();
      const downloadStates = Object.values(allStates).filter(
        s => s.type === 'engine' && (s.engineId === id || s.id === id)
      );

      result[id] = {
        ...engine,
        installed: installed.length > 0,
        installed_versions: installed,
        broken_versions: broken,
        default_version: defaultVersion,
        download_states: downloadStates,
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
    const rawEngine = engineManager.getEngine(id);
    const engine = await getOrderedEngine(id, rawEngine);

    if (!engine) {
      return res.status(404).json({ error: 'Engine not found' });
    }

    const installed = engineManager.getInstalledVersions(id);
    const broken = engineManager.getBrokenVersions(id);
    const installedSet = new Set(installed.map(v => v.version));
    const defaultVersion = (engineManager.getEngineVersions(id).find(v => installedSet.has(v.version))?.version) || null;

    res.json({
      ...engine,
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
    const { version } = req.body;

    const result = await engineDownloader.startDownloadWithDependencies(id, version);
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
