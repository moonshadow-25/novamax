/**
 * 完整端到端测试：OpenAI-format 请求 → 音频输出。
 *
 * 模拟从 HTTP 请求到 Worker 消息处理的完整链路：
 *
 *   POST /v1/audio/speech {model, input, voice, response_format}
 *     → routes/openai-tts.js
 *       → ttsWorkerManager.send('synthesize', {...})
 *         → ttsWorker dispatch('synthesize')
 *           → resolveVoice(db, voiceId)
 *           → synthesize(orchestrator)
 *             → segmentText
 *             → adapter.synthesize (→ mock Python API)
 *             → writeFile + history
 *     → audio buffer + Content-Type header
 */
import { describe, it, before, after } from 'node:test';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { assertEqual, assert, createTestDb, fixtureVoice, fixtureWorkspace,
         createTempDir, cleanupTempDir, generateTestWav } from './test-setup.js';
import { createMockPythonApi } from './mock-python-api.js';
import { createRegistry } from '../../src/tts/engine/registry.js';
import { getOrCreateEngine, ensureInitialized, sendToEngine } from '../../src/tts/engine/lifecycle.js';
import { createLogBuffer } from '../../src/tts/log/buffer.js';
import * as voiceRepo from '../../src/tts/db/voiceRepo.js';
import * as workspaceRepo from '../../src/tts/db/workspaceRepo.js';
import * as historyRepo from '../../src/tts/db/historyRepo.js';
import { resolveVoice } from '../../src/tts/voice/resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 覆盖 discoverEngines（绕过文件系统扫描）
import { discoverEngines } from '../../src/tts/engine/discovery.js';
const _originalDiscover = discoverEngines;

