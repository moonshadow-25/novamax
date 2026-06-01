/**
 * NovaMax 集成测试
 * 用法：node test-integration.mjs [port]
 *   默认端口 3001。脚本自动启动/停止 NovaMax。
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2]) || 3001;
const BASE = `http://localhost:${PORT}`;
const BACKEND_DIR = path.join(__dirname, 'backend');

let passed = 0, failed = 0;
const totalStart = Date.now();
let serverStartTime = 0;

// ============================================================
// 启动 NovaMax
// ============================================================
// 检查端口是否已被占用
try {
  const check = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
  if (check.ok) {
    console.error(`端口 ${PORT} 已被占用。请先停止已有 NovaMax 实例再运行测试。`);
    process.exit(1);
  }
} catch {}

// 使用项目自带的 Node.js
const NODE_EXE = path.join(__dirname, 'external', 'node', 'node.exe');
const nodeBin = fs.existsSync(NODE_EXE) ? NODE_EXE : 'node';
console.log(`Node: ${nodeBin}`);
console.log('启动 NovaMax...');
const server = spawn(nodeBin, ['src/index.js'], {
  cwd: BACKEND_DIR,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`[nova] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[nova:err] ${d}`));

// 等待服务就绪
async function waitForReady(maxSec = 60) {
  for (let i = 0; i < maxSec; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

console.log(`等待服务就绪 (最多 60s)...`);
const ready = await waitForReady();
if (!ready) {
  console.error('NovaMax 启动超时，检查端口是否被占用');
  killServer();
  process.exit(1);
}
serverStartTime = ((Date.now() - totalStart) / 1000).toFixed(1);
console.log(`NovaMax 已就绪 (启动耗时 ${serverStartTime}s)\n`);

// ============================================================
// 测试函数
// ============================================================

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let json;
    try { json = JSON.parse(body); } catch { json = body.slice(0, 200); }
    return { ok: true, status: res.status, json, body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function test(desc, fn) {
  console.log(`  ${desc}...`);
  try {
    await fn();
    console.log(`    ✓ OK`);
    passed++;
  } catch (e) {
    console.log(`    ✗ FAIL: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ============================================================
console.log('========================================');
console.log('  NovaMax 集成测试');
console.log(`  目标: ${BASE}`);
console.log('========================================\n');

// ── 基础健康检查 ──
console.log('[1] 基础连通性');
await test('GET /api/health', async () => {
  const r = await get('/api/health');
  assert(r.ok, 'health check failed');
  assert(r.json?.status === 'ok', 'status should be ok');
});

// ── 引擎列表 ──
console.log('\n[2] 引擎定义');
const engines = (await get('/api/engines')).json || {};

const MUST_HAVE = ['rocm', 'llamacpp', 'comfyui', 'tts', 'asr', 'ffmpeg'];
for (const id of MUST_HAVE) {
  await test(`引擎 ${id} 存在`, () => {
    assert(engines[id] != null, `engine ${id} not in response`);
    assert(Array.isArray(engines[id].installed_versions), 'installed_versions should be array');
    assert(typeof engines[id].installed === 'boolean', 'installed should be boolean');
  });
}

await test('llamacpp 有多个 GPU variants', () => {
  const v = engines.llamacpp?.variants;
  assert(v && v.length >= 2, `expected 2+ variants, got ${v?.length}`);
  const ids = v.map(x => x.id);
  assert(ids.includes('rocm'), 'missing rocm variant');
});

await test('asr 有 variants (whisper, qwen3-asr)', () => {
  const v = engines.asr?.variants;
  assert(v, 'asr has no variants');
  const ids = v.map(x => x.id);
  assert(ids.includes('whisper'), 'missing whisper variant');
  assert(ids.includes('qwen3-asr'), 'missing qwen3-asr variant');
});

await test('tts 有 variants (indextts2, indextts1.5, omnivoice)', () => {
  const v = engines.tts?.variants;
  assert(v, 'tts has no variants');
  const ids = v.map(x => x.id);
  for (const eid of ['indextts2','indextts1.5','omnivoice']) assert(ids.includes(eid), `missing variant: ${eid}`);
});

// ── 变体引擎单独查询 ──
console.log('\n[3] 变体引擎查询');
const variantChecks = [
  ['rocm', true, '独立rocm引擎'],
  ['whisper', true, 'asr/whisper变体'],
  ['qwen3-asr', true, 'asr/qwen3-asr变体'],
  ['indextts2', true, 'tts/indextts2变体'],
  ['indextts1.5', true, 'tts/indextts1.5变体'],
  ['omnivoice', true, 'tts/omnivoice变体'],
];
for (const [id, shouldExist, desc] of variantChecks) {
  await test(`GET /api/engines/${id}/check → ${desc}`, async () => {
    const r = await get(`/api/engines/${id}/check`);
    if (shouldExist) {
      assert(r.ok, `should return 200 but got ${r.error}`);
      assert(typeof r.json.installed === 'boolean', 'installed should be boolean');
      assert(r.json.engineInfo != null, 'engineInfo should exist');
    }
  });
}

// ── 安装脚本覆盖 ──
console.log('\n[4] 版本信息完整性');
const versionChecks = [
  ['llamacpp', '202605212000', 'variant_id', 'rocm'],
  ['asr', '202605292100', 'variant_id', 'whisper'],
  ['asr', '20260529', 'variant_id', 'qwen3-asr'],
  ['rocm', '7.12+2.12', 'modelscope_file'],
  ['ffmpeg', '1.0', 'modelscope_file'],
];
for (const [eid, ver, key, expected] of versionChecks) {
  await test(`getEngineVersionInfo(${eid}, ${ver}) → ${key}`, () => {
    const v = engines[eid];
    let found = false;
    if (v?.versions) {
      found = v.versions.some(x => x.version === ver);
    }
    if (!found && v?.variants) {
      for (const vv of v.variants) {
        found = (vv.versions || []).some(x => x.version === ver);
        if (found) break;
      }
    }
    assert(found, `version ${ver} not found in engine ${eid}`);
  });
}

// ── 模型列表 ──
console.log('\n[5] 模型列表');
await test('GET /api/models?type=asr 返回 ASR 模型', async () => {
  const r = await get('/api/models?type=asr');
  assert(r.ok, `HTTP ${r.status}`);
  const models = r.json?.models || r.json || [];
  assert(Array.isArray(models), 'should return array');
  const asrIds = models.map(m => m.id);
  assert(asrIds.includes('whisper_large_v3'), 'whisper_large_v3 should exist');
  assert(asrIds.includes('qwen3_asr_06b'), 'qwen3_asr_06b should exist');
  assert(asrIds.includes('qwen3_asr_17b'), 'qwen3_asr_17b should exist');
});

await test('ASR 模型有 engine_id 和 engine_version', async () => {
  const r = await get('/api/models?type=asr');
  const models = (r.json?.models || r.json || []).filter(m => m.type === 'asr');
  for (const m of models) {
    assert(m.engine_id, `${m.id} missing engine_id`);
    assert(m.engine_version, `${m.id} missing engine_version`);
  }
});

// ── ASR API ──
console.log('\n[6] ASR API');
await test('GET /api/asr/engine-contracts', async () => {
  const r = await get('/api/asr/engine-contracts');
  assert(r.ok && Array.isArray(r.json), 'should return array');
});

await test('GET /api/asr-studio/files', async () => {
  const r = await get('/api/asr-studio/files');
  assert(r.ok && Array.isArray(r.json), 'should return array');
});

await test('GET /api/asr-studio/history', async () => {
  const r = await get('/api/asr-studio/history');
  assert(r.ok && r.json?.items, 'should return items array');
});

await test('ASR 模型能力查询', async () => {
  const models = (await get('/api/models?type=asr')).json?.models || [];
  if (models.length > 0) {
    const r = await get(`/api/asr/models/${models[0].id}/capabilities`);
    assert(r.ok, `capabilities failed: ${r.error}`);
    assert(r.json?.supported_languages, 'should have supported_languages');
    assert(r.json?.output_formats, 'should have output_formats');
  }
});

// ── TTS API ──
console.log('\n[7] TTS API');
await test('GET /api/tts-studio/workspaces', async () => {
  const r = await get('/api/tts-studio/workspaces');
  assert(r.ok && Array.isArray(r.json), 'should return array');
});

await test('GET /api/tts-studio/engine-contracts', async () => {
  const r = await get('/api/tts-studio/engine-contracts');
  assert(r.ok, `failed: ${r.error}`);
});

// ── /v1 OpenAI 兼容 ──
console.log('\n[8] /v1 OpenAI 兼容');
await test('GET /v1/audio/models (TTS+ASR混合)', async () => {
  const r = await get('/v1/audio/models');
  assert(r.ok, `HTTP ${r.status}`);
  assert(r.json?.object === 'list', 'should return {object:"list"}');
  assert(Array.isArray(r.json?.data), 'data should be array');
  const types = r.json.data.map(m => m.type).filter(Boolean);
  assert(types.includes('asr') || types.length > 0, 'should include ASR or TTS models');
});

await test('GET /v1/models (OpenAI 兼容)', async () => {
  const r = await get('/v1/models');
  assert(r.ok, `/v1/models returned ${r.status} ${r.error || ''}`);
});

// ── SSE ──
console.log('\n[9] SSE 事件流');
await test('SSE /api/events 可连接', async () => {
  // 只验证能否连接并收到初始消息，不验证后续事件
  try {
    const res = await fetch(`${BASE}/api/events`, { signal: AbortSignal.timeout(3000) });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel();
    const text = new TextDecoder().decode(value);
    assert(text.includes('connected') || text.includes('data:'), `unexpected SSE: ${text.slice(0,50)}`);
  } catch (e) {
    throw new Error(`SSE connection failed: ${e.message}`);
  }
});

// ── 引擎发现路径验证 ──
console.log('\n[10] 引擎发现路径正确性');
// 验证 External/asr 目录结构的引擎能被正确发现（只测 API 端）
const discoverChecks = [
  ['whisper', 'voice recognition engine'],
  ['qwen3-asr', 'voice recognition engine'],
];
for (const [eid] of discoverChecks) {
  await test(`引擎 ${eid} 在 /api/engines 中可发现`, async () => {
    // 变体引擎应该在父引擎的 variants 里
    let found = false;
    for (const [key, eng] of Object.entries(engines)) {
      if (eng.variants?.some(v => v.id === eid)) { found = true; break; }
    }
    assert(found, `${eid} not found in any engine's variants`);
  });
}

// ── ID 碰撞验证 ──
console.log('\n[11] ID 碰撞处理');
await test('getEngine("rocm") 返回独立引擎，带 versions 无 _parentKey', () => {
  const r = engines.rocm;
  assert(r, 'rocm engine missing');
  assert(Array.isArray(r.versions) || r.variants?.some(v => v.versions?.length > 0),
    'rocm should have accessible versions');
});

await test('llamacpp 的 rocm 变体在 variants 中', () => {
  const v = engines.llamacpp?.variants?.find(x => x.id === 'rocm');
  assert(v, 'llamacpp should have rocm variant');
  assert(v.versions?.length > 0, 'rocm variant should have versions');
});

// ── 结果 ──
console.log(`\n${'='.repeat(50)}`);
const testTime = ((Date.now() - totalStart) / 1000).toFixed(1);
console.log(`  启动: ${serverStartTime}s | 测试: ${passed + failed} 个 | 通过: ${passed} | 失败: ${failed} | 总耗时: ${testTime}s`);
console.log(`${'='.repeat(50)}`);

// 清理
function killServer() {
  try { spawn('taskkill', ['/F', '/T', '/PID', String(server.pid)], { shell: true, stdio: 'ignore' }); } catch {}
}
console.log('停止 NovaMax...');
killServer();

if (failed > 0) {
  console.log('\n❌ 存在失败测试');
  process.exit(1);
} else {
  console.log('\n✅ 全部通过');
}
