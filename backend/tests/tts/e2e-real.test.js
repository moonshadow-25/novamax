/**
 * TTS 全引擎真实端到端测试 — 每个引擎独立 describe（顶层声明）
 * 运行: cd backend && external/node/node.exe --test tests/tts/e2e-real.test.js
 */
import { describe, it, before, after } from 'node:test';

const BASE = 'http://127.0.0.1:3001';
const API  = BASE + '/api';
const V1   = BASE + '/v1';

async function G(p) {
  var r = await fetch(API + p);
  if (!r.ok) throw new Error('GET ' + p + ' -> ' + r.status);
  return r.json();
}
async function P(p, b) {
  var r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  var d = await r.json().catch(function() { return {}; });
  if (!r.ok) throw new Error('POST ' + p + ' -> ' + r.status + ': ' + JSON.stringify(d));
  return d;
}
async function S(p, b) {
  var r = await fetch(V1 + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  return { res: r, buf: Buffer.from(await r.arrayBuffer()) };
}
async function U(p, fd) {
  var r = await fetch(API + p, { method: 'POST', body: fd });
  var d = await r.json().catch(function() { return {}; });
  if (!r.ok) throw new Error('POST ' + p + ' -> ' + r.status);
  return d;
}
async function poll(fn, iv, to) {
  var s = Date.now();
  while (Date.now() - s < to) {
    try { var r = await fn(); if (r) return r; } catch (e) {}
    await new Promise(function(r) { setTimeout(r, iv); });
  }
  throw new Error('poll timeout ' + to + 'ms');
}
function checkWav(buf) {
  if (buf.length < 44) return { ok: false, reason: 'small:' + buf.length + 'B' };
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return { ok: false, reason: 'no RIFF' };
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, reason: 'no WAVE' };
  var ds = buf.readUInt32LE(40), br = buf.readUInt32LE(28);
  if (br <= 0) return { ok: false, reason: 'byteRate=0' };
  return { ok: true, sampleRate: buf.readUInt32LE(24), channels: buf.readUInt16LE(22),
    bitDepth: buf.readUInt16LE(34), duration: ds / br, totalSize: buf.length };
}
function ok(c, m) { if (!c) throw new Error('FAIL: ' + m); }
function genWav(sr, dur) {
  var ns = sr * dur, ds = ns * 2, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + ds, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(ds, 40);
  return Buffer.concat([h, Buffer.alloc(ds)]);
}

async function ensureWorkspace(et, caps) {
  var vm = caps.voice_modes, sr = caps.sample_rate || 24000;
  var wss = await G('/tts-studio/workspaces');
  var ws = wss.find(function(w) { return w.engine_type === et && (w.voice_id || w.active_voice_id); });
  if (ws) {
    console.log('  [' + et + '] reuse: ' + ws.name + ' model=' + ws.model_id);
    return { wsId: ws.id, mId: ws.model_id, vId: ws.active_voice_id || ws.voice_id, created: false };
  }
  var vId = '';
  if (vm.indexOf('clone') >= 0) {
    var fd1 = new FormData();
    fd1.append('file', new Blob([genWav(sr, 3)]), 'e2e.wav');
    var ref = await U('/tts-studio/reference-audios', fd1);
    vId = ref.voice_id;
  }
  var fd2 = new FormData();
  fd2.append('name', 'E2E-' + et + '-' + Date.now());
  fd2.append('engine_type', et);
  fd2.append('voice_mode', vm[0]);
  if (vId) fd2.append('voice_id', vId);
  fd2.append('params', JSON.stringify({}));
  var w = await U('/tts-studio/workspaces', fd2);
  console.log('  [' + et + '] created: model_id=' + w.model_id);
  return { wsId: w.id, mId: w.model_id, vId: vId, created: true };
}

// ===== 每个引擎一个 describe（顶层声明，node:test 自动发现） =====

