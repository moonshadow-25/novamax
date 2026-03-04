import express from 'express';
import processManager from '../services/processManager.js';

const router = express.Router();

// 启动单个模型（支持 mode 参数）
router.post('/backend/start/:modelId', async (req, res) => {
  try {
    const { mode } = req.query; // 'single' 或 'router'
    const result = await processManager.startBackend(req.params.modelId, mode);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动路由模式并加载所有模型
router.post('/backend/start-router/:type', async (req, res) => {
  try {
    const result = await processManager.startRouterWithAllModels(req.params.type);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/backend/stop/:modelId', async (req, res) => {
  try {
    const result = await processManager.stopBackend(req.params.modelId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/backend/status/:modelId', async (req, res) => {
  try {
    const status = processManager.getStatus(req.params.modelId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/backend/logs/:modelId', async (req, res) => {
  try {
    const logs = processManager.getLogs(req.params.modelId);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
