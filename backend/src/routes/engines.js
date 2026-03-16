import express from 'express';
import engineManager from '../services/engineManager.js';
import engineDownloader from '../services/engineDownloader.js';
import downloadStateManager from '../services/downloadStateManager.js';

const router = express.Router();

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

      // 查找该引擎是否有进行中的下载
      const allStates = downloadStateManager.getAllStates();
      const downloadState = Object.values(allStates).find(
        s => s.type === 'engine' && (s.engineId === id || s.id === id)
      );

      result[id] = {
        ...engine,
        installed: installed.length > 0,
        installed_versions: installed,
        broken_versions: broken,
        default_version: defaultVersion,
        download_state: downloadState || null
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
