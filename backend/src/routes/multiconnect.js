import express from 'express';
import multiConnectService from '../services/multiConnectService.js';

const router = express.Router();

// ─── 从机模式 ─────────────────────────────────────────────────────────────────

// GET /multiconnect/status
router.get('/multiconnect/status', (req, res) => {
  try {
    const status = multiConnectService.getSlaveStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /multiconnect/check-usb4
router.get('/multiconnect/check-usb4', async (req, res) => {
  try {
    const result = await multiConnectService.getUSBNetworkStatus();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /multiconnect/enable  (也支持 GET 兼容)
router.all('/multiconnect/enable', async (req, res) => {
  try {
    const port = parseInt(req.query.port || req.body?.port) || 50052;
    const ip = req.query.ip || req.body?.ip || '169.254.30.101';
    const mask = req.query.mask || req.body?.mask || '255.255.0.0';
    const result = await multiConnectService.enableSlaveMode({ port, ip, mask });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /multiconnect/disable  (也支持 GET 兼容)
router.all('/multiconnect/disable', async (req, res) => {
  try {
    const result = await multiConnectService.disableSlaveMode('api-disable');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 主机 USB 网络配置（启动前验证流程） ──────────────────────────────────────

// GET /system/usb-network-status
router.get('/system/usb-network-status', async (req, res) => {
  try {
    const result = await multiConnectService.getUSBNetworkStatus();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /system/configure-usb-network
router.post('/system/configure-usb-network', async (req, res) => {
  try {
    const { ip = '169.254.30.100', mask = '255.255.0.0' } = req.body || {};
    const result = await multiConnectService.configureUSBNetwork(ip, mask);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /system/validate-rpc-device
router.post('/system/validate-rpc-device', async (req, res) => {
  try {
    const { device } = req.body || {};
    if (!device) return res.status(400).json({ error: '缺少 device 参数' });
    const result = await multiConnectService.validateRpcDevice(device);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
