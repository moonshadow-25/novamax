import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';

import configManager from './services/configManager.js';
import modelManager from './services/modelManager.js';
import downloadService from './services/downloadService.js';

import modelsRouter from './routes/models.js';
import backendRouter from './routes/backend.js';
import llmRouter from './routes/llm.js';
import comfyuiRouter from './routes/comfyui.js';
import configRouter from './routes/config.js';
import modelscopeRouter from './routes/modelscope.js';
import downloadRouter from './routes/download.js';
import parametersRouter from './routes/parameters.js';
import eventBus from './services/eventBus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

async function init() {
  console.log('Initializing NovaMax...');
  await configManager.init();
  await modelManager.init();

  // 一次性清理所有临时状态字段（重构后不再需要持久化这些字段）
  console.log('清理旧的临时状态字段...');
  const allModels = modelManager.getAll();
  let cleanedCount = 0;

  for (const model of allModels) {
    if (model.download_status || model.download_progress !== undefined ||
        model.download_error || model.downloading_quantization) {
      await modelManager.update(model.id, {
        download_status: undefined,
        download_progress: undefined,
        download_error: undefined,
        downloading_quantization: undefined
      });
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`✓ 已清理 ${cleanedCount} 个模型的临时状态字段`);
  } else {
    console.log('✓ 没有需要清理的临时状态字段');
  }

  // 在 modelManager 初始化完成后，临时状态已经不需要清理了
  await downloadService.cleanupStaleDownloads();

  // 同步所有模型的已下载量化版本
  await modelManager.syncAllDownloadedQuantizations();

  console.log('Initialization complete');
}

app.use('/api', modelsRouter);
app.use('/api', backendRouter);
app.use('/api', llmRouter);
app.use('/api', comfyuiRouter);
app.use('/api', configRouter);
app.use('/api', modelscopeRouter);
app.use('/api', downloadRouter);
app.use('/api', parametersRouter);

// SSE 实时事件推送
app.get('/api/events', (req, res) => {
  eventBus.addClient(res);
});

const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendPath, 'index.html'));
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`NovaMax is running!`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`${'='.repeat(50)}\n`);

    setTimeout(() => {
      open(`http://localhost:${PORT}`).catch(() => {
        console.log(`Please open http://localhost:${PORT} in your browser`);
      });
    }, 1000);
  });
}).catch(error => {
  console.error('Failed to initialize:', error);
  process.exit(1);
});
