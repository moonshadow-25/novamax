import { spawn } from 'child_process';
import axios from 'axios';
import path from 'path';
import { DEFAULT_PORTS, MODEL_STATUS, PROJECT_ROOT } from '../config/constants.js';
import modelManager from './modelManager.js';
import configManager from './configManager.js';
import { generateRouterCommand, generateSingleModelCommand } from './llmRunner.js';
import presetService from './presetService.js';

class ProcessManager {
  constructor() {
    this.processes = new Map(); // modelId -> process info
    this.routers = new Map(); // type -> router info (llm, tts, whisper)
    this.allocatedPorts = new Set();
    this.mode = 'router'; // 'router' or 'single'
  }

  async isPortAvailable(port) {
    return !this.allocatedPorts.has(port);
  }

  async allocatePort(type) {
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

    const portMap = {
      comfyui: DEFAULT_PORTS.COMFYUI,
      tts: DEFAULT_PORTS.TTS,
      whisper: DEFAULT_PORTS.WHISPER
    };

    const port = portMap[type];
    if (await this.isPortAvailable(port)) {
      this.allocatedPorts.add(port);
      return port;
    }
    throw new Error(`Port ${port} is already in use`);
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

    const port = await this.allocatePort(model.type);


    try {
      // 使用单模型命令
      const cmd = generateSingleModelCommand(model, port);

      console.log(`启动单模型: ${cmd.command} ${cmd.args.join(' ')}`);

      const externalPaths = configManager.get('external_paths');
      const llamaServerPath = path.join(PROJECT_ROOT, externalPaths.llamacpp, 'vulkan', 'llama-server.exe');

      const process = spawn(llamaServerPath, cmd.args);

      this.processes.set(modelId, {
        process,
        port,
        type: model.type,
        mode: 'single',
        logs: [],
        startupFailed: false
      });

      process.stdout.on('data', (data) => {
        const log = data.toString();
        this.processes.get(modelId).logs.push(log);
        console.log(`[${modelId}] ${log}`);
      });

      process.stderr.on('data', (data) => {
        const log = data.toString();
        this.processes.get(modelId).logs.push(log);
        console.error(`[${modelId}] ${log}`);
      });

      process.on('error', async (error) => {
        console.error(`[${modelId}] Process error: ${error.message}`);
        const processInfo = this.processes.get(modelId);
        if (processInfo) {
          processInfo.startupFailed = true;
        }
        this.cleanup(modelId);
      });

      process.on('exit', (code) => {
        console.log(`[${modelId}] Process exited with code ${code}`);
        this.cleanup(modelId);
      });

      // 等待进程稳定启动（避免立即崩溃）
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const processInfo = this.processes.get(modelId);
          if (processInfo?.startupFailed) {
            reject(new Error('进程启动失败'));
          } else {
            resolve();
          }
        }, 2000);

        process.on('error', () => {
          clearTimeout(timeout);
          reject(new Error('进程启动失败'));
        });

        process.on('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`进程异常退出，退出码: ${code}`));
          }
        });
      });


      return { port, status: MODEL_STATUS.RUNNING, mode: 'single' };
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
    const downloadedModels = allModels.models.filter(m => m.downloaded);

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

      // 启动进程
      const externalPaths = configManager.get('external_paths');
      const llamaServerPath = path.join(PROJECT_ROOT, externalPaths.llamacpp, 'vulkan', 'llama-server.exe');

      const process = spawn(llamaServerPath, cmd.args);

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
        console.error(`[Router-${type}] ${log}`);
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

    processInfo.process.kill();
    this.cleanup(modelId);

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

    const port = await this.allocatePort(model.type);


    try {
      const process = await this.spawnBackend(model, port);

      this.processes.set(modelId, {
        process,
        port,
        type: model.type,
        logs: []
      });

      process.stdout.on('data', (data) => {
        const log = data.toString();
        this.processes.get(modelId).logs.push(log);
        console.log(`[${modelId}] ${log}`);
      });

      process.stderr.on('data', (data) => {
        const log = data.toString();
        this.processes.get(modelId).logs.push(log);
        console.error(`[${modelId}] ${log}`);
      });

      process.on('exit', (code) => {
        console.log(`[${modelId}] Process exited with code ${code}`);
        this.cleanup(modelId);
      });


      return { port, status: MODEL_STATUS.RUNNING };
    } catch (error) {
      this.allocatedPorts.delete(port);
      throw error;
    }
  }

  async spawnBackend(model, port) {
    const externalPaths = configManager.get('external_paths');

    switch (model.type) {
      case 'comfyui':
        return spawn(
          'python',
          [
            `${externalPaths.comfyui}/main.py`,
            '--port', port.toString(),
            '--listen', '127.0.0.1'
          ],
          { shell: true }
        );

      case 'tts':
        return spawn(
          'python',
          [
            `${externalPaths.indextts}/server.py`,
            '--port', port.toString(),
            '--model', model.path
          ],
          { shell: true }
        );

      case 'whisper':
        return spawn(
          `${externalPaths.whispercpp}/server`,
          [
            '-m', model.path,
            '--port', port.toString()
          ],
          { shell: true }
        );

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

    processInfo.process.kill();
    this.cleanup(modelId);


    return { status: MODEL_STATUS.STOPPED };
  }

  cleanup(modelId) {
    const processInfo = this.processes.get(modelId);
    if (processInfo) {
      this.allocatedPorts.delete(processInfo.port);
      this.processes.delete(modelId);
    }
  }

  getStatus(modelId) {
    const processInfo = this.processes.get(modelId);
    if (!processInfo) {
      return { running: false };
    }

    return {
      running: true,
      port: processInfo.port,
      type: processInfo.type
    };
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
}

export default new ProcessManager();
