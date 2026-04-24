import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
// import open from 'open';

// 尽早初始化日志收集器，拦截所有 console 输出
import logCollector from './services/logCollector.js';

import configManager from './services/configManager.js';
import modelManager from './services/modelManager.js';
import downloadService from './services/downloadService.js';
import engineManager from './services/engineManager.js';
import engineDownloader from './services/engineDownloader.js';
import processManager from './services/processManager.js';
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
import systemRouter from './routes/system.js';
import whisperRouter from './routes/whisper.js';
import ttsRouter from './routes/tts.js';
import multiconnectRouter from './routes/multiconnect.js';
import eventBus from './services/eventBus.js';

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;

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

  // 同步已下载文件记录（迁移：确保 downloaded_files 基于磁盘实际文件）
  await modelManager.syncAllDownloadedFiles();

  // 同步所有模型的已下载量化版本
  await modelManager.syncAllDownloadedQuantizations();

  // 自动启动标记了 auto_start 的 LLM 模型
  const autoStartModels = modelManager.getAll().filter(
    m => m.type === 'llm' && m.auto_start === true &&
         (m.source === 'cloudapi' || m.downloaded_files?.some(f => f.is_active))
  );
  if (autoStartModels.length > 0) {
    console.log(`自动启动 ${autoStartModels.length} 个 LLM 模型...`);
    for (const m of autoStartModels) {
      try {
        await processManager.startBackend(m.id, 'single');
        console.log(`✓ 自动启动成功: ${m.name}`);
      } catch (e) {
        console.warn(`✗ 自动启动失败 [${m.name}]:`, e.message);
      }
    }
  }

  console.log('Initialization complete');

  // 非阻塞：对缺少 sha256 的已下载文件启动后台补算（处理崩溃/旧版本遗留数据）
  downloadService.verifyMissingSHA256().catch(err =>
    console.warn('[SHA256] 启动补算异常:', err.message)
  );

  // 写当前版本的 app .installed 标记
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'backend', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
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
  ]).then(async () => {
    const cfg = configManager.get();
    const autoUpdate = cfg?.update_settings?.auto_check === true;
    if (!autoUpdate) return;

    // 启动时静默检查更新，有新版本则自动下载安装
    try {
      const result = await remoteConfigService.checkUpdate();
      if (result?.hasUpdate) {
        console.log(`[update] 发现新版本 ${result.latestVersion}，开始自动更新...`);
        await engineDownloader.startDownloadWithDependencies('app', result.latestVersion);
      }
    } catch (err) {
      console.warn('[update] 自动更新失败:', err.message);
    }
  }).catch(err => console.warn('[remoteConfig] 启动同步失败:', err.message));
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
app.use('/api', systemRouter);
app.use('/api', whisperRouter);
app.use('/api', ttsRouter);
app.use('/api', multiconnectRouter);

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

console.log("=".repeat(50));
console.log(`Startup time: ${new Date().toLocaleString()}`);
// 启动 Logo
console.log(`
  _   _                   __  __
 | \\ | | _____   ____ _  |  \\/  | __ ___  __
 |  \\| |/ _ \\ \\ / / _\` | | |\\/| |/ _\` \\ \\/ /
 | |\\  | (_) \\ V / (_| | | |  | | (_| |>  <
 |_| \\_|\\___/ \\_/ \\__,_| |_|  |_|\\__,_/_/\\_\\
`);
console.log("=".repeat(50));

async function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down, deregistering services...`);
  try {
    await processManager.shutdown();
  } catch (err) {
    console.warn('[shutdown] Error during deregistration:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

init().then(() => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`NovaMax is running!`);
    console.log(`URL: http://localhost:${PORT} (accessible from LAN on this machine's IP)`);
    console.log(`${'='.repeat(50)}\n`);

    // 等待 2 秒，检测是否有已存在的浏览器页面连接
    setTimeout(() => {
      if (eventBus.clients.size > 0) {
        // 有客户端连接，说明浏览器已打开页面，发送 reload 事件
        console.log('检测到已有浏览器页面，发送刷新信号...');
        eventBus.broadcast('server-restarted', { action: 'reload' });
      } else {
        // 未检测到浏览器页面，默认不自动打开浏览器
        console.log(`Please open http://localhost:${PORT} in your browser or use this machine's LAN IP address`);
        // 注释掉自动打开浏览器的逻辑：
        // open(`http://localhost:${PORT}`).catch(() => {
        //   console.log(`Please open http://localhost:${PORT} in your browser`);
        // });
      }
    }, 2000);
  });
  // Node.js 默认 requestTimeout 为 5 分钟，超长音频转录会被强制断开返回 502
  // 设为 0 表示不限制，由各路由自己的 AbortSignal 控制超时
  server.requestTimeout = 0;
  server.timeout = 0;
}).catch(error => {
  console.error('Failed to initialize:', error);
  process.exit(1);
});
