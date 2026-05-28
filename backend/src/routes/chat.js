import express from 'express';
import axios from 'axios';

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { question, history } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const response = await axios.post(
      'https://bbs.firstarpc.com/ai/api/chat',
      {
        question,
        history: history || []
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000
      }
    );

    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

export default router;
