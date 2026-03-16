import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import open from 'open';

import configManager from './services/configManager.js';
import modelManager from './services/modelManager.js';
import downloadService from './services/downloadService.js';
import engineManager from './services/engineManager.js';
import comfyuiInstanceManager from './services/comfyuiInstanceManager.js';
import remoteConfigService from './services/remoteConfigService.js';
import { PROJECT_ROOT } from './config/constants.js';

import modelsRouter from './routes/models.js';
import backendRouter from './routes/backend.js';
import llmRouter from './routes/llm.js';
import comfyuiRouter from './routes/comfyui.js';
import configRouter from './routes/config.js';
import modelscopeRouter from './routes/modelscope.js';
import downloadRouter from './routes/download.js';
import parametersRouter from './routes/parameters.js';
import enginesRouter from './routes/engines.js';
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
  await engineManager.init();
  comfyuiInstanceManager.init(); // 初始化 ComfyUI 实例管理器

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

  // 写当前版本的 app .installed 标记
  try {
    const _require = createRequire(import.meta.url);
    const pkg = _require(path.join(__dirname, '../package.json'));
    const currentVersion = pkg.version || '0.0.0';
    const appMarkerDir = path.join(PROJECT_ROOT, 'external', 'app', currentVersion);
    fs.mkdirSync(appMarkerDir, { recursive: true });
    const markerPath = path.join(appMarkerDir, '.installed');
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath, JSON.stringify({
        installed_at: new Date().toISOString(), engine: 'app'
      }));
    }
  } catch (e) {
    console.warn('[init] 写 app .installed 标记失败:', e.message);
  }

  // 非阻塞并行拉取远程配置
  Promise.all([
    remoteConfigService.syncModels(),
    remoteConfigService.syncEngines()
  ]).catch(err => console.warn('[remoteConfig] 启动同步失败:', err.message));
}

app.use('/api', modelsRouter);
app.use('/api', backendRouter);
app.use('/api', llmRouter);
app.use('/api', comfyuiRouter);
app.use('/api', configRouter);
app.use('/api', modelscopeRouter);
app.use('/api', downloadRouter);
app.use('/api', parametersRouter);
app.use('/api', enginesRouter);

// SSE 实时事件推送
app.get('/api/events', (req, res) => {
  eventBus.addClient(res);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

import { getFrontendDistPath } from './utils/pathHelper.js';
const frontendPath = getFrontendDistPath();
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
