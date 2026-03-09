import express from 'express';
import configManager from '../services/configManager.js';
import eventBus from '../services/eventBus.js';

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

export default router;