function engDescribe(et, en, vm, fm, sr) {
  describe(en + ' (' + et + ')', function() {
    var wsId, mId, vId, created;
    var hasClone = vm.indexOf('clone') >= 0;

    before(async function() {
      console.log('\n=== ' + en + ' ===');
      var d = await ensureWorkspace(et, { voice_modes: vm, sample_rate: sr });
      wsId = d.wsId;
      mId = d.mId;
      vId = d.vId;
      created = d.created;
    });

    after(async function() {
      if (created && wsId) {
        try { await fetch(API + '/tts-studio/workspaces/' + wsId, { method: 'DELETE' }); } catch (e) {}
      }
    });

    it('1. start -> running', { timeout: 600000 }, async function() {
      console.log('[' + et + '] starting...');
      try { await P('/tts-studio/engines/' + encodeURIComponent(et) + '/stop'); } catch (e) {}
      await P('/tts-studio/engines/' + encodeURIComponent(et) + '/start');

      var r = await poll(async function() {
        try {
          var h = await G('/tts/health');
          var eng = h.engines[et];
          return eng && eng.status === 'running';
        } catch (e) { return false; }
      }, 3000, 600000);

      ok(r, et + ' running');
      console.log('[' + et + '] engine running');
    });

    it('2. synthesize -> valid WAV', { timeout: 300000 }, async function() {
      if (hasClone && !vId) {
        console.log('[' + et + '] SKIP: no voice for clone mode');
        return;
      }
      var body = {
        model: mId,
        input: 'hello world end to end test message.',
        voice: vId,
        response_format: 'wav',
      };
      var result = await S('/audio/speech', body);
      ok(result.res.ok, 'HTTP ' + result.res.status);
      var w = checkWav(result.buf);
      ok(w.ok, w.reason);
      ok(w.duration > 0, 'duration=' + w.duration);
      console.log('[' + et + '] synth: ' + w.sampleRate + 'Hz ' + w.duration.toFixed(2) + 's ' + w.totalSize + 'B');
    });

    if (fm.length >= 2) {
      it('3. format: ' + fm[1], { timeout: 300000 }, async function() {
        var body = {
          model: mId,
          input: 'Format conversion test message.',
          voice: vId,
          response_format: fm[1],
        };
        var result = await S('/audio/speech', body);
        ok(result.res.ok, 'HTTP ' + result.res.status);
        ok(result.buf.length > 0, fm[1] + ' size=' + result.buf.length + 'B');
        console.log('[' + et + '] ' + fm[1] + ': ' + result.buf.length + 'B');
      });
    }

    it('4. empty input -> 400', async function() {
      var r = await fetch(V1 + '/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: mId, input: '', voice: vId }),
      });
      ok(r.status === 400, 'status=' + r.status);
    });

    it('5. history record exists', async function() {
      var h = await G('/tts/history?workspace_id=' + wsId + '&page_size=5');
      if (h.items.length > 0) {
        ok(h.items[0].status === 'completed', 'status=' + h.items[0].status);
        console.log('[' + et + '] history: ' + h.total + ' records');
      }
    });
  });
}

// ===== 声明所有引擎测试 =====

engDescribe('indextts2',   'IndexTTS-2',  ['clone', 'preset'],      ['wav', 'mp3', 'flac'],       22050);
engDescribe('indextts1.5', 'IndexTTS-1.5', ['clone', 'preset'],      ['wav', 'mp3', 'flac', 'opus'], 24000);
engDescribe('omnivoice',   'OmniVoice',   ['design', 'auto'],       ['wav', 'mp3', 'flac', 'pcm'],  24000);

// ===== 全局端点 =====

describe('Global', function() {
  it('GET /v1/audio/models', async function() {
    var r = await fetch(V1 + '/audio/models');
    ok(r.ok, 'HTTP ' + r.status);
    var b = await r.json();
    ok(b.data.length > 0, b.data.length + ' models');
    console.log('[E2E] ' + b.data.length + ' models');
  });

  it('GET /v1/audio/voices', async function() {
    var r = await fetch(V1 + '/audio/voices');
    ok(r.ok, 'HTTP ' + r.status);
    var b = await r.json();
    ok(b.data.length > 0, b.data.length + ' voices');
    console.log('[E2E] ' + b.data.length + ' voices');
  });

  it('GET /v1/health', async function() {
    var r = await fetch(V1 + '/health');
    ok(r.ok, 'HTTP ' + r.status);
    var b = await r.json();
    ok(b.status === 'ok', 'status=' + b.status);
    console.log('[E2E] /v1/health: ' + JSON.stringify(b));
  });
});
