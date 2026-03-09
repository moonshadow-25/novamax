import express from 'express';
import downloadService from '../services/downloadService.js';
import eventBus from '../services/eventBus.js';

const router = express.Router();

// 开始下载
router.post('/download/start', async (req, res) => {
  try {
    const { modelId, quantizationName } = req.body;
    if (!modelId) {
      return res.status(400).json({ error: '缺少 modelId 参数' });
    }

    const downloadState = await downloadService.startDownload(modelId, quantizationName);
    eventBus.broadcast('download-progress', { modelId, status: 'downloading' });
    res.json(downloadState);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 暂停下载
router.post('/download/pause/:id', async (req, res) => {
  try {
    const { quantizationName } = req.body || {};
    const downloadState = await downloadService.pauseDownload(req.params.id, quantizationName);
    eventBus.broadcast('download-progress', { modelId: req.params.id, status: 'paused' });
    res.json(downloadState);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 恢复下载
router.post('/download/resume/:id', async (req, res) => {
  try {
    const { quantizationName } = req.body || {};
    const downloadState = await downloadService.resumeDownload(req.params.id, quantizationName);
    eventBus.broadcast('download-progress', { modelId: req.params.id, status: 'downloading' });
    res.json(downloadState);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 取消下载
router.delete('/download/:id', async (req, res) => {
  try {
    const quantizationName = req.body?.quantizationName || req.query?.q;
    const result = await downloadService.cancelDownload(req.params.id, quantizationName);
    eventBus.broadcast('model-updated', { modelId: req.params.id });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 清理所有遗留的下载状态
router.post('/download/cleanup', async (req, res) => {
  try {
    await downloadService.cleanupStaleDownloads();
    res.json({ success: true, message: '已清理遗留的下载状态' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取下载状态
router.get('/download/status/:id', async (req, res) => {
  try {
    const status = downloadService.getDownloadStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: '下载任务不存在' });
    }
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有下载任务
router.get('/download/list', async (req, res) => {
  try {
    const downloads = downloadService.getAllDownloads();
    res.json({ downloads });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
