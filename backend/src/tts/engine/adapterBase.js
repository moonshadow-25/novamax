import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';

export default class AdapterBase {
  constructor(contract) {
    this.meta = contract;
    this._process = null;
    this._port = null;
    this._baseUrl = null;
    this._ready = false;
  }

  // ========= 框架提供 =========

  _resolvePython(engineDir) {
    const candidates = [
      path.join(engineDir, 'engine', 'python.exe'),
      path.join(engineDir, 'env', 'Scripts', 'python.exe'),
      path.join(engineDir, 'engine', 'bin', 'python'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error('找不到 Python 解释器');
  }

  _findFreePort() {
    return new Promise((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
      s.once('error', reject);
    });
  }

  async _waitReady() {
    const healthUrl = `${this._baseUrl}${this.meta.api_endpoints?.health || '/v1/health'}`;
    while (true) {
      if (this._process?.exitCode != null) {
        throw { code: 'ENGINE_CRASH', message: `引擎进程意外退出 (code=${this._process.exitCode})`, retryable: true };
      }
      try {
        const r = await fetch(healthUrl);
        if (r.ok) return;
      } catch {}
    }
  }

  _estimateDuration(buf) {
    const caps = this.meta.capabilities || {};
    if (buf.length > 44) {
      const dataSize = buf.readUInt32LE(40);
      const byteRate = buf.readUInt32LE(28);
      if (byteRate > 0) return dataSize / byteRate;
    }
    const rate = caps.sample_rate || 24000;
    const depth = caps.bit_depth || 16;
    const channels = caps.channels || 1;
    return buf.length / (rate * (depth / 8) * channels);
  }

  async health() {
    if (!this._ready || !this._process) {
      return { status: 'unhealthy', model_loaded: false, gpu_memory_free_mb: -1, active_requests: 0, startup_time_ms: 0 };
    }
    const url = `${this._baseUrl}${this.meta.api_endpoints?.health || '/v1/health'}`;
    try {
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      return {
        status: r.ok ? 'healthy' : 'degraded',
        model_loaded: body.model_loaded ?? r.ok,
        gpu_memory_free_mb: body.gpu_memory_free_mb ?? -1,
        gpu_memory_total_mb: body.gpu_memory_total_mb ?? -1,
        active_requests: body.active_requests ?? 0,
        startup_time_ms: body.uptime ? Math.round(body.uptime * 1000) : 0,
        last_error: body.error,
      };
    } catch (e) {
      return { status: 'unhealthy', model_loaded: false, gpu_memory_free_mb: -1, gpu_memory_total_mb: -1, active_requests: 0, startup_time_ms: 0, last_error: e.message };
    }
  }

  async getMemoryInfo() {
    const memUrl = `${this._baseUrl}${this.meta.api_endpoints?.memory || '/v1/memory'}`;
    try {
      const r = await fetch(memUrl);
      if (r.ok) return await r.json();
    } catch {}
    return { vram_used_mb: -1, vram_total_mb: -1, shared_used_mb: -1, shared_total_mb: -1, ram_used_mb: -1, ram_total_mb: -1 };
  }

  async getPid() {
    return this._process?.pid ?? null;
  }

  async getPort() {
    return this._port;
  }

  async setRuntimeConfig(key, value) {
    const cfgUrl = `${this._baseUrl}${this.meta.api_endpoints?.config}`;
    if (!cfgUrl) return;
    try {
      await fetch(cfgUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    } catch (e) {
      console.warn(`[adapter] setRuntimeConfig failed: ${e.message}`);
    }
  }

  async clearCache() {
    const url = `${this._baseUrl}${this.meta.api_endpoints?.clear_cache}`;
    if (!url) return;
    try {
      await fetch(url, { method: 'POST' });
    } catch (e) {
      console.warn(`[adapter] clearCache failed: ${e.message}`);
    }
  }

  async dispose() {
    if (this._process) {
      const pid = this._process.pid;
      if (process.platform === 'win32') {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
      } else {
        try { this._process.kill('SIGKILL'); } catch {}
      }
      this._process = null;
    }
    this._ready = false;
  }

  /** 供 engineWorker 设置进程退出回调 */
  onProcessExit(cb) {
    if (this._process) {
      this._process.on('exit', (code, signal) => {
        this._ready = false;
        cb(code, signal);
      });
    }
  }

  // ========= 子类必须覆写 =========

  async initialize(_config) {
    throw new Error('initialize() 必须由子类实现');
  }

  async synthesize(_request) {
    throw new Error('synthesize() 必须由子类实现');
  }

  _resolveModelDir(_dir) {
    return _dir;
  }
}
