import { spawn } from 'child_process';
import path from 'path';
import net from 'net';
import fs from 'fs';
import { PROJECT_ROOT } from '../config/constants.js';
import engineManager from './engineManager.js';
import {
  getUSB4Adapters as scanUSB4Adapters,
  configureSingleUSBAdapter,
  configureMultiUSBAdapters,
  destroyNetworkBridge,
  DEFAULT_MASK
} from '../utils/windowsNetworkUtils.js';

const MASTER_IP = '169.254.30.100';
const SLAVE_IP_PREFIX = '169.254.30.';
const DEFAULT_RPC_PORT = 50052;
const RPC_LOG_DIR = path.join(PROJECT_ROOT, 'data', 'logs');

class MultiConnectService {
  constructor() {
    this._rpcProcess = null;       // 从机 rpc-server 进程
    this._slaveConfig = {};        // { port, ip, mask, network_mode }
    this._bridgeInfo = null;       // { bridge } when bridge mode enabled
    this._slaveLogStream = null;   // 从机日志流
    this._rpcServers = new Map();  // modelId -> { process, port, address, logStream }
  }

  // ─── 工具方法 ────────────────────────────────────────────────────────────────

  _getRpcServerPath() {
    const version = engineManager.getDefaultVersion('llamacpp');
    if (!version) return null;
    const enginePath = engineManager.getEnginePath('llamacpp', version);
    if (!enginePath) return null;

    return path.join(enginePath, 'rpc-server.exe');
  }

  _createRpcLogStream(kind) {
    fs.mkdirSync(RPC_LOG_DIR, { recursive: true });
    const normalizedKind = kind === 'host' ? 'master' : kind;
    const filename = `rpc_${normalizedKind}.log`;
    const filePath = path.join(RPC_LOG_DIR, filename);
    const stream = fs.createWriteStream(filePath, { flags: 'w' });
    stream.write(`=== RPC Log Start (${new Date().toISOString()}) ===\n`);
    return { filePath, stream };
  }

  _bindProcessLogging(proc, prefix, logStream) {
    proc.stdout.on('data', (d) => {
      const line = d.toString();
      console.log(`${prefix} ${line.trim()}`);
      if (logStream && !logStream.destroyed) logStream.write(`[stdout] ${line}`);
    });

    proc.stderr.on('data', (d) => {
      const line = d.toString();
      console.log(`${prefix} ${line.trim()}`);
      if (logStream && !logStream.destroyed) logStream.write(`[stderr] ${line}`);
    });
  }

