import express from 'express';
import fs from 'fs';
import path from 'path';
import engineManager from '../services/engineManager.js';
import engineDownloader from '../services/engineDownloader.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';
import downloadStateManager from '../services/downloadStateManager.js';
import processManager from '../services/processManager.js';
import { getGpuInfo } from './system.js';
import { getGpuArchInfo, recommendGpuBackend } from '../utils/gpuArchDetection.js';
import configManager from '../services/configManager.js';
import { getModuleForEngine } from '../config/modules.js';

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

function getLlamacppVariantPriority(gpus) {
  const primaryGpu = (Array.isArray(gpus) ? gpus : [])
    .find(g => g?.vendor && g.vendor !== 'unknown') || null;

  if (!primaryGpu) return ['vulkan', 'other'];

  const backend = recommendGpuBackend(primaryGpu, 'llamacpp');
  // 不兼容的 GPU 后端排到最后（AMD 不可用 CUDA，NVIDIA 不可用 ROCm）
  if (backend === 'rocm') return ['rocm', 'vulkan', 'other', 'cuda'];
  if (backend === 'cuda') return ['cuda', 'vulkan', 'other', 'rocm'];

  return ['vulkan', 'other'];
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

/**
 * 根据 GPU 厂商返回不可用的 GPU 后端列表
 * CUDA 仅 NVIDIA 可用，ROCm 仅 AMD 可用
 * @param {string|null} vendor
 * @returns {string[]}
 */
function getIncompatibleBackends(vendor) {
  if (vendor === 'nvidia') return ['rocm'];
  if (vendor === 'amd') return ['cuda'];
  if (vendor === 'intel') return ['cuda', 'rocm'];
  return [];
}

/**
 * 给 llama.cpp variants 标注 recommended（第一个 = 最优）与 incompatible（与当前 GPU 不兼容）
 */
function annotateLlamacppRecommendations(engine, gpus) {
  if (!engine?.variants) return engine;
  const primaryGpu = (Array.isArray(gpus) ? gpus : [])
    .find(g => g?.vendor && g.vendor !== 'unknown') || null;
  const backend = primaryGpu ? recommendGpuBackend(primaryGpu, 'llamacpp') : null;
  const incompatibleSet = primaryGpu
    ? new Set(getIncompatibleBackends(primaryGpu.vendor))
    : new Set();

  const variants = engine.variants.map((v, i) => ({
    ...v,
    recommended: i === 0 || (backend && v.id === backend),
    incompatible: incompatibleSet.has(v.gpu_backend),
  }));

  return {
    ...engine,
    variants,
    // llama.cpp 的 GPU 后端互斥：前端 banner 只提示已安装或推荐的后端
    variant_mode: 'single',
  };
}

/**
 * 给 ComfyUI runtimes 标注 recommended
 * runtimes 结构: { rocm: [...], cuda: [...] }
 */
function annotateComfyuiRuntimes(engine, gpus) {
  if (!engine?.runtimes) return engine;
  const primaryGpu = (Array.isArray(gpus) ? gpus : [])
    .find(g => g?.vendor && g.vendor !== 'unknown') || null;
  if (!primaryGpu) return engine;

  const backend = recommendGpuBackend(primaryGpu, 'comfyui');
  const { arch: gpuArch } = getGpuArchInfo(primaryGpu);

  const annotated = {};
  for (const [key, runtimes] of Object.entries(engine.runtimes)) {
    if (!Array.isArray(runtimes)) { annotated[key] = runtimes; continue; }
    annotated[key] = runtimes.map((rt, idx) => ({
      ...rt,
      // AMD: 精确匹配 arch；NVIDIA: 推荐第一个（CUDA 向下兼容）
      recommended: key === backend && (
        backend === 'cuda' ? idx === 0 : (gpuArch && rt.arch === gpuArch)
      ),
    }));
  }
  return { ...engine, runtimes: annotated };
}

async function getOrderedEngine(engineId, engine) {
  if (engineId === 'llamacpp' && engine?.variants) {
    const gpus = await getGpuInfo({ namesOnly: false }).catch(() => null);
    return annotateLlamacppRecommendations(orderLlamacppEngine(engine, gpus), gpus);
  }
  // ComfyUI: 给每个 runtime 标记 recommended
  if (engineId === 'comfyui' && engine?.runtimes) {
    const gpus = await getGpuInfo({ namesOnly: false }).catch(() => null);
    return annotateComfyuiRuntimes(engine, gpus);
  }
  return engine;
}

/**
 * 获取所有引擎列表（含安装状态和下载状态）
 */
router.get('/engines', async (req, res) => {
  try {
    const engines = engineManager.getEngines();
    const result = {};
    const modulesConfig = configManager.get().modules || {};

    for (const [id, rawEngine] of Object.entries(engines)) {
      // 跳过已禁用模块的关联引擎
      const engineModule = getModuleForEngine(id);
      if (engineModule) {
        if (modulesConfig[engineModule.id]?.enabled === false) {
          console.log(`[engines] 跳过已禁用模块 "${engineModule.id}" 的引擎 "${id}"`);
          continue;
        }
      }

      const engine = await getOrderedEngine(id, rawEngine);
      const installed = engineManager.getInstalledVersions(id);
      const broken = engineManager.getBrokenVersions(id);
      const installedSet = new Set(installed.map(v => v.version));
      const defaultVersion = (engineManager.getEngineVersions(id).find(v => installedSet.has(v.version))?.version) || null;

      const allStates = downloadStateManager.getAllStates();
      const downloadStates = Object.values(allStates).filter(
        s => s.type === 'engine' && (
          s.engineId === id ||
          s.id === id ||
          // 包含关联的 runtime 下载（如 comfyui_runtime_rocm:rdna35）
          (s.id && s.id.startsWith(`${id}_runtime_`))
        )
      );

      let engineWithLocalVariants = id === 'tts'
        ? injectLocalTtsVariants(engine, installed)
        : engine;

      result[id] = {
        ...engineWithLocalVariants,
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

    // 检查模块是否被禁用
    const engineModule = getModuleForEngine(id);
    if (engineModule) {
      const modulesConfig = configManager.get().modules || {};
      if (modulesConfig[engineModule.id]?.enabled === false) {
        return res.status(404).json({ error: `模块 "${engineModule.nameZh || engineModule.id}" 已禁用` });
      }
    }

    const installed = engineManager.getInstalledVersions(id);
    const broken = engineManager.getBrokenVersions(id);
    const installedSet = new Set(installed.map(v => v.version));
    const defaultVersion = (engineManager.getEngineVersions(id).find(v => installedSet.has(v.version))?.version) || null;

    let engineWithLocalVariants = id === 'tts'
      ? injectLocalTtsVariants(engine, installed)
      : engine;

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
    let engine = engineManager.getEngine(id);

    if (!engine) {
      const engines = engineManager.getEngines();
      engine = (engines.tts?.variants || []).find(e => normalizeEngineType(e.id) === normalizeEngineType(id));
    }

    if (!engine) {
      return res.status(404).json({ error: 'Engine not found' });
    }

    // 检查模块是否被禁用
    const engineModuleCheck = getModuleForEngine(id);
    if (engineModuleCheck) {
      const modulesConfig = configManager.get().modules || {};
      if (modulesConfig[engineModuleCheck.id]?.enabled === false) {
        return res.status(404).json({ error: `模块 "${engineModuleCheck.nameZh || engineModuleCheck.id}" 已禁用` });
      }
    }

    const installed = engineManager.isInstalled(id);
    const defaultVersion = engineManager.getDefaultVersion(id);
    // 应用 GPU 排序/推荐标注，让下载弹窗默认选择正确的 variant（如 NVIDIA→cuda、AMD→rocm）
    const orderedEngine = await getOrderedEngine(id, engine);

    res.json({
      installed,
      engineInfo: orderedEngine,
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

    // 引擎 → 关联模型类型
    const engineModelTypes = {
      llamacpp: ['llm'],
      comfyui:  ['comfyui'],
      tts:      ['tts'],
      asr:      ['whisper']
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

    // 如果引擎有 runtimes 但未指定，自动根据 GPU 选择推荐
    let finalRuntime = runtime || null;
    if (!finalRuntime) {
      const eng = engineManager.getEngine(id);
      if (eng?.runtimes) {
        const gpus = await getGpuInfo({ namesOnly: false }).catch(() => null);
        const primaryGpu = (Array.isArray(gpus) ? gpus : [])
          .find(g => g?.vendor && g.vendor !== 'unknown') || null;
        if (primaryGpu) {
          const backend = recommendGpuBackend(primaryGpu, id);
          if (backend) {
            // NVIDIA/CUDA: 推荐第一个 runtime（向下兼容）
            // AMD/ROCm: 精确匹配 GPU arch
            if (backend === 'cuda') {
              const cudaRuntimes = eng.runtimes?.cuda;
              if (Array.isArray(cudaRuntimes) && cudaRuntimes.length > 0) {
                finalRuntime = `cuda:${cudaRuntimes[0].arch}`;
              }
            } else {
              const { arch: gpuArch } = getGpuArchInfo(primaryGpu);
              if (gpuArch) {
                finalRuntime = `${backend}:${gpuArch}`;
              }
            }
            if (finalRuntime) {
              console.log(`[engines] 自动选择 runtime: ${finalRuntime}（GPU: ${primaryGpu.name}）`);
            }
          }
        }
      }
    }

    const result = await engineDownloader.startDownloadWithDependencies(id, version, finalRuntime);
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

/* ── 引擎下载暂停 ── */
router.post('/engines/download-pause/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const state = downloadStateManager.getFullState(taskId);
    if (!state || state.type !== 'engine') return res.status(404).json({ error: 'Task not found' });
    engineDownloader.pauseDownload(state.id, state.targetQuantization);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 引擎下载恢复 ── */
router.post('/engines/download-resume/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const state = downloadStateManager.getFullState(taskId);
    if (!state || state.type !== 'engine') return res.status(404).json({ error: 'Task not found' });

    // 确定要恢复的引擎和版本
    let resumeEngineId, resumeVersion, resumeRuntime;
    if (state._parentEngineId) {
      // 运行时下载 — 恢复父引擎下载
      resumeEngineId = state._parentEngineId;
      resumeVersion = state._engineVersion;
    } else {
      resumeEngineId = state.engineId || state.id;
      resumeVersion = state._engineVersion || state.targetQuantization;
      resumeRuntime = state._runtimeId || null;
    }
    if (!resumeVersion) return res.status(400).json({ error: '无法确定恢复版本' });

    // 清理旧状态，重新开始下载
    downloadStateManager.deleteState(taskId);
    const result = await engineDownloader.startDownloadWithDependencies(resumeEngineId, resumeVersion, resumeRuntime);
    res.json({ success: true, tasks: result.tasks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── 引擎下载取消 ── */
router.post('/engines/download-cancel/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const state = downloadStateManager.getFullState(taskId);
    if (!state || state.type !== 'engine') return res.status(404).json({ error: 'Task not found' });
    engineDownloader.cancelDownload(state.id, state.targetQuantization);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
