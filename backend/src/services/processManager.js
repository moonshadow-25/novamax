import { spawn, execSync } from 'child_process';
import axios from 'axios';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { DEFAULT_PORTS, MODEL_STATUS, PROJECT_ROOT, MODELS_RUN_DIR } from '../config/constants.js';
import { getAuxiliaryScriptPath } from '../utils/pathHelper.js';
import { decrypt } from '../utils/crypto.js';
import modelManager from './modelManager.js';
import configManager from './configManager.js';
import engineManager from './engineManager.js';
import { generateRouterCommand, generateSingleModelCommand } from './llmRunner.js';
import parameterService from './parameterService.js';
import { checkActiveFileIntegrity } from '../utils/fileIntegrity.js';
import eventBus from './eventBus.js';
import presetService from './presetService.js';
import comfyuiRunner from './comfyuiRunner.js';
import { registerChatCompletionService, registerEmbeddingsService, stopServiceRegistration, deregisterAllServices, ensureServiceRegistration } from '../utils/serviceRegistrar.js';
import { isEmbeddingModelData } from '../utils/modelTypeHelper.js';
import multiConnectService from './multiConnectService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLOUD_API_PROXY_SCRIPT = getAuxiliaryScriptPath('utils/cloudApiProxy.js');

const isEmbeddingModel = isEmbeddingModelData;

class ProcessManager {
  constructor() {
    this.processes = new Map(); // modelId -> process info
    this.routers = new Map(); // type -> router info (llm, tts, whisper)
    this.allocatedPorts = new Set();
    this.mode = 'router'; // 'router' or 'single'
  }

  async isPortAvailable(port) {
    if (this.allocatedPorts.has(port)) {
      return false;
    }

    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
  }

  async allocatePort(type) {
    // LLM 路由模式使用 llamacpp 端口范围
    if (type === 'llm') {
      const [start, end] = configManager.get('ports').llamacpp_range;
      for (let port = start; port <= end; port++) {
        if (await this.isPortAvailable(port)) {
          this.allocatedPorts.add(port);
          return port;
        }
      }
      throw new Error('No available ports for LLM');
    }

    const configPorts = configManager.get('ports') || {};
    const portMap = {
      comfyui: configPorts.comfyui || DEFAULT_PORTS.COMFYUI,
      tts: configPorts.tts || DEFAULT_PORTS.TTS,
      whisper: configPorts.whisper || DEFAULT_PORTS.WHISPER
    };

    const basePort = portMap[type];
    if (!basePort) {
      throw new Error(`Unknown port type: ${type}`);
    }
    // 尝试 basePort 及后续 10 个端口
    for (let p = basePort; p < basePort + 10; p++) {
      if (await this.isPortAvailable(p)) {
        this.allocatedPorts.add(p);
        return p;
      }
    }
    throw new Error(`No available port starting from ${basePort}`);
  }

  /**
   * 启动后端
   * 对于 LLM 类型，根据 mode 参数决定使用单模型还是路由模式
   * @param {string} modelId - 模型 ID
   * @param {string} mode - 'single' 或 'router'（默认）
   */
  async startBackend(modelId, mode = 'router') {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    // 对于 LLM，根据 mode 选择启动方式
    if (model.type === 'llm') {
      // 云API模型使用代理服务器
      if (model.source === 'cloudapi') {
        return await this.startCloudApiProxy(modelId);
      }
      if (mode === 'single') {
        return await this.startSingleModel(modelId);
      } else {
        return await this.startLLMRouter(modelId);
      }
    }

    // 其他类型使用原有逻辑
    return await this.startLegacyBackend(modelId);
  }

