import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import treeKill from 'tree-kill';
import configManager from './configManager.js';
import engineManager from './engineManager.js';
import openaiProxyService from './openaiProxyService.js';
import { PROJECT_ROOT, DATA_DIR } from '../config/constants.js';

/**
 * ComfyUI 多实例管理器
 * 管理多个 ComfyUI 进程，每个实例独立运行在不同端口
 */
class ComfyUIInstanceManager {
  constructor() {
    this.processes = new Map(); // instanceId -> { process, config, status }
  }

  /**
   * 获取所有实例配置
   */
  async getInstances() {
    const instances = configManager.get('comfyui_instances') || [];
    const instancesWithStatus = await Promise.all(
      instances.map(async (instance) => ({
        ...instance,
        status: await this.getInstanceStatus(instance.id, instance.host, instance.port)
      }))
    );
    return instancesWithStatus;
  }

  /**
   * 获取单个实例配置
   */
  getInstance(instanceId) {
    const instances = configManager.get('comfyui_instances') || [];
    return instances.find(i => i.id === instanceId);
  }

  /**
   * 创建新实例
   */
  createInstance(config) {
    const instances = configManager.get('comfyui_instances') || [];

    // 如果未指定引擎版本，使用最新版本
    let engineVersion = config.engine_version;
    if (!engineVersion) {
      engineVersion = engineManager.getDefaultVersion('comfyui');
    }

    const newInstance = {
      id: `instance_${Date.now()}`,
      name: config.name || '新实例',
      host: config.host || '0.0.0.0',
      port: config.port || 8188,
      engine_version: engineVersion,
      custom_args: config.custom_args || ''
    };
    instances.push(newInstance);
    configManager.set('comfyui_instances', instances);
    return newInstance;
  }

  /**
   * 更新实例配置
   */
  updateInstance(instanceId, updates) {
    const instances = configManager.get('comfyui_instances') || [];
    const index = instances.findIndex(i => i.id === instanceId);
    if (index === -1) throw new Error('Instance not found');

    instances[index] = { ...instances[index], ...updates };
    configManager.set('comfyui_instances', instances);
    return instances[index];
  }

  /**
   * 删除实例
   */
  deleteInstance(instanceId) {
    // 先停止进程
    if (this.processes.has(instanceId)) {
      this.stopInstance(instanceId);
    }

    const instances = configManager.get('comfyui_instances') || [];
    const filtered = instances.filter(i => i.id !== instanceId);
    configManager.set('comfyui_instances', filtered);
  }

