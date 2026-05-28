import express from 'express';
import path from 'path';
import { exec } from 'child_process';
import processManager from '../services/processManager.js';
import eventBus from '../services/eventBus.js';
import { PROJECT_ROOT } from '../config/constants.js';

const router = express.Router();

// 启动单个模型（支持 mode 参数）
router.post('/backend/start/:modelId', async (req, res) => {
  try {
    const { mode } = req.query; // 'single' 或 'router'
    const result = await processManager.startBackend(req.params.modelId, mode);
    eventBus.broadcast('model-updated', { modelId: req.params.modelId });
    res.json(result);
  } catch (error) {
    console.error(`[backend/start] ${req.params.modelId} mode=${req.query.mode || 'router'} failed: ${error.stack || error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 启动路由模式并加载所有模型
router.post('/backend/start-router/:type', async (req, res) => {
  try {
    const result = await processManager.startRouterWithAllModels(req.params.type);
    eventBus.broadcast('model-updated', { type: req.params.type });
    res.json(result);
  } catch (error) {
    console.error(`[backend/start-router] ${req.params.type} failed: ${error.stack || error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post('/backend/stop/:modelId', async (req, res) => {
  try {
    const result = await processManager.stopBackend(req.params.modelId);
    eventBus.broadcast('model-updated', { modelId: req.params.modelId });
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

/**
 * 打开模型日志文件夹
 * POST /api/backend/open-logs
 */
router.post('/backend/open-logs', (req, res) => {
  try {
    const logDir = path.join(PROJECT_ROOT, 'data', 'logs');
    const command = process.platform === 'win32'
      ? `start "" "${logDir}"`
      : process.platform === 'darwin'
      ? `open "${logDir}"`
      : `xdg-open "${logDir}"`;

    exec(command, (error) => {
      if (error) {
        return res.status(500).json({ error: '打开文件夹失败' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