  async _isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '0.0.0.0');
    });
  }

  async _findAvailablePort(startPort) {
    for (let p = startPort; p < startPort + 20; p++) {
      if (await this._isPortAvailable(p)) return p;
    }
    throw new Error(`无法找到可用端口（从 ${startPort} 开始）`);
  }

  _normalizeEnableArgs(portOrConfig, ip, mask) {
    if (typeof portOrConfig === 'object' && portOrConfig !== null) {
      return {
        port: Number.parseInt(portOrConfig.port, 10) || DEFAULT_RPC_PORT,
        ip: portOrConfig.ip || `${SLAVE_IP_PREFIX}101`,
        mask: portOrConfig.mask || DEFAULT_MASK
      };
    }

    return {
      port: Number.parseInt(portOrConfig, 10) || DEFAULT_RPC_PORT,
      ip: ip || `${SLAVE_IP_PREFIX}101`,
      mask: mask || DEFAULT_MASK
    };
  }

  async _applySlaveNetwork(adapters, ip, mask) {
    if (!Array.isArray(adapters) || adapters.length === 0) {
      throw new Error('未检测到 USB4/直连网卡');
    }

    if (adapters.length === 1) {
      this._bridgeInfo = null;
      return await configureSingleUSBAdapter(adapters[0], ip, mask);
    }

    const result = await configureMultiUSBAdapters(adapters, ip, mask);
    this._bridgeInfo = result.bridge ? { bridge: result.bridge } : null;
    return result;
  }

  // ─── USB4 网卡检测 ────────────────────────────────────────────────────────────

  async getUSB4Adapters() {
    try {
      return await scanUSB4Adapters();
    } catch (e) {
      console.warn('[multiconnect] USB4 检测失败:', e.message);
      return [];
    }
  }

  // ─── 网络配置 ─────────────────────────────────────────────────────────────────

  async configureUSBNetwork(ip = MASTER_IP, mask = DEFAULT_MASK) {
    const adapters = await this.getUSB4Adapters();
    const result = await this._applySlaveNetwork(adapters, ip, mask);

    return {
      adapters: adapters.map(a => a.name),
      ip,
      mask,
      ...result
    };
  }

  async getUSBNetworkStatus() {
    const adapters = await this.getUSB4Adapters();
    return {
      adapters,
      adapter_count: adapters.length,
      connected: adapters.length > 0
    };
  }

  async validateRpcDevice(device) {
    // device 格式: "IP:port"
    const [host, portStr] = device.split(':');
    const port = parseInt(portStr) || DEFAULT_RPC_PORT;
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000;
      socket.setTimeout(timeout);
      socket.once('connect', () => {
        socket.destroy();
        resolve({ device, reachable: true });
      });
      socket.once('error', () => {
        socket.destroy();
        resolve({ device, reachable: false, error: '连接失败' });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve({ device, reachable: false, error: '连接超时' });
      });
      socket.connect(port, host);
    });
  }

  // ─── 从机模式 ─────────────────────────────────────────────────────────────────

  async enableSlaveMode(portOrConfig = DEFAULT_RPC_PORT, ip = `${SLAVE_IP_PREFIX}101`, mask = DEFAULT_MASK) {
    if (this._rpcProcess) {
      return {
        status: 'enabled',
        port: this._slaveConfig.port,
        ip: this._slaveConfig.ip,
        mask: this._slaveConfig.mask,
        network_mode: this._slaveConfig.network_mode
      };
    }

    const cfg = this._normalizeEnableArgs(portOrConfig, ip, mask);

    const rpcServerPath = this._getRpcServerPath();
    if (!rpcServerPath) throw new Error('未找到 rpc-server，请先安装 llamacpp 引擎');
    if (!fs.existsSync(rpcServerPath)) throw new Error(`未找到 rpc-server 可执行文件: ${rpcServerPath}`);

    // 启动 rpc-server（从机模式严格使用用户指定端口，不自动递增）
    const actualPort = cfg.port;
    if (!Number.isInteger(actualPort) || actualPort < 1024 || actualPort > 65535) {
      throw new Error('端口无效，请设置 1024-65535 之间的端口');
    }
    if (!(await this._isPortAvailable(actualPort))) {
      throw new Error(`端口 ${actualPort} 已被占用，请更换端口后重试`);
    }

    const adapters = await this.getUSB4Adapters();
    if (adapters.length === 0) {
      throw new Error('未检测到 USB4/直连网卡');
    }

    const { stream: slaveLogStream, filePath: slaveLogPath } = this._createRpcLogStream('slave');
    slaveLogStream.write(`command: ${rpcServerPath} -H 0.0.0.0 -p ${actualPort} -c\n`);

    const proc = spawn(rpcServerPath, ['-H', '0.0.0.0', '-p', String(actualPort), '-c'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this._slaveLogStream = slaveLogStream;
    this._bindProcessLogging(proc, '[rpc-server]', slaveLogStream);

    proc.on('error', (err) => {
      console.error(`[rpc-server] 启动失败: ${err.message}`);
      if (this._slaveLogStream && !this._slaveLogStream.destroyed) {
        this._slaveLogStream.write(`[error] ${err.message}\n`);
        this._slaveLogStream.end();
      }
      this._slaveLogStream = null;
      this._rpcProcess = null;
      this._slaveConfig = {};
    });

    proc.on('exit', (code, signal) => {
      const exitText = code === null ? `signal=${signal || 'unknown'}` : `code=${code}`;
      console.log(`[rpc-server] 进程退出，${exitText}`);
      if (this._slaveLogStream && !this._slaveLogStream.destroyed) {
        this._slaveLogStream.write(`[exit] ${exitText} at ${new Date().toISOString()}\n`);
        this._slaveLogStream.end();
      }
      this._slaveLogStream = null;
      this._rpcProcess = null;
      this._slaveConfig = {};
    });

    this._rpcProcess = proc;

    try {
      await this._waitForPort(actualPort, 10, proc, 'slave rpc-server');

      const networkResult = await this._applySlaveNetwork(adapters, cfg.ip, cfg.mask);
      const appliedIp = networkResult.applied_ip || cfg.ip;

      this._slaveConfig = {
        port: actualPort,
        ip: appliedIp,
        requested_ip: cfg.ip,
        mask: cfg.mask,
        network_mode: networkResult.network_mode || (adapters.length > 1 ? 'bridge' : 'single')
      };

      return {
        status: 'enabled',
        port: actualPort,
        ip: appliedIp,
        requested_ip: cfg.ip,
        mask: cfg.mask,
        network_mode: this._slaveConfig.network_mode,
        log_file: slaveLogPath,
        adapters: adapters.map(a => a.name),
        adapter_count: adapters.length,
        ...networkResult
      };
    } catch (e) {
      try { proc.kill(); } catch (_) {}
      // 网络异常时尽量回滚桥接
      if (this._bridgeInfo) {
        await destroyNetworkBridge().catch(() => {});
        this._bridgeInfo = null;
      }
      if (this._slaveLogStream && !this._slaveLogStream.destroyed) {
        this._slaveLogStream.write(`[startup-failed] ${e.message}\n`);
        this._slaveLogStream.end();
      }
      this._slaveLogStream = null;
      this._rpcProcess = null;
      this._slaveConfig = {};
      throw e;
    }
  }

  async disableSlaveMode(reason = 'manual') {
    if (this._rpcProcess) {
      try { this._rpcProcess.kill(); } catch (_) {}
      this._rpcProcess = null;
    }

    if (this._slaveLogStream && !this._slaveLogStream.destroyed) {
      const normalizedReason = reason || 'manual';
      this._slaveLogStream.write(`[manual-stop:${normalizedReason}] at ${new Date().toISOString()}\n`);
      this._slaveLogStream.end();
    }
    this._slaveLogStream = null;

    if (this._bridgeInfo) {
      await destroyNetworkBridge().catch(() => {});
      this._bridgeInfo = null;
    }

    this._slaveConfig = {};
    return { status: 'disabled' };
  }

  getSlaveStatus() {
    if (!this._rpcProcess) {
      return { status: 'disabled', port: null, ip: null, mask: null, network_mode: null };
    }

    return {
      status: 'enabled',
      port: this._slaveConfig.port,
      ip: this._slaveConfig.ip,
      requested_ip: this._slaveConfig.requested_ip,
      mask: this._slaveConfig.mask,
      network_mode: this._slaveConfig.network_mode
    };
  }

  // ─── 主机 RPC 服务管理 ────────────────────────────────────────────────────────

  async startRpcServer(modelId) {
    if (this._rpcServers.has(modelId)) {
      return this._rpcServers.get(modelId).address;
    }

    const rpcServerPath = this._getRpcServerPath();
    if (!rpcServerPath) throw new Error('未找到 rpc-server，请先安装 llamacpp 引擎');
    if (!fs.existsSync(rpcServerPath)) throw new Error(`未找到 rpc-server 可执行文件: ${rpcServerPath}`);

    const port = await this._findAvailablePort(DEFAULT_RPC_PORT);
    const { stream: logStream, filePath: logPath } = this._createRpcLogStream('host');
    logStream.write(`command: ${rpcServerPath} -H 0.0.0.0 -p ${port}\n`);

    const proc = spawn(rpcServerPath, ['-H', '0.0.0.0', '-p', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this._bindProcessLogging(proc, `[rpc-server:${modelId}]`, logStream);

    proc.on('error', (err) => {
      console.error(`[rpc-server:${modelId}] 启动失败: ${err.message}`);
      if (!logStream.destroyed) {
        logStream.write(`[error] ${err.message}\n`);
        logStream.end();
      }
      this._rpcServers.delete(modelId);
    });

    proc.on('exit', (code) => {
      if (!logStream.destroyed) {
        logStream.write(`[exit] code=${code} at ${new Date().toISOString()}\n`);
        logStream.end();
      }
      this._rpcServers.delete(modelId);
    });

    const address = `${MASTER_IP}:${port}`;
    this._rpcServers.set(modelId, { process: proc, port, address, logStream, logPath });

    try {
      // 等待端口就绪
      await this._waitForPort(port, 10, proc, `model ${modelId} rpc-server`);
    } catch (e) {
      try { proc.kill(); } catch (_) {}
      this._rpcServers.delete(modelId);
      throw e;
    }

    return address;
  }

  async _waitForPort(port, maxAttempts = 10, proc = null, processName = 'rpc-server') {
    for (let i = 0; i < maxAttempts; i++) {
      // 进程已退出，直接失败
      if (proc && proc.exitCode !== null) {
        throw new Error(`${processName} 启动失败：进程已退出（code=${proc.exitCode}）`);
      }

      const available = await this._isPortAvailable(port);
      if (!available) return true; // 端口被占用说明服务已启动
      await new Promise(r => setTimeout(r, 500));
    }

    throw new Error(`${processName} 启动超时：端口 ${port} 未就绪`);
  }

  getRpcServerAddress(modelId) {
    return this._rpcServers.get(modelId)?.address || null;
  }

  stopRpcServer(modelId) {
    const info = this._rpcServers.get(modelId);
    if (info) {
      if (info.logStream && !info.logStream.destroyed) {
        info.logStream.write(`[manual-stop] at ${new Date().toISOString()}\n`);
      }
      try { info.process.kill(); } catch (_) {}
      this._rpcServers.delete(modelId);
    }
  }

  cleanupAllRpcServers() {
    for (const [modelId] of this._rpcServers) {
      this.stopRpcServer(modelId);
    }
  }

  // 应用退出时清理
  async cleanup() {
    await this.disableSlaveMode('service-cleanup');
    this.cleanupAllRpcServers();
  }
}

export default new MultiConnectService();