  /**
   * 启动实例
   */
  async startInstance(instanceId) {
    const config = this.getInstance(instanceId);
    if (!config) throw new Error('Instance not found');

    // 检查是否已经在运行
    if (this.processes.has(instanceId)) {
      const info = this.processes.get(instanceId);
      if (info.process && !info.process.killed) {
        return { success: true, message: 'Already running', port: config.port };
      }
    }

    // 获取引擎路径
    const enginePath = engineManager.getEnginePath('comfyui', config.engine_version);
    if (!enginePath) throw new Error('ComfyUI engine not found');

    const venvPython = path.join(enginePath, 'venv', 'Scripts', 'python.exe');
    const modelsDir = path.join(PROJECT_ROOT, 'data', 'models_dir', 'comfyui', 'models');

    // 生成 extra_model_paths.yaml
    const configDir = path.join(DATA_DIR, 'comfyui_config');
    const configPath = path.join(configDir, `${instanceId}.yaml`);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const yamlContent = `comfyui:
  base_path: ${modelsDir.replace(/\\/g, '/')}
  checkpoints: checkpoints
  clip: clip
  clip_vision: clip_vision
  configs: configs
  controlnet: controlnet
  diffusers: diffusers
  diffusion_models: diffusion_models
  embeddings: embeddings
  gligen: gligen
  hypernetworks: hypernetworks
  latent_upscale_models: latent_upscale_models
  loras: loras
  photomaker: photomaker
  style_models: style_models
  text_encoders: text_encoders
  unet: unet
  upscale_models: upscale_models
  vae: vae
  vae_approx: vae_approx
`;
    fs.writeFileSync(configPath, yamlContent, 'utf-8');

    // 构建启动参数
    const args = [
      path.join(enginePath, 'main.py'),
      '--port', String(config.port),
      '--listen', config.host,
      '--extra-model-paths-config', configPath
    ];

    // 添加自定义参数
    if (config.custom_args && config.custom_args.trim()) {
      const customArgsList = config.custom_args.trim().split(/\s+/);
      args.push(...customArgsList);
    }

    // 启动进程（不使用 shell，避免安全警告）
    const childProc = spawn(venvPython, args, {
      cwd: enginePath,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
    });

    const logs = [];
    const MAX_LOGS = 200;
    const pushLog = (line) => {
      logs.push(line);
      if (logs.length > MAX_LOGS) logs.shift();
    };

    // 捕获输出
    childProc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      pushLog(line);
      console.log(`[ComfyUI ${instanceId}] ${line}`);
    });

    childProc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      pushLog(`[ERROR] ${line}`);
      console.error(`[ComfyUI ${instanceId} ERROR] ${line}`);
    });

    childProc.on('exit', (code) => {
      console.log(`ComfyUI instance ${instanceId} exited with code ${code}`);
      const info = this.processes.get(instanceId);
      if (info) {
        if (code === 0) {
          this.processes.delete(instanceId);
        } else {
          info.status = 'crashed';
          info.exitCode = code;
        }
      }
    });

    childProc.on('error', (err) => {
      console.error(`ComfyUI instance ${instanceId} spawn error:`, err);
      const info = this.processes.get(instanceId);
      if (info) {
        info.status = 'crashed';
        info.exitCode = -1;
        info.exitTime = Date.now();
        pushLog(`[SPAWN ERROR] ${err.message}`);
      }
    });

    this.processes.set(instanceId, { process: childProc, config, status: 'running', startTime: Date.now(), logs });

    console.log(`ComfyUI instance ${instanceId} started: ${venvPython} ${args.join(' ')}`);
    return { success: true, port: config.port, host: config.host };
  }

  /**
   * 停止实例
   */
  stopInstance(instanceId) {
    const info = this.processes.get(instanceId);
    if (!info) {
      return { success: true, message: 'Not running' };
    }

    // 已经退出的进程，直接清理记录
    if (info.status === 'crashed' || info.status === 'stopped') {
      this.processes.delete(instanceId);
      return { success: true };
    }

    if (!info.process || info.process.killed) {
      this.processes.delete(instanceId);
      return { success: true, message: 'Not running' };
    }

    treeKill(info.process.pid, 'SIGTERM', (err) => {
      if (err) console.error(`Kill instance ${instanceId} error:`, err);
    });

    this.processes.delete(instanceId);
    return { success: true };
  }

  /**
   * 获取实例状态（通过连接检查）
   */
  async getInstanceStatus(instanceId, host, port) {
    const info = this.processes.get(instanceId);
    if (!info) {
      return 'stopped';
    }

    // 进程已退出（crashed / stopped）
    if (info.status === 'crashed' || info.status === 'stopped') {
      return info.status;
    }

    // 进程存在，检查端口是否真的在监听
    try {
      const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      const result = await openaiProxyService.checkConnection(connectHost, port);
      return result.connected ? 'running' : 'starting';
    } catch {
      return 'starting'; // 进程存在但端口未就绪
    }
  }

  /**
   * 获取所有运行中的 ComfyUI 进程（供系统信息 API 使用）
   */
  getRunningProcesses() {
    const running = [];
    for (const [instanceId, info] of this.processes) {
      // 包含 running / starting / crashed 状态
      if (info.status === 'stopped') continue;
      running.push({
        id: `comfyui-${instanceId}`,
        pid: info.process?.pid || null,
        type: 'comfyui',
        mode: 'instance',
        port: info.config.port,
        category: 'model',
        name: `ComfyUI - ${info.config.name || instanceId}`,
        startTime: info.startTime || null,
        status: info.status,
        exitCode: info.exitCode ?? null
      });
    }
    return running;
  }

  /**
   * 获取实例日志
   */
  getLogs(instanceId) {
    const info = this.processes.get(instanceId);
    return info?.logs || [];
  }

  /**
   * 初始化：不再自动创建默认实例
   */
  init() {
    console.log('ComfyUI instance manager initialized');
  }

  /**
   * 确保至少有一个实例（延迟创建）
   */
  ensureDefaultInstance() {
    const instances = configManager.get('comfyui_instances');
    if (!instances || instances.length === 0) {
      const defaultVersion = engineManager.getDefaultVersion('comfyui');
      if (!defaultVersion) {
        throw new Error('ComfyUI engine not installed');
      }
      return this.createInstance({
        name: '默认实例',
        host: '0.0.0.0',
        port: 8188,
        engine_version: defaultVersion,
        custom_args: ''
      });
    }
    return instances[0];
  }
}

export default new ComfyUIInstanceManager();
