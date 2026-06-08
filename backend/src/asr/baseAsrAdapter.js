/**
 * BaseAsrAdapter — ASR 引擎适配器基类
 *
 * 提供所有适配器共享的能力：端口查找、健康等待、进程清理、HTTP FormData 构建。
 * 子类只需实现引擎特有的：运行时解析、启动参数构建。
 */
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

// 内联常量 — 此文件同时被构建时 esbuild 打包和运行时引擎 adapter 直接加载，不依赖外部模块
const HEALTH_POLL_MAX_MS = 90000;
const HEALTH_POLL_INTERVAL_MS = 1000;
const TRANSCRIBE_TIMEOUT_MS = 7200000;

export default class BaseAsrAdapter {
  constructor(contract, config = {}) {
    this.meta = contract;
    this._config = config;
    this._process = null;
    this._port = null;
    this._baseUrl = null;
    this._initialized = false;

    // 回调 — 由 engineWorker 设置
    this.onStdout = null;
    this.onStderr = null;
  }

  // ---- 子类必须实现 ----

  /** 解析 Python 可执行文件路径 */
  _resolveRuntime(engineDir) { throw new Error('_resolveRuntime() 未实现'); }

  /** 解析服务脚本路径 */
  _resolveScript(engineDir) { throw new Error('_resolveScript() 未实现'); }

  /** 构建启动参数数组 */
  _buildArgs(engineDir, config) { throw new Error('_buildArgs() 未实现'); }

  /** 构建进程环境变量 */
  _buildEnv(engineDir, config) { return { ...process.env, PYTHONIOENCODING: 'utf-8' }; }

  // ---- 可选重写 ----

  _buildTranscribeFormData(audioPath, params) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    if (params.language) fd.append('language', params.language);
    if (params.response_format) fd.append('response_format', params.response_format);
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);
    return fd;
  }

  _buildTranslateFormData(audioPath, params) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);
    return fd;
  }

  _transcribeEndpoint() { return '/v1/audio/transcriptions'; }
  _translateEndpoint() { return '/v1/audio/translations'; }

  // ---- 共享实现 ----

  async initialize(config) {
    if (this._initialized) return;

    const engineDir = config.enginePath || path.dirname(new URL(import.meta.url).pathname);
    const pythonExe = this._resolveRuntime(engineDir);
    const serverScript = this._resolveScript(engineDir);

    if (!fs.existsSync(pythonExe)) {
      throw { code: 'PYTHON_NOT_FOUND', message: `Python 运行环境未找到: ${pythonExe}` };
    }
    if (!fs.existsSync(config.modelFilePath)) {
      throw { code: 'MODEL_NOT_FOUND', message: `模型文件未找到: ${config.modelFilePath}` };
    }

    this._port = await this._findFreePort();
    this._baseUrl = `http://127.0.0.1:${this._port}`;

    const args = this._buildArgs(engineDir, config);
    const env = this._buildEnv(engineDir, config);

    this._process = spawn(pythonExe, args, {
      cwd: engineDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let exitCode = null;
    let spawnErr = null;
    this._process.on('error', (err) => { spawnErr = err; });
    this._process.on('exit', (code) => { exitCode = code; });

    this._process.stdout.on('data', (d) => {
      if (this.onStdout) this.onStdout(d.toString());
    });
    this._process.stderr.on('data', (d) => {
      if (this.onStderr) this.onStderr(d.toString());
    });

    const maxAttempts = Math.ceil(HEALTH_POLL_MAX_MS / HEALTH_POLL_INTERVAL_MS);
    await this._waitForReady(maxAttempts, HEALTH_POLL_INTERVAL_MS);
    if (exitCode != null) {
      throw { code: 'ENGINE_CRASH', message: `Python 进程异常退出 (code=${exitCode})${spawnErr ? ': ' + spawnErr.message : ''}` };
    }
    this._initialized = true;
  }

  async transcribe(audioPath, params = {}) {
    const fd = this._buildTranscribeFormData(audioPath, params);
    const res = await fetch(`${this._baseUrl}${this._transcribeEndpoint()}`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `${res.status}: ${t.slice(0, 500)}` };
    }
    return this._parseResponse(res);
  }

  async _parseResponse(res) {
    const body = await res.text();
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { return JSON.parse(body); } catch {}
    }
    return { text: body.trim() };
  }

  async transcribeStream(audioPath, params = {}, onDelta) {
    const fd = this._buildTranscribeFormData(audioPath, params);
    fd.append('stream', 'true');
    const res = await fetch(`${this._baseUrl}${this._transcribeEndpoint()}`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `${res.status}: ${t.slice(0, 500)}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalResult = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) onDelta({ text: parsed.text });
            if (parsed._final) finalResult = parsed;
          } catch (e) { this._lastError = e; }
        }
      }
    }
    return finalResult || { text: '' };
  }

  async translate(audioPath, params = {}) {
    const fd = this._buildTranslateFormData(audioPath, params);
    const res = await fetch(`${this._baseUrl}${this._translateEndpoint()}`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `${res.status}: ${t.slice(0, 500)}` };
    }
    return this._parseResponse(res);
  }

  async translateStream(audioPath, params = {}, onDelta) {
    const fd = this._buildTranslateFormData(audioPath, params);
    fd.append('stream', 'true');
    const res = await fetch(`${this._baseUrl}${this._translateEndpoint()}`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `${res.status}: ${t.slice(0, 500)}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalResult = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) onDelta({ text: parsed.text });
            if (parsed._final) finalResult = parsed;
          } catch (e) { this._lastError = e; }
        }
      }
    }
    return finalResult || { text: '' };
  }

  async health() {
    try {
      const r = await fetch(`${this._baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return { status: r.ok ? 'healthy' : 'unhealthy', model_loaded: r.ok };
    } catch {
      return { status: 'unhealthy', model_loaded: false };
    }
  }

  async dispose() {
    if (this._process) {
      try {
        const pid = this._process.pid;
        if (pid) {
          spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: true, stdio: 'ignore' });
        }
      } catch (e) { this._lastError = e; }
      this._process = null;
    }
    this._initialized = false;
  }

  getPid() { return this._process?.pid || null; }
  getPort() { return this._port; }

  // ---- 内部工具 ----

  _findFreePort() {
    return new Promise((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
      s.on('error', reject);
    });
  }

  async _waitForReady(maxAttempts, intervalMs) {
    for (let i = 0; i < maxAttempts; i++) {
      if (this._process?.exitCode != null) {
        throw { code: 'ENGINE_CRASH', message: `Python 进程异常退出 (code=${this._process.exitCode})` };
      }
      try {
        const r = await fetch(`${this._baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw { code: 'ENGINE_START_TIMEOUT', message: `引擎启动超时 (${maxAttempts * intervalMs / 1000}s)` };
  }
}
