/**
 * Whisper.cpp ASR Adapter — 管理 Python whisper 服务器子进程，通过 HTTP 通信。
 *
 * 约定：引擎安装目录需包含:
 *   venv/Scripts/python.exe    — Python 运行时
 *   whisper.py                 — Flask 服务入口
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';

export default class WhisperCppAdapter {
  constructor(contract) {
    this.meta = contract;
    this._process = null;
    this._flaskPort = null;
    this._baseUrl = null;
    this._initialized = false;
  }

  // ========== IAsrEngine 接口 ==========

  /**
   * 启动 Python whisper 服务
   * @param {object} config
   * @param {string} config.modelFilePath  - GGML 模型文件路径
   * @param {string} [config.language]     - 默认语言
   * @param {number} [config.threads]      - CPU 线程数
   * @param {boolean} [config.enableVad]   - 是否启用 VAD
   * @param {string} [config.vadFilePath]  - VAD 模型文件路径
   */
  async initialize(config) {
    if (this._initialized) return;

    // enginePath 由 asrWorker 传入，指向 whisper 引擎安装目录（含 whisper.py + venv/）
    const engineDir = config.enginePath || path.dirname(fileURLToPath(import.meta.url));
    const pythonExe = this._resolvePython(engineDir);
    const serverScript = this._resolveScript(engineDir);

    if (!fs.existsSync(pythonExe)) {
      throw { code: 'PYTHON_NOT_FOUND', message: `Python 运行环境未找到: ${pythonExe}` };
    }
    if (!fs.existsSync(config.modelFilePath)) {
      throw { code: 'MODEL_NOT_FOUND', message: `ASR 模型文件未找到: ${config.modelFilePath}` };
    }

    this._flaskPort = await this._findFreePort();
    this._baseUrl = `http://127.0.0.1:${this._flaskPort}`;

    const whisperPort = await this._findFreePort();

    // 自动探测 VAD 模型（和 ASR 模型同目录下的 ggml-silero 文件）
    const modelDir = path.dirname(config.modelFilePath);
    const vadFilePath = (() => {
      if (config.vadFilePath && fs.existsSync(config.vadFilePath)) return config.vadFilePath;
      const silero = path.join(modelDir, 'ggml-silero-v6.2.0.bin');
      return fs.existsSync(silero) ? silero : null;
    })();

    const args = [
      serverScript,
      '-m', config.modelFilePath,
      '-l', config.language || 'auto',
      '-t', String(config.threads || 4),
      '--whisper-port', String(whisperPort),
      '--flask-port', String(this._flaskPort),
    ];

    if (vadFilePath) {
      args.push('--vad', '--vad-model', vadFilePath);
    }

    this._process = spawn(pythonExe, args, {
      cwd: engineDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this._process.stdout.on('data', (d) => {
      if (this._onStdout) this._onStdout(String(d));
    });
    this._process.stderr.on('data', (d) => {
      if (this._onStderr) this._onStderr(String(d));
    });

    // 等待 Flask 服务就绪
    await this._waitForReady();
    this._initialized = true;
  }

  /**
   * 转录 (非流式)
   */
  async transcribe(audioPath, params = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    if (params.language) fd.append('language', params.language);
    if (params.response_format) fd.append('response_format', params.response_format);
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);
    if (params.vad_filter != null) fd.append('vad_filter', String(params.vad_filter));

    const res = await fetch(`${this._baseUrl}/audio/transcriptions`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(7200000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `引擎返回 ${res.status}: ${text}` };
    }
    return res.json();
  }

  /**
   * 转录 (流式)
   * @param {string} audioPath
   * @param {object} params
   * @param {Function} onDelta  - 每个 delta 片段的回调
   */
  async transcribeStream(audioPath, params = {}, onDelta) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    fd.append('stream', 'true');
    if (params.language) fd.append('language', params.language);
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);
    if (params.vad_filter != null) fd.append('vad_filter', String(params.vad_filter));

    const res = await fetch(`${this._baseUrl}/audio/transcriptions`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(7200000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `引擎返回 ${res.status}: ${text}` };
    }

    // 读取 SSE 流
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              onDelta?.({ text: parsed.text });
            }
            if (parsed._final) {
              finalResult = parsed;
            }
          } catch {}
        }
      }
    }

    return finalResult || { text: this._lastText || '' };
  }

  /**
   * 翻译为英文
   */
  async translate(audioPath, params = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);

    const res = await fetch(`${this._baseUrl}/audio/translations`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(7200000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `引擎返回 ${res.status}: ${text}` };
    }
    return res.json();
  }

  /**
   * 翻译 (流式)
   */
  async translateStream(audioPath, params = {}, onDelta) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    fd.append('stream', 'true');
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);

    const res = await fetch(`${this._baseUrl}/audio/translations`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(7200000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw { code: 'ENGINE_ERROR', message: `引擎返回 ${res.status}: ${text}` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) onDelta?.({ text: parsed.text });
            if (parsed._final) finalResult = parsed;
          } catch {}
        }
      }
    }
    return finalResult || { text: '' };
  }

  /** 健康检查 */
  async health() {
    try {
      const r = await fetch(`${this._baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return { status: r.ok ? 'healthy' : 'unhealthy', model_loaded: r.ok };
    } catch {
      return { status: 'unhealthy', model_loaded: false };
    }
  }

  /** 释放资源 */
  async dispose() {
    if (this._process) {
      try {
        const pid = this._process.pid;
        if (pid) {
          spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: true, stdio: 'ignore' });
        }
      } catch {}
      this._process = null;
    }
    this._initialized = false;
  }

  getPid() {
    return this._process?.pid || null;
  }

  getPort() {
    return this._flaskPort;
  }

  // ========== 内部方法 ==========

  _resolvePython(engineDir) {
    // 优先使用引擎自带的 venv
    const candidates = [
      path.join(engineDir, 'venv', 'Scripts', 'python.exe'),
      path.join(engineDir, 'engine', 'python.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // 回退到系统 Python
    return 'python';
  }

  _resolveScript(engineDir) {
    const candidates = [
      path.join(engineDir, 'whisper.py'),
      path.join(engineDir, 'api', 'whisper.py'),
      path.join(engineDir, 'src', 'whisper.py'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return path.join(engineDir, 'whisper.py');
  }

  _findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  async _waitForReady(maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const r = await fetch(`${this._baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw { code: 'ENGINE_START_TIMEOUT', message: 'Whisper 引擎启动超时' };
  }
}
