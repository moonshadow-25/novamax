import express from 'express';
import configManager from '../services/configManager.js';
import eventBus from '../services/eventBus.js';
import remoteConfigService from '../services/remoteConfigService.js';
import updateService from '../services/updateService.js';

const router = express.Router();

router.get('/config', async (req, res) => {
  try {
    const config = configManager.get();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    await configManager.set(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/config/theme', async (req, res) => {
  try {
    const theme = configManager.get('theme');
    res.json({ theme });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config/theme', async (req, res) => {
  try {
    await configManager.set('theme', req.body.theme);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/config/favorites', async (req, res) => {
  try {
    const favorites = configManager.get('favorites') || [];
    res.json({ favorites });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config/favorites', async (req, res) => {
  try {
    await configManager.set('favorites', req.body.favorites || []);
    eventBus.broadcast('favorites-updated', { favorites: req.body.favorites || [] });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 端口配置
router.get('/config/ports', async (req, res) => {
  try {
    const config = configManager.get();
    const ports = config.ports || {};

    // 兼容旧格式并返回新格式
    const result = {
      llm_range: {
        start: ports.llm_range?.start || ports.llamacpp_range?.[0] || 8080,
        end: ports.llm_range?.end || ports.llamacpp_range?.[1] || 8089
      },
      comfyui: ports.comfyui || 8188,
      tts: ports.tts || 5000,
      whisper: ports.whisper || 5001
    };

    res.json({ ports: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config/ports', async (req, res) => {
  try {
    await configManager.set('ports', req.body.ports);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新设置
router.get('/config/update-settings', async (req, res) => {
  try {
    const config = configManager.get();
    const updateSettings = config.update_settings || {
      auto_check: true,
      last_check: null,
      channel: 'stable',
      server_url: 'https://api.novamax.com'
    };
    res.json({ updateSettings });
  } catch (error) {
    console.error('Get update settings error:', error);
    // 返回默认值而不是错误
    res.json({
      updateSettings: {
        auto_check: true,
        last_check: null,
        channel: 'stable',
        server_url: 'https://api.novamax.com'
      }
    });
  }
});

router.put('/config/update-settings', async (req, res) => {
  try {
    await configManager.set('update_settings', req.body.updateSettings);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 远程配置同步
router.post('/remote-config/sync', async (req, res) => {
  try {
    const result = await remoteConfigService.syncModels();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/remote-config/status', async (req, res) => {
  try {
    const config = configManager.get();
    res.json({
      server_url: config?.update_settings?.server_url || 'https://api.novamax.com',
      last_sync: config?.update_settings?.last_sync || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 软件更新
router.get('/update/check', async (req, res) => {
  try {
    const result = await remoteConfigService.checkUpdate();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/update/status', (req, res) => {
  res.json(updateService.getState());
});


router.post('/update/apply', async (req, res) => {
  try {
    await updateService.applyUpdate();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