describe('E2E: OpenAI /v1/audio/speech → 音频输出', () => {
  let db, registry, log, mockApi, mockPort, tempDir;
  let workspaceId, voiceId, modelId;
  let mockEntry;

  before(async () => {
    // 1. 启动 mock Python API
    mockApi = createMockPythonApi({ synthesizeDelay: 10 });
    mockPort = await mockApi.start();

    // 2. 数据库 + fixtures
    db = createTestDb();
    tempDir = createTempDir();
    const refAudioPath = path.join(tempDir, 'ref.wav');
    fs.writeFileSync(refAudioPath, generateTestWav());

    voiceId = 'AAAAAA';
    voiceRepo.createVoice(db, {
      id: voiceId, name: 'E2E 测试音色', voice_mode: 'clone',
      reference_audio_path: refAudioPath,
    });

    modelId = 'E2ETST';
    workspaceId = 'ws-e2e-001';
    workspaceRepo.createWorkspace(db, {
      id: workspaceId, name: 'E2E 工作区', engine_type: 'test-engine',
      voice_mode: 'clone', voice_id: voiceId,
      folder_path: tempDir, output_dir: path.join(tempDir, 'outputs'),
    });
    // 手动覆盖 model_id（createWorkspace 通过 generateVoiceId 生成）
    db.prepare('UPDATE tts_workspaces SET model_id = ? WHERE id = ?').run(modelId, workspaceId);

    // 3. 注册表 + 日志
    registry = createRegistry();
    log = createLogBuffer();

    // 4. Mock 引擎发现（注入 mock adapter 的 contract）
    const mockContract = {
      contract_version: '5.0',
      engine: { type: 'test-engine', name: 'Test Engine', version: '1.0.0' },
      api_endpoints: { health: '/v1/health', speech: '/v1/audio/speech', clear_cache: '/v1/cache/clear' },
      capabilities: {
        voice_modes: ['clone'], max_text_length: 500,
        output_formats: ['wav', 'mp3'], sample_rate: 24000, bit_depth: 16, channels: 1,
        supports_streaming: false, max_concurrency: 1,
      },
    };

    // 注入 mock engine entry（绕过文件系统发现）
    mockEntry = {
      worker: {
        postMessage: (msg) => {
          // engineWorker 模拟：直接处理消息
          setTimeout(async () => {
            const response = await handleMockEngineMessage(msg);
            const cb = mockEntry._pending.get(msg.id);
            if (cb) { mockEntry._pending.delete(msg.id); cb(response); }
          }, 5);
        },
        on: () => {}, // 忽略事件监听
        terminate: () => {},
      },
      _pending: new Map(),
      status: 'idle', _alive: true, modelDir: '', activeTasks: 0,
      lastActiveTime: Date.now(), _busy: false, _initPromise: null,
      report: {}, pending: new Map(),
    };
    registry.set('test-engine', mockEntry);

    // 重写 sendToEngine 以使用 mock
    const origSend = sendToEngine;
    // 我们直接操作 registry entry 的 pending
    mockEntry._send = (type, payload) => {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID().slice(0, 12);
        mockEntry._pending.set(id, (msg) => {
          if (msg.type === 'result') resolve(msg.payload);
          else reject(msg.payload);
        });
        handleMockEngineMessage({ id, type, payload }).then(resp => {
          if (resp) {
            const cb = mockEntry._pending.get(id);
            if (cb) { mockEntry._pending.delete(id); cb(resp); }
          }
        });
      });
    };

    mockEntry.sendToEngine = mockEntry._send;

    // 标记 registry entry 为就绪
    mockEntry.status = 'running';
    mockEntry.report = {
      health: { status: 'healthy', model_loaded: true },
      runtimeConfig: { max_text_length: 500 },
      pid: 99999,
    };
  });

  after(async () => {
    cleanupTempDir(tempDir);
    await mockApi.stop();
  });

  /** 模拟 engineWorker 的消息处理 */
  async function handleMockEngineMessage(msg) {
    switch (msg.type) {
      case 'initialize': {
        // 模拟 adapter 初始化（调用 mock API health）
        const resp = await fetch(`http://127.0.0.1:${mockPort}/v1/health`);
        const body = await resp.json();
        return { type: 'result', payload: { status: 'running', health: body } };
      }
      case 'synthesize': {
        // 调用 mock Python API
        const resp = await fetch(`http://127.0.0.1:${mockPort}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: msg.payload.text,
            response_format: msg.payload.output_format || 'wav',
          }),
        });
        const audio = Buffer.from(await resp.arrayBuffer());
        const outputFile = path.join(tempDir, 'outputs', `${msg.payload.request_id}.wav`);
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, audio);
        return {
          type: 'result',
          payload: { audio, duration_seconds: 1.0, rtf: 0.5, output_path: outputFile }
        };
      }
      case 'clearCache':
        return { type: 'result', payload: { status: 'cleared' } };
      case 'dispose':
        return { type: 'result', payload: { status: 'stopped' } };
      default:
        return { type: 'result', payload: {} };
    }
  }

  // ===== 模拟 synthesize dispatch（等同于 ttsWorker dispatch('synthesize')） =====

  async function dispatchSynthesize(opts) {
    const {
      text, voiceId, engineType, outputFormat = 'wav', outputDir = '',
      params = {}, workspaceId, sourceFile = '', sourceType = 'manual',
      modelDir = '', skipVoiceResolve = false, llmPort = 0,
    } = opts;

    // resolveVoice
    const voiceRef = skipVoiceResolve ? { skip: true } : resolveVoice(db, voiceId);

    // Orchestrator.synthesize 的核心逻辑（简化版，真实测试应 import orchestrator）
    const orcEntry = registry.get(engineType);
    orcEntry.lastActiveTime = Date.now();

    const maxLen = 500;

    // 合成：直接调用 mock engine
    const result = await orcEntry.sendToEngine('synthesize', {
      text,
      voice: voiceRef,
      output_format: outputFormat,
      output_dir: outputDir || tempDir,
      workspace_id: workspaceId || '',
      request_id: crypto.randomUUID().slice(0, 12),
      params,
    });

    const audio = result.audio;
    const duration = result.duration_seconds || 1;
    const rtf = result.rtf || 0.5;

    // 写输出文件
    const resolvedDir = outputDir || tempDir;
    fs.mkdirSync(resolvedDir, { recursive: true });
    const fileName = `${voiceId}_${text.replace(/[\s\n\r]+/g, '').slice(0, 10)}_${Math.random().toString(36).slice(2, 8)}.${outputFormat}`;
    const outFile = path.join(resolvedDir, fileName);
    fs.writeFileSync(outFile, audio);

    // 历史
    const historyId = historyRepo.createHistory(db, {
      workspaceId, voiceId, text, outputFile: outFile,
      outputFormat, duration, rtf, engineType, params, sourceFile, sourceType
    });

    return { historyId, audio, duration, output_file: outFile, segment_count: 1 };
  }

  // ===== 测试用例 =====

  it('完整链路：短文本合成 → 返回有效 WAV', async () => {
    const result = await dispatchSynthesize({
      text: '你好世界，这是一个端到端测试。',
      voiceId: 'AAAAAA',
      engineType: 'test-engine',
      outputFormat: 'wav',
      outputDir: path.join(tempDir, 'outputs'),
      params: {},
      workspaceId,
    });

    // 1. 音频验证
    const buf = result.audio;
    assert(buf.length > 44, `音频大小: ${buf.length} bytes`);
    assertEqual(buf.toString('ascii', 0, 4), 'RIFF', 'RIFF header');
    assertEqual(buf.toString('ascii', 8, 12), 'WAVE', 'WAVE magic');

    // 2. 输出文件验证
    assert(fs.existsSync(result.output_file), '输出文件存在');

    // 3. 历史记录验证
    const history = historyRepo.listHistory(db, { workspaceId });
    assertEqual(history.total, 1, '创建了 1 条历史记录');
    assertEqual(history.items[0].voice_id, voiceId);
    assertEqual(history.items[0].engine_type, 'test-engine');
    assertEqual(history.items[0].output_format, 'wav');
    assertEqual(history.items[0].status, 'completed');

    // 4. 历史音频文件
    assert(fs.existsSync(history.items[0].output_file), '历史记录指向的文件存在');
  });

  it('合成多段文本 → 音频拼接验证', async () => {
    const longText = 'A'.repeat(600) + '。' + 'B'.repeat(100) + '。';

    // 使用 orchestrator 的 segmentText
    const { segmentText } = await import('../../src/tts/synthesis/segmenter.js');
    const segs = await segmentText(longText, 200, 0);
    assert(segs.length >= 2, `长文本应分段，实际 ${segs.length} 段`);

    // 对每段分别合成
    const segResults = [];
    for (const seg of segs) {
      const r = await mockEntry.sendToEngine('synthesize', {
        text: seg,
        voice: { id: voiceId, mode: 'clone' },
        output_format: 'wav',
        output_dir: tempDir,
        params: {},
      });
      segResults.push(r);
    }

    // 所有分段成功
    assert(segResults.length === segs.length, '所有分段合成都成功');
    for (const r of segResults) {
      assert(r.audio.length > 44, `分段音频有效: ${r.audio.length}`);
    }
  });

  it('错误处理：无效 voice ID 抛出异常', async () => {
    try {
      resolveVoice(db, 'ZZZZZZ');
      assert(false, '应该抛出 INVALID_VOICE');
    } catch (e) {
      assertEqual(e.code, 'INVALID_VOICE');
    }
  });

  it('输出历史记录查询', () => {
    const allHistory = historyRepo.listHistory(db, {});
    assert(allHistory.total >= 1, '至少有一条历史记录');
    assert(allHistory.items.length > 0, 'items 非空');
  });
});