  /**
   * 云API连通性测试：发送一个最小请求验证URL和密钥是否有效
   */
  async testCloudApiConnection(model) {
    const baseUrl = model.api_base_url.replace(/\/$/, '');
    const apiKey = decrypt(model.api_key);
    let response;
    try {
      response = await axios.post(`${baseUrl}/chat/completions`, {
        model: model.api_model,
        messages: [{ role: 'user', content: 'Hi' }],  // 最小请求验证
        max_tokens: 1,  // 最小请求验证
        stream: false,  // 不使用流式，快速返回结果
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 10000,
        validateStatus: () => true,
      });
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        throw new Error(`无法连接到API服务器，请检查Base URL是否正确`);
      }
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
        throw new Error(`连接超时，请检查网络或Base URL是否正确`);
      }
      throw new Error(`连接测试失败: ${err.message}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`API密钥无效或无权限（HTTP ${response.status}），请检查密钥是否正确`);
    }
  }

  /**
   * 启动云API代理服务器
   */
  async startCloudApiProxy(modelId) {
    const model = modelManager.getById(modelId);
    if (!model) throw new Error('Model not found');
    if (this.processes.has(modelId)) throw new Error('Backend already running');

    // 启动前先测试连通性
    await this.testCloudApiConnection(model);

    const effectiveParams = parameterService.getEffectiveParameters(model);
    const port = effectiveParams.port || model.port || 1234;

    if (!(await this.isPortAvailable(port))) {
      throw new Error(`端口 ${port} 已被占用，请在模型参数中修改端口号或停止占用该端口后重试`);
    }
    this.allocatedPorts.add(port);

    // 查找可用的 node 可执行文件
    const nodePath = (() => {
      const bundled = path.join(PROJECT_ROOT, 'external', 'node', 'node.exe');
      if (fs.existsSync(bundled)) return bundled;
      return process.execPath; // 使用运行当前进程的 node
    })();

    // 日志目录
    const logDir = path.join(PROJECT_ROOT, 'data', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFilePath = path.join(logDir, `model_${modelId}_runtime.log`);
    const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });
    logStream.write(`=== 云API代理启动日志 ===\n`);
    logStream.write(`模型: ${model.name} (${modelId})\n`);
    logStream.write(`时间: ${new Date().toISOString()}\n`);
    logStream.write(`端口: ${port}\n`);
    logStream.write(`平台: ${model.cloud_platform}\n`);
    logStream.write(`${'='.repeat(50)}\n\n`);

    const args = [
      CLOUD_API_PROXY_SCRIPT,
      '--api-key', decrypt(model.api_key),
      '--base-url', model.api_base_url,
      '--model-name', model.api_model,
      '--platform-name', model.cloud_platform || '云API',
      '--port', String(port),
    ];

    const proc = spawn(nodePath, args);

    const processInfo = {
      process: proc,
      port,
      type: 'llm',
      mode: 'cloudapi',
      logs: [],
      ready: false,
      logStream,
    };
    this.processes.set(modelId, processInfo);

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      processInfo.logs.push(line);
      logStream.write(line);
      console.log(`[cloudapi:${modelId}] ${line}`);
      if (!processInfo.ready && line.includes('server is listening')) {
        processInfo.ready = true;
        console.log(`[cloudapi:${modelId}] 代理已就绪`);
        eventBus.broadcast('model-updated', { modelId });
        const embedding = isEmbeddingModel(model);
        const register = embedding ? registerEmbeddingsService : registerChatCompletionService;
        register(port).catch((err) =>
          console.warn(`[service-registrar] CloudAPI registration failed: ${err.message}`)
        );
      }
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      processInfo.logs.push(line);
      logStream.write(line);
      console.log(`[cloudapi:${modelId}] ${line}`);
    });

    proc.on('error', (err) => {
      console.error(`[cloudapi:${modelId}] 进程错误: ${err.message}`);
      this.cleanup(modelId);
      eventBus.broadcast('model-updated', { modelId });
    });

    proc.on('exit', (code) => {
      console.log(`[cloudapi:${modelId}] 进程退出，退出码: ${code}`);
      logStream.write(`\n=== 进程退出，退出码: ${code}，时间: ${new Date().toISOString()} ===\n`);
      logStream.end();
      this.cleanup(modelId);
      eventBus.broadcast('model-updated', { modelId });
    });

    return { port, status: MODEL_STATUS.STARTING, mode: 'cloudapi' };
  }

  /**
   * 停止云API代理
   */
  async stopCloudApiProxy(modelId) {
    const processInfo = this.processes.get(modelId);
    if (!processInfo) throw new Error('Backend not running');
    const model = modelManager.getById(modelId);
    const embedding = isEmbeddingModel(model);
    processInfo.process.kill();
    this.cleanup(modelId);
    await stopServiceRegistration(processInfo.port, embedding);
    return { status: MODEL_STATUS.STOPPED };
  }

  /**
   * 启动单个 LLM 模型（独占模式）
   */
  async startSingleModel(modelId) {
    const model = modelManager.getById(modelId);

    if (this.processes.has(modelId)) {
      throw new Error('Backend already running');
    }

    // 检查是否有路由进程在运行
    if (this.routers.has(model.type)) {
      throw new Error('路由模式正在运行，请先停止路由模式或使用路由模式启动');
    }

    // 从模型参数中读取端口
    const effectiveParams = parameterService.getEffectiveParameters(model);
    const isEmbedding = isEmbeddingModel(model);
    const port = effectiveParams.port || (isEmbedding ? 1278 : 1234);

    // 检查端口是否本地可用
    if (!(await this.isPortAvailable(port))) {
      throw new Error(`端口 ${port} 已被占用，请在模型参数中修改端口号或停止占用该端口后重试`);
    }
    this.allocatedPorts.add(port);

    // 启动前校验激活文件完整性（纯 stat 调用，< 1ms，避免文件残缺时 llama-server 启动后报晦涩错误）
    if (!checkActiveFileIntegrity(model)) {
      this.allocatedPorts.delete(port);
      throw new Error('模型文件不完整或已被删除，请重新下载');
    }

    try {
      // RPC 多机互联：如果启用，先启动本地 rpc-server
      let rpcArg = null;
      const rpcEnable = effectiveParams.rpc_enable === true;
      const rpcDevices = Array.isArray(effectiveParams.rpc_devices) ? effectiveParams.rpc_devices.filter(Boolean) : [];

      if (rpcEnable && rpcDevices.length > 0) {
        try {
          await multiConnectService.startRpcServer(modelId);
          rpcArg = rpcDevices.join(',');

          // 旧版本（包含主机 IP）切换方式：注释上面两行，取消下面三行注释
          // const localAddr = await multiConnectService.startRpcServer(modelId);
          // const allDevices = [localAddr, ...rpcDevices];
          // rpcArg = allDevices.join(',');

          console.log(`[RPC] 启用多机互联: ${rpcArg}`);
        } catch (rpcErr) {
          throw new Error(`RPC 多机互联启动失败: ${rpcErr.message}`);
        }
      }

      // 使用单模型命令
      const cmd = generateSingleModelCommand(model, port, { rpcArg });

      console.log(`启动单模型: ${cmd.command} ${cmd.args.join(' ')}`);

      const actualVersion = model.engine_version || engineManager.getDefaultVersion('llamacpp');
      if (!actualVersion) {
        throw new Error('请先安装 llamacpp 引擎');
      }
      const llamacppPath = engineManager.getEnginePath('llamacpp', actualVersion);
      if (!llamacppPath) {
        throw new Error(`llamacpp 引擎版本 ${actualVersion} 未找到`);
      }
      const llamaServerPath = this._getLlamaServerPath(llamacppPath);

      // 构建环境变量（添加引擎目录和 ROCm 等依赖）
      const env = this._buildEngineEnv(actualVersion, llamacppPath);

      const process = spawn(llamaServerPath, cmd.args, { env });

      // 创建日志文件写入流
      const logDir = path.join(PROJECT_ROOT, 'data', 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFilePath = path.join(logDir, `model_${modelId}_runtime.log`);
      const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });
      const startTime = new Date().toISOString();
      logStream.write(`=== 模型启动日志 ===\n`);
      logStream.write(`模型: ${model.name} (${modelId})\n`);
      logStream.write(`时间: ${startTime}\n`);
      logStream.write(`端口: ${port}\n`);
      logStream.write(`命令: ${llamaServerPath} ${cmd.args.join(' ')}\n`);
      logStream.write(`${'='.repeat(50)}\n\n`);

      this.processes.set(modelId, {
        process,
        port,
        type: model.type,
        mode: 'single',
        logs: [],
        startupFailed: false,
        ready: false,
        logStream,
        watchdogTimer: null
      });

      process.stdout.on('data', (data) => {
        const log = data.toString();
        const processInfo = this.processes.get(modelId);
        if (!processInfo) return;
        processInfo.logs.push(log);
        logStream.write(log);
        console.log(`[${modelId}] ${log}`);

        // 检测模型是否真正就绪
        if (!processInfo.ready && (log.includes('server is listening') || log.includes('all slots are idle'))) {
          processInfo.ready = true;
          console.log(`[${modelId}] 模型已就绪`);
          eventBus.broadcast('model-updated', { modelId });
        }
      });

      process.stderr.on('data', (data) => {
        const log = data.toString();
        const processInfo = this.processes.get(modelId);
        if (!processInfo) return;
        processInfo.logs.push(log);
        logStream.write(log);
        console.log(`[${modelId}] ${log}`);

        // stderr 也可能包含就绪信号（llama.cpp 日志走 stderr）
        if (!processInfo.ready && (log.includes('server is listening') || log.includes('all slots are idle'))) {
          processInfo.ready = true;
          console.log(`[${modelId}] 模型已就绪`);
          eventBus.broadcast('model-updated', { modelId });
        }
      });

      process.on('error', (error) => {
        const processInfo = this.processes.get(modelId);
        if (!processInfo) return;
        if (processInfo.logStream && !processInfo.logStream.writableEnded && !processInfo.logStream.destroyed) {
          processInfo.logStream.write(`\n=== 进程错误: ${error.message}，时间: ${new Date().toISOString()} ===\n`);
        }
        console.error(`[${modelId}] 进程错误: ${error.message}`);
        this.cleanup(modelId);
        eventBus.broadcast('model-updated', { modelId });
      });

      process.on('exit', (code) => {
        const processInfo = this.processes.get(modelId);
        if (!processInfo) return;
        if (processInfo.logStream && !processInfo.logStream.writableEnded && !processInfo.logStream.destroyed) {
          processInfo.logStream.write(`\n=== 进程退出，退出码: ${code}，时间: ${new Date().toISOString()} ===\n`);
        }
        console.log(`[${modelId}] Process exited with code ${code}`);
        stopServiceRegistration(processInfo.port, isEmbedding).catch(() => {});
        this.cleanup(modelId);
        eventBus.broadcast('model-updated', { modelId });
      });

      const startupResult = new Promise((resolve, reject) => {
        const checkReady = () => {
          const processInfo = this.processes.get(modelId);
          if (processInfo?.ready) {
            cleanupStartupListeners();
            resolve();
          }
        };

        const onError = (error) => {
          cleanupStartupListeners();
          reject(new Error(`启动失败：${error.message}`));
        };

        const onExit = (code) => {
          const processInfo = this.processes.get(modelId);
          if (!processInfo || processInfo.ready) {
            return;
          }
          cleanupStartupListeners();
          reject(new Error(`启动失败：llama-server 进程提前退出（code=${code}）`));
        };

        const timeout = setTimeout(() => {
          cleanupStartupListeners();
          resolve();
        }, 1200);

        const cleanupStartupListeners = () => {
          process.off('error', onError);
          process.off('exit', onExit);
          process.stdout.off('data', checkReady);
          process.stderr.off('data', checkReady);
          clearTimeout(timeout);
        };

        process.on('error', onError);
        process.on('exit', onExit);
        process.stdout.on('data', checkReady);
        process.stderr.on('data', checkReady);
      });

      await startupResult;
      const embedding = isEmbeddingModel(model);
      const register = embedding ? registerEmbeddingsService : registerChatCompletionService;
      register(port).catch((err) =>
        console.warn(`[service-registrar] Single model registration failed: ${err.message}`)
      );

      const processInfo = this.processes.get(modelId);
      if (processInfo) {
        processInfo.watchdogTimer = setInterval(async () => {
          const latest = this.processes.get(modelId);
          if (!latest || latest.mode !== 'single') {
            if (latest?.watchdogTimer) clearInterval(latest.watchdogTimer);
            return;
          }
          if (latest.process?.exitCode !== null || latest.process?.killed) return;
          if (!latest.ready) return;

          try {
            const alive = await this._isLocalPortListening(latest.port);
            if (!alive) return;
            await ensureServiceRegistration(latest.port, embedding);
          } catch (err) {
            console.warn(`[service-registrar] Single model watchdog failed: ${err.message}`);
          }
        }, 30000);
      }

      return { port, status: MODEL_STATUS.STARTING, mode: 'single' };
    } catch (error) {
      this.allocatedPorts.delete(port);
      throw error;
    }
  }

  /**
   * 启动路由模式并加载所有已下载的模型
   */
  async startRouterWithAllModels(type) {
    // 1. 确保路由进程启动
    await this.ensureRouterRunning(type);

    const router = this.routers.get(type);
    if (!router) {
      throw new Error('Router failed to start');
    }

    // 2. 获取所有已下载的模型
    const allModels = modelManager.getByType(type);
    const downloadedModels = allModels.filter(m => m.downloaded_files?.some(f => f.is_active));

    console.log(`准备加载 ${downloadedModels.length} 个模型到路由...`);

    // 3. 逐个加载模型
    const results = [];
    for (const model of downloadedModels) {
      try {

        const loadUrl = `http://127.0.0.1:${router.port}/models/load`;
        await axios.post(loadUrl, { model: model.id }, { timeout: 60000 });


        router.modelIds.add(model.id);

        results.push({ modelId: model.id, success: true });
        console.log(`✓ 已加载模型: ${model.id}`);
      } catch (error) {
        results.push({ modelId: model.id, success: false, error: error.message });
        console.error(`✗ 加载失败: ${model.id} - ${error.message}`);
      }
    }

    const hasEmbedding = downloadedModels.some(isEmbeddingModel);
    const hasChat = downloadedModels.some((model) => !isEmbeddingModel(model));
    if (hasEmbedding) {
      registerEmbeddingsService(router.port).catch((err) =>
        console.warn(`[service-registrar] Router embeddings registration failed: ${err.message}`)
      );
    }
    if (hasChat) {
      registerChatCompletionService(router.port).catch((err) =>
        console.warn(`[service-registrar] Router chat registration failed: ${err.message}`)
      );
    }

    return {
      port: router.port,
      mode: 'router',
      loadedModels: results.filter(r => r.success).length,
      totalModels: downloadedModels.length,
      results
    };
  }

  /**
   * 启动 LLM 路由模式
   */
  async startLLMRouter(modelId) {
    const model = modelManager.getById(modelId);

    // 1. 确保路由进程已启动
    await this.ensureRouterRunning(model.type);

    // 2. 获取路由信息
    const router = this.routers.get(model.type);
    if (!router) {
      throw new Error('Router not running');
    }

    // 3. 通过 API 加载模型
    try {

      const loadUrl = `http://127.0.0.1:${router.port}/models/load`;
      await axios.post(loadUrl, { model: modelId }, { timeout: 60000 });

      // 4. 验证模型已加载
      const modelsUrl = `http://127.0.0.1:${router.port}/models`;
      const response = await axios.get(modelsUrl);
      const loadedModel = response.data.data.find(m => m.id === modelId);

      if (loadedModel?.status?.value === 'loaded') {
        const embedding = isEmbeddingModel(model);
        const register = embedding ? registerEmbeddingsService : registerChatCompletionService;
        register(router.port).catch((err) =>
          console.warn(`[service-registrar] Router model registration failed: ${err.message}`)
        );
        return { port: router.port, status: MODEL_STATUS.RUNNING, mode: 'router' };
      } else {
        throw new Error('Model failed to load');
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 确保路由进程正在运行
   */
  async ensureRouterRunning(type) {
    // 检查是否已有路由进程
    if (this.routers.has(type)) {
      const router = this.routers.get(type);
      // 检查进程是否仍在运行
      try {
        const healthUrl = `http://127.0.0.1:${router.port}/health`;
        await axios.get(healthUrl, { timeout: 2000 });
        return; // 路由已在运行
      } catch (error) {
        // 进程已停止，清理
        this.routers.delete(type);
        this.allocatedPorts.delete(router.port);
      }
    }

    // 启动新的路由进程
    const port = await this.allocatePort(type);

    try {
      // 生成 INI 预设文件
      await presetService.generatePresetFile(type);

      // 生成路由命令
      const cmd = generateRouterCommand(type, port);

      console.log(`启动路由进程: ${cmd.command} ${cmd.args.join(' ')}`);

      // 启动进程（路由模式使用默认最新版本）
      const defaultVersion = engineManager.getDefaultVersion('llamacpp');
      if (!defaultVersion) {
        throw new Error('请先安装 llamacpp 引擎');
      }
      const llamacppPath = engineManager.getEnginePath('llamacpp', defaultVersion);
      if (!llamacppPath) {
        throw new Error(`llamacpp 引擎版本 ${defaultVersion} 未找到`);
      }
      const llamaServerPath = this._getLlamaServerPath(llamacppPath);

      // 构建环境变量（添加 ROCm 等依赖）
      const env = this._buildEngineEnv(defaultVersion, llamacppPath);

      const process = spawn(llamaServerPath, cmd.args, { env });

      const routerInfo = {
        process,
        port,
        type,
        mode: 'router',
        logs: [],
        modelIds: new Set() // 跟踪已加载的模型
      };

      this.routers.set(type, routerInfo);

      // 日志处理
      process.stdout.on('data', (data) => {
        const log = data.toString();
        routerInfo.logs.push(log);
        console.log(`[Router-${type}] ${log}`);
      });

      process.stderr.on('data', (data) => {
        const log = data.toString();
        routerInfo.logs.push(log);
        console.log(`[Router-${type}] ${log}`);
      });

      process.on('error', (error) => {
        console.error(`[Router-${type}] Process error: ${error.message}`);
        this.routers.delete(type);
        this.allocatedPorts.delete(port);
      });

      process.on('exit', (code) => {
        console.log(`[Router-${type}] Process exited with code ${code}`);
        this.routers.delete(type);
        this.allocatedPorts.delete(port);
        // 注销该路由端口上注册的所有服务（chat + embedding）
        stopServiceRegistration(port, false).catch(() => {});
        stopServiceRegistration(port, true).catch(() => {});
      });

      // 等待服务器启动
      await this.waitForRouter(port);

      console.log(`✓ 路由进程已启动: ${type} on port ${port}`);

    } catch (error) {
      this.allocatedPorts.delete(port);
      throw error;
    }
  }

  /**
   * 等待路由服务器就绪
   */
  async waitForRouter(port, maxAttempts = 30) {
    const healthUrl = `http://127.0.0.1:${port}/health`;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(healthUrl, { timeout: 2000 });
        if (response.status === 200) {
          return true;
        }
      } catch (error) {
        // 继续等待
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Router failed to start');
  }

  /**
   * 停止后端
   */
  async stopBackend(modelId) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    // 云API代理模式
    if (model.source === 'cloudapi') {
      return await this.stopCloudApiProxy(modelId);
    }

    // 检查是单模型模式还是路由模式
    const processInfo = this.processes.get(modelId);
    if (processInfo && processInfo.mode === 'single') {
      // 单模型模式：直接杀进程
      return await this.stopSingleModel(modelId);
    }

    // LLM 路由模式：通过 API 卸载
    if (model.type === 'llm') {
      return await this.stopLLMModel(modelId);
    }

    // 其他类型使用原有逻辑
    return await this.stopLegacyBackend(modelId);
  }

  /**
   * 停止单模型模式
   */
  async stopSingleModel(modelId) {
    const processInfo = this.processes.get(modelId);
    if (!processInfo) {
      throw new Error('Process not running');
    }

    const model = modelManager.getById(modelId);
    const embedding = isEmbeddingModel(model);
    const port = processInfo.port;
    processInfo.process.kill();
    this.cleanup(modelId);
    // 停止对应的 RPC server（如果有）
    multiConnectService.stopRpcServer(modelId);
    await stopServiceRegistration(port, embedding);

    return { status: MODEL_STATUS.STOPPED };
  }

  /**
   * 停止 LLM 模型（通过路由 API）
   */
  async stopLLMModel(modelId) {
    const model = modelManager.getById(modelId);
    const router = this.routers.get(model.type);

    if (!router) {
      throw new Error('Router not running');
    }

    try {
      const unloadUrl = `http://127.0.0.1:${router.port}/models/unload`;
      await axios.post(unloadUrl, { model: modelId }, { timeout: 30000 });


      router.modelIds.delete(modelId);

      return { status: MODEL_STATUS.STOPPED };
    } catch (error) {
      throw new Error(`Failed to unload model: ${error.message}`);
    }
  }

  /**
   * 原有的启动方式（向后兼容）
   */
  async startLegacyBackend(modelId) {
    const model = modelManager.getById(modelId);

    if (this.processes.has(modelId)) {
      throw new Error('Backend already running');
    }

    if (model.type === 'whisper') {
      return this._startWhisperLegacyBackend(modelId, model);
    }

    if (model.type === 'tts') {
      return this._startIndextts2LegacyBackend(modelId, model);
    }

    const port = await this.allocatePort(model.type);

    try {
      const process = await this.spawnBackend(model, port);

      this.processes.set(modelId, {
        process,
        port,
        type: model.type,
        logs: [],
        ready: true
      });

      this._attachLegacyProcessListeners(modelId, process);
      return { port, status: MODEL_STATUS.RUNNING };
    } catch (error) {
      this.allocatedPorts.delete(port);
      throw error;
    }
  }

  async _startWhisperLegacyBackend(modelId, model) {
    const cfg = model.whisper_config || {};
    const port = Number(cfg.flask_port) || 8281;

    if (!(await this.isPortAvailable(port))) {
      throw new Error(`端口 ${port} 已被占用，请在 Whisper 配置中修改 Flask 端口后重试`);
    }
    this.allocatedPorts.add(port);

    try {
      const process = await this.spawnBackend(model, port);

      const logDir = path.join(PROJECT_ROOT, 'data', 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFilePath = path.join(logDir, `whisper_${modelId}_runtime.log`);
      const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });
      logStream.write(`=== Whisper 启动日志 ===\n`);
      logStream.write(`模型: ${model.name} (${modelId})\n`);
      logStream.write(`时间: ${new Date().toISOString()}\n`);
      logStream.write(`端口: ${port}\n`);
      logStream.write(`${'='.repeat(50)}\n\n`);

      this.processes.set(modelId, {
        process,
        port,
        type: model.type,
        logs: [],
        ready: false,
        logStream
      });

      this._attachLegacyProcessListeners(modelId, process, (log) => {
        const processInfo = this.processes.get(modelId);
        if (!processInfo?.ready && this._isWhisperReadyLog(log)) {
          processInfo.ready = true;
          console.log(`[${modelId}] Whisper 已就绪（日志检测）`);
          eventBus.broadcast('model-updated', { modelId });
        }
      });

      // 兜底：HTTP 轮询健康检查（应对日志未捕获的情况）
      this._monitorWhisperReadiness(modelId, port).catch(() => {});
      return { port, status: MODEL_STATUS.RUNNING };
    } catch (error) {
      this.allocatedPorts.delete(port);
      throw error;
    }
  }

  async _startIndextts2LegacyBackend(modelId, model) {
    const cfg = model.tts_config || {};
    const fixedPort = Number(cfg.api_port) || null;
    const port = fixedPort && fixedPort > 0 ? fixedPort : await this.allocatePort('tts');

    if (fixedPort) {
      if (!(await this.isPortAvailable(port))) {
        throw new Error(`端口 ${port} 已被占用，请在 TTS 配置中修改 API 端口后重试`);
      }
      this.allocatedPorts.add(port);
    }

    try {
      const process = await this.spawnBackend(model, port);

      const logDir = path.join(PROJECT_ROOT, 'data', 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFilePath = path.join(logDir, `tts_${modelId}_runtime.log`);
      const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });
      logStream.write(`=== IndexTTS2 启动日志 ===\n`);
      logStream.write(`模型: ${model.name} (${modelId})\n`);
      logStream.write(`时间: ${new Date().toISOString()}\n`);
      logStream.write(`端口: ${port}\n`);
      logStream.write(`${'='.repeat(50)}\n\n`);

      this.processes.set(modelId, {
        process,
        port,
        type: 'tts',
        logs: [],
        ready: false,
        logStream
      });

      this._attachLegacyProcessListeners(modelId, process, (log) => {
        const processInfo = this.processes.get(modelId);
        if (!processInfo?.ready && this._isIndextts2ReadyLog(log)) {
          processInfo.ready = true;
          console.log(`[${modelId}] IndexTTS2 已就绪（日志检测）`);
          eventBus.broadcast('model-updated', { modelId });
        }
      });

      return { port, status: MODEL_STATUS.RUNNING };
    } catch (error) {
      this.allocatedPorts.delete(port);
      throw error;
    }
  }

  _attachLegacyProcessListeners(modelId, process, onLog = null) {
    process.stdout.on('data', (data) => {
      const log = data.toString();
      const processInfo = this.processes.get(modelId);
      if (!processInfo) return;
      processInfo.logs.push(log);
      processInfo.logStream?.write(log);
      console.log(`[${modelId}] ${log}`);
      if (onLog) onLog(log);
    });

    process.stderr.on('data', (data) => {
      const log = data.toString();
      const processInfo = this.processes.get(modelId);
      if (!processInfo) return;
      processInfo.logs.push(log);
      processInfo.logStream?.write(log);
      console.log(`[${modelId}] ${log}`);
      if (onLog) onLog(log);
    });

    process.on('exit', (code) => {
      const processInfo = this.processes.get(modelId);
      if (processInfo?.logStream && !processInfo.logStream.writableEnded && !processInfo.logStream.destroyed) {
        processInfo.logStream.write(`\n=== 进程退出，退出码: ${code}，时间: ${new Date().toISOString()} ===\n`);
      }
      console.log(`[${modelId}] Process exited with code ${code}`);
      this.cleanup(modelId);
    });
  }

  async spawnBackend(model, port) {
    const externalPaths = configManager.get('external_paths');

    switch (model.type) {
      case 'comfyui': {
        // 使用comfyuiRunner生成启动命令
        const cmd = comfyuiRunner.generateCommand(model, port);
        console.log(`启动ComfyUI: ${cmd.command} ${cmd.args.join(' ')}`);

        return spawn(cmd.command, cmd.args, {
          cwd: cmd.cwd,
          shell: true
        });
      }

      case 'tts': {
        const requestedVersion = model.engine_version || model.remote_snapshot?.engine_version || engineManager.getDefaultVersion('tts');
        if (!requestedVersion) {
          throw new Error('请先安装 TTS 引擎');
        }

        let resolvedVersion = requestedVersion;
        let ttsEnginePath = engineManager.getEnginePath('tts', resolvedVersion);
        if (!ttsEnginePath) {
          const installed = engineManager.getInstalledVersions('tts');
          const matched = installed.find(v => String(v.version || '').toLowerCase().includes(String(requestedVersion).toLowerCase()));
          if (matched) {
            resolvedVersion = matched.version;
            ttsEnginePath = matched.path;
          }
        }
        if (!ttsEnginePath) {
          throw new Error(`TTS 引擎版本 ${requestedVersion} 未找到`);
        }

        // conda 环境: engine/python.exe；venv 环境: engine/Scripts/python.exe；Unix venv: engine/bin/python
        const engineDir = path.join(ttsEnginePath, 'engine');
        const condaPython = path.join(engineDir, 'python.exe');
        const venvPythonWin = path.join(engineDir, 'Scripts', 'python.exe');
        const venvPythonUnix = path.join(engineDir, 'bin', 'python');
        const venvPython = fs.existsSync(condaPython) ? condaPython
          : fs.existsSync(venvPythonWin) ? venvPythonWin
          : venvPythonUnix;
        if (!fs.existsSync(venvPython)) {
          throw new Error(`TTS 运行环境 Python 不存在: ${engineDir}\n请重新安装 TTS 引擎`);
        }

        const startScript = path.join(ttsEnginePath, 'start.py');
        if (!fs.existsSync(startScript)) {
          throw new Error(`TTS 启动脚本不存在: ${startScript}`);
        }

        const cfg = model.tts_config || {};
        const defaults = model.parameters || {};
        const apiPort = Number(cfg.api_port ?? defaults['api-port']) || port;
        const webuiPort = Number(cfg.webui_port ?? defaults['webui-port']) || null;
        const workers = Number(cfg.workers ?? defaults.workers) || null;
        const fp16 = (cfg.fp16 ?? defaults.fp16) === true;
        const expectedModelDir = path.join(MODELS_RUN_DIR, 'tts', model.id);
        const modelDir = fs.existsSync(expectedModelDir)
          ? expectedModelDir
          : (model.local_path && fs.existsSync(model.local_path) ? model.local_path : expectedModelDir);

        const args = [startScript, '--api-port', String(apiPort), '--model-dir', modelDir];
        if (webuiPort) args.push('--webui-port', String(webuiPort));
        if (workers) args.push('--workers', String(workers));
        if (fp16) args.push('--fp16');

        console.log(`启动TTS: ${venvPython} ${args.join(' ')}`);

        return spawn(
          venvPython,
          args,
          { cwd: ttsEnginePath }
        );
      }

      case 'whisper': {
        if (!model.path) {
          throw new Error('Whisper 模型文件未配置，请先在“管理模型”中下载 ASR 模型');
        }

        const cfg = model.whisper_config || {};
        const threadValue = Number(cfg.threads);
        const threads = Number.isFinite(threadValue) ? Math.max(1, Math.min(8, threadValue)) : 8;
        const language = String(cfg.language || 'auto');
        const enableVad = cfg.enable_vad === true;
        const whisperPort = Number(cfg.whisper_port) || 18181;
        const flaskPort = Number(cfg.flask_port) || port || 8281;

        const defaultVersion = model.engine_version || engineManager.getDefaultVersion('whisper');
        if (!defaultVersion) {
          throw new Error('请先安装 whisper 引擎');
        }

        const whisperEnginePath = engineManager.getEnginePath('whisper', defaultVersion);
        if (!whisperEnginePath) {
          throw new Error(`whisper 引擎版本 ${defaultVersion} 未找到`);
        }

        const whisperPython = path.join(whisperEnginePath, 'venv', 'Scripts', 'python.exe');
        if (!fs.existsSync(whisperPython)) {
          throw new Error(`Whisper 引擎 Python 不存在: ${whisperPython}`);
        }

        const whisperScript = path.join(whisperEnginePath, 'whisper.py');
        if (!fs.existsSync(whisperScript)) {
          throw new Error(`Whisper 启动脚本不存在: ${whisperScript}`);
        }

        const modelPath = path.isAbsolute(model.path)
          ? model.path
          : path.join(PROJECT_ROOT, model.path);

        const modelDir = path.dirname(modelPath);
        const vadFile = Array.isArray(model.models)
          ? model.models.find(item => item?.role === 'vad' && item?.filename)
          : null;
        const vadModelPath = vadFile ? path.join(modelDir, vadFile.filename) : null;

        const args = [
          whisperScript,
          '-m', modelPath,
          '-l', language,
          '-t', String(threads),
          '--whisper-port', String(whisperPort),
          '--flask-port', String(flaskPort)
        ];

        if (enableVad) {
          if (!vadModelPath || !fs.existsSync(vadModelPath)) {
            throw new Error('已启用 VAD，但卡片配置未提供有效的 VAD 模型文件');
          }
          args.push('--vad', '--vad-model', vadModelPath);
        } else {
          args.push('--no-vad');
        }

        console.log(`启动Whisper: ${whisperPython} ${args.join(' ')}`);

        return spawn(whisperPython, args, {
          cwd: whisperEnginePath,
          shell: false
        });
      }

      default:
        throw new Error(`Unknown model type: ${model.type}`);
    }
  }

  /**
   * 原有的停止方式
   */
  async stopLegacyBackend(modelId) {
    const processInfo = this.processes.get(modelId);
    if (!processInfo) {
      throw new Error('Backend not running');
    }

    this._terminateProcess(processInfo.process?.pid);
    this.cleanup(modelId);

    return { status: MODEL_STATUS.STOPPED };
  }

  /**
   * 获取 llama-server.exe 路径
   */
  _getLlamaServerPath(basePath) {
    return path.join(basePath, 'llama-server.exe');
  }

  cleanup(modelId) {
    const processInfo = this.processes.get(modelId);
    if (processInfo) {
      // 如果是ComfyUI，清理配置文件
      if (processInfo.type === 'comfyui') {
        comfyuiRunner.cleanupConfig(modelId);
      }

      if (processInfo.watchdogTimer) {
        clearInterval(processInfo.watchdogTimer);
      }

      if (processInfo.logStream && !processInfo.logStream.writableEnded && !processInfo.logStream.destroyed) {
        processInfo.logStream.end();
      }

      this.allocatedPorts.delete(processInfo.port);
      this.processes.delete(modelId);
    }
  }

  _terminateProcess(pid) {
    if (!pid) return;

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch (_) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (_) {}
    }
  }

  getStatus(modelId) {
    const processInfo = this.processes.get(modelId);
    if (!processInfo) {
      return { running: false };
    }

    if (!processInfo.ready) {
      return {
        running: false,
        starting: true,
        port: processInfo.port,
        type: processInfo.type
      };
    }

    return {
      running: true,
      port: processInfo.port,
      type: processInfo.type
    };
  }

  getRunningPortByType(type) {
    for (const [, info] of this.processes) {
      if (info.type === type && info.port) {
        return info.port;
      }
    }
    return null;
  }

  /**
   * 获取所有运行中的进程信息
   */
  getAllRunning() {
    const running = [];

    // 单模型进程
    for (const [modelId, info] of this.processes) {
      running.push({
        id: modelId,
        pid: info.process?.pid || null,
        type: info.type,
        mode: info.mode || 'single',
        port: info.port,
        category: 'model',
        startTime: info.startTime || null
      });
    }

    // 路由进程
    for (const [type, info] of this.routers) {
      running.push({
        id: `router-${type}`,
        pid: info.process?.pid || null,
        type,
        mode: 'router',
        port: info.port,
        category: 'router',
        modelIds: [...info.modelIds],
        startTime: info.startTime || null
      });
    }

    return running;
  }

  /**
   * 关闭所有进程并注销全部服务（用于主进程退出）
   */
  async shutdown() {
    // 先注销所有已注册服务
    await deregisterAllServices();

    // 清理多机互联（从机模式 + 主机 RPC servers）
    await multiConnectService.cleanup();

    // 终止所有单模型进程
    for (const [modelId, info] of this.processes) {
      try { info.process.kill(); } catch (_) {}
    }
    this.processes.clear();

    // 终止所有路由进程
    for (const [, info] of this.routers) {
      try { info.process.kill(); } catch (_) {}
    }
    this.routers.clear();
    this.allocatedPorts.clear();
  }

  getLogs(modelId) {
    const model = modelManager.getById(modelId);
    if (!model) {
      return [];
    }

    // 检查路由模式
    if (model.type === 'llm') {
      const router = this.routers.get(model.type);
      if (router) {
        return router.logs;
      }
    }

    // 检查单模型模式
    const processInfo = this.processes.get(modelId);
    if (!processInfo) {
      return [];
    }
    return processInfo.logs;
  }

  async _monitorWhisperReadiness(modelId, port, maxAttempts = 60) {
    const processInfo = this.processes.get(modelId);
    if (!processInfo || processInfo.ready || processInfo._whisperReadyChecking) return;

    processInfo._whisperReadyChecking = true;
    try {
      for (let i = 0; i < maxAttempts; i++) {
        const latest = this.processes.get(modelId);
        if (!latest || latest.ready) return;

        try {
          const resp = await axios.get(`http://127.0.0.1:${port}/health`, { timeout: 1000 });
          if (resp.status >= 200 && resp.status < 500) {
            latest.ready = true;
            eventBus.broadcast('model-updated', { modelId });
            return;
          }
        } catch (_) {
          // ignore and retry
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      const latest = this.processes.get(modelId);
      if (latest) latest._whisperReadyChecking = false;
    }
  }

  _isWhisperReadyLog(log = '') {
    return log.includes('Running on http://') || log.includes('服务地址:') || log.includes('Serving on http://');
  }

  _isIndextts2ReadyLog(log = '') {
    return log.includes('Application startup complete') || log.includes('Uvicorn running on');
  }

  async _isLocalPortListening(port) {
    try {
      const resp = await axios.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 });
      return resp.status >= 200 && resp.status < 500;
    } catch (_) {
      return false;
    }
  }

  /**
   * 构建引擎启动所需的环境变量
   * 根据引擎版本添加必要的 PATH（如 ROCm）
   */
  _buildEngineEnv(engineVersion, enginePath) {
    const env = { ...process.env };

    // 1. 添加引擎自己的目录到 PATH（用于加载 ggml.dll 等）
    if (enginePath && fs.existsSync(enginePath)) {
      env.PATH = `${enginePath};${env.PATH}`;
      console.log(`Added engine path to PATH: ${enginePath}`);
    }

    // 2. 如果指定了引擎版本，查找对应的 ROCm 版本
    if (engineVersion) {
      const engine = engineManager.getEngine('llamacpp');
      if (engine) {
        const versionInfo = engine.versions.find(v => v.version === engineVersion);
        if (versionInfo && versionInfo.rocm_version) {
          const rocmBasePath = path.join(PROJECT_ROOT, 'external', 'rocm', versionInfo.rocm_version);
          const rocmBinPath = path.join(rocmBasePath, 'Lib', 'site-packages', 'torch', 'lib', 'rocm', 'bin');
          if (fs.existsSync(rocmBinPath)) {
            env.PATH = `${rocmBinPath};${env.PATH}`;
            console.log(`Added ROCm ${versionInfo.rocm_version} to PATH: ${rocmBinPath}`);
          } else {
            console.warn(`ROCm bin not found at ${rocmBinPath}`);
          }
        }
      }
    }

    return env;
  }
}

export default new ProcessManager();
