/**
 * Adapter 端到端测试。
 *
 * 启动 Mock Python API → 创建 adapter → initialize → synthesize → 验证音频。
 * 这是除 Python 进程本身外的最完整链路测试。
 */
import { describe, it, before, after } from 'node:test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { assertEqual, assert, createTempDir, cleanupTempDir } from './test-setup.js';
import { createMockPythonApi } from './mock-python-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Adapter end-to-end', () => {
  /** @type {ReturnType<typeof createMockPythonApi>} */
  let mockApi;
  let mockPort;
  let adapter;
  let tempDir;
  let contract;

  before(async () => {
    mockApi = createMockPythonApi({ synthesizeDelay: 10 });
    mockPort = await mockApi.start();
    tempDir = createTempDir();

    // 构建最小 contract（模拟 indextts2）
    contract = {
      contract_version: '5.0',
      engine: {
        type: 'test-engine',
        name: 'Test TTS Engine',
        version: '1.0.0',
        entry_point: 'api/main.py',
        env: { PYTHONUNBUFFERED: '1' },
      },
      api_endpoints: {
        health: '/v1/health',
        speech: '/v1/audio/speech',
        clear_cache: '/v1/cache/clear',
        memory: '/v1/memory',
      },
      capabilities: {
        voice_modes: ['clone'],
        max_text_length: 1000,
        output_formats: ['wav', 'mp3'],
        sample_rate: 24000,
        bit_depth: 16,
        channels: 1,
        supports_streaming: false,
        max_concurrency: 1,
      },
    };

    // 动态加载 adapter 基类（绕过 __dirname 问题，直接在 engine/adapterBase 基础上创建最小子类）
    const { default: AdapterBase } = await import('../../src/tts/engine/adapterBase.js');

    adapter = new (class extends AdapterBase {
      async initialize(config) {
        if (this._ready) return;
        this._port = mockPort;
        this._baseUrl = `http://127.0.0.1:${this._port}`;
        // 模拟 minimal initialize — 不真正 spawn Python
        this._process = { pid: 99999, exitCode: null };
        await this._waitReady();
        this._ready = true;
      }

      async synthesize(request) {
        if (!this._ready) throw { code: 'MODEL_NOT_READY', message: 'not ready', retryable: true };

        const resp = await fetch(`${this._baseUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: request.text,
            response_format: request.output_format || 'wav',
            ...request.params,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          throw { code: 'INTERNAL_ERROR', message: errText, retryable: resp.status >= 500 };
        }

        const audio = Buffer.from(await resp.arrayBuffer());
        const duration = this._estimateDuration(audio);
        const elapsed = 0.1;

        const outputFile = request.output_dir
          ? path.join(request.output_dir, `${request.request_id || Date.now()}.${request.output_format || 'wav'}`)
          : '';
        if (outputFile) {
          fs.mkdirSync(path.dirname(outputFile), { recursive: true });
          fs.writeFileSync(outputFile, audio);
        }

        return { audio, duration_seconds: duration, rtf: duration > 0 ? elapsed / duration : 0, output_path: outputFile };
      }
    })(contract);
  });

  after(async () => {
    if (adapter) await adapter.dispose().catch(() => {});
    if (mockApi) await mockApi.stop();
    cleanupTempDir(tempDir);
  });

  it('initialize → health → synthesize → 返回有效 WAV', async () => {
    await adapter.initialize({ modelDir: '/tmp', deviceId: -1, custom: {} });

    // 1. Health check
    const health = await adapter.health();
    assertEqual(health.status, 'healthy');
    assert(health.model_loaded, 'model 已加载');

    // 2. Synthesize
    const result = await adapter.synthesize({
      text: '你好，测试文本。',
      voice: { id: 'AAAAAA', mode: 'clone', reference_audio: null },
      output_format: 'wav',
      output_dir: tempDir,
      params: {},
    });

    // 3. 验证返回的音频是有效 WAV
    const buf = result.audio;
    assert(buf.length > 44, `音频数据足够大: ${buf.length} bytes`);
    assertEqual(buf.toString('ascii', 0, 4), 'RIFF', 'WAV RIFF header');
    assertEqual(buf.toString('ascii', 8, 12), 'WAVE', 'WAV WAVE magic');
    assert(result.duration_seconds > 0, 'duration 为正数');
    assert(result.rtf >= 0, 'RTF 非负');

    // 4. 验证输出文件
    assert(fs.existsSync(result.output_path), '输出文件存在');
    const fileStat = fs.statSync(result.output_path);
    assert(fileStat.size > 44, '输出文件有内容');
  });

  it('synthesize 未初始化时抛出 MODEL_NOT_READY', async () => {
    const freshAdapter = new adapter.constructor(contract);
    try {
      await freshAdapter.synthesize({ text: 'test', voice: {}, output_format: 'wav', params: {} });
      assert(false, '应该抛出异常');
    } catch (e) {
      assertEqual(e.code, 'MODEL_NOT_READY');
    }
  });

  it('synthesize 请求发送到 mock API 的完整数据', async () => {
    let receivedRequest = null;
    const api2 = createMockPythonApi({
      onSynthesize: (req) => { receivedRequest = req; },
    });
    const port2 = await api2.start();

    const { default: AdapterBase } = await import('../../src/tts/engine/adapterBase.js');
    const adp = new (class extends AdapterBase {
      async initialize() {
        this._port = port2;
        this._baseUrl = `http://127.0.0.1:${port2}`;
        this._process = { pid: 88888, exitCode: null };
        await this._waitReady();
        this._ready = true;
      }
      async synthesize(request) {
        const resp = await fetch(`${this._baseUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: request.text, response_format: request.output_format || 'wav' }),
        });
        const audio = Buffer.from(await resp.arrayBuffer());
        return { audio, duration_seconds: 1, rtf: 0.5 };
      }
    })(contract);

    await adp.initialize({});

    await adp.synthesize({
      text: 'Mock API 测试文本',
      voice: { id: 'AAAAAA', mode: 'clone' },
      output_format: 'mp3',
      params: { speed: 1.5 },
    });

    assert(receivedRequest, 'mock API 收到了请求');
    assertEqual(receivedRequest.input, 'Mock API 测试文本');
    assertEqual(receivedRequest.format, 'mp3');

    await adp.dispose();
    await api2.stop();
  });
});
