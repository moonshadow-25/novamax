import express from 'express';
import axios from 'axios';
import processManager from '../services/processManager.js';

const router = express.Router();

router.post('/llm/:modelId/chat', async (req, res) => {
  try {
    const status = processManager.getStatus(req.params.modelId);
    if (!status.running) {
      return res.status(400).json({ error: 'Model not running' });
    }

    const response = await axios.post(
      `http://localhost:${status.port}/v1/chat/completions`,
      {
        messages: req.body.messages,
        stream: req.body.stream || false,
        temperature: req.body.temperature || 0.7,
        max_tokens: req.body.max_tokens || 2000
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/llm/:modelId/complete', async (req, res) => {
  try {
    const status = processManager.getStatus(req.params.modelId);
    if (!status.running) {
      return res.status(400).json({ error: 'Model not running' });
    }

    const response = await axios.post(
      `http://localhost:${status.port}/completion`,
      {
        prompt: req.body.prompt,
        temperature: req.body.temperature || 0.7,
        max_tokens: req.body.max_tokens || 2000
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/llm/:modelId/info', async (req, res) => {
  try {
    const status = processManager.getStatus(req.params.modelId);
    if (!status.running) {
      return res.status(400).json({ error: 'Model not running' });
    }

    const response = await axios.get(`http://localhost:${status.port}/v1/models`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
