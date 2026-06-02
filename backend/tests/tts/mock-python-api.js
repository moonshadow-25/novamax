/**
 * Mock Python FastAPI 服务器。
 *
 * 模拟 TTS 引擎的 HTTP API，用于 adapter 测试。
 * 支持端点：/v1/health, /v1/audio/speech, /v1/memory, /v1/cache/clear, /v1/config
 */
import http from 'http';

export function createMockPythonApi(overrides = {}) {
  const port = overrides.port || 0;
  const sampleRate = overrides.sampleRate || 24000;
  const synthesizeDelay = overrides.synthesizeDelay || 50;

  // 生成模拟音频（1 秒静音）
  const generateAudio = () => {
    const numSamples = sampleRate;
    const dataSize = numSamples * 2;
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0);
    hdr.writeUInt32LE(36 + dataSize, 4);
    hdr.write('WAVE', 8);
    hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16);
    hdr.writeUInt16LE(1, 20);
    hdr.writeUInt16LE(1, 22);
    hdr.writeUInt32LE(sampleRate, 24);
    hdr.writeUInt32LE(sampleRate * 2, 28);
    hdr.writeUInt16LE(2, 32);
    hdr.writeUInt16LE(16, 34);
    hdr.write('data', 36);
    hdr.writeUInt32LE(dataSize, 40);
    return Buffer.concat([hdr, Buffer.alloc(dataSize)]);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const method = req.method;

    // 收集请求体
    let body = '';
    req.on('data', d => { body += d.toString(); });

    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }

      res.setHeader('Content-Type', 'application/json');

      // Health check
      if (method === 'GET' && (path === '/v1/health' || path === '/health')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          status: overrides.healthStatus || 'healthy',
          model_loaded: true,
          gpu_memory_free_mb: overrides.gpuMemoryFreeMb ?? 12000,
          gpu_memory_total_mb: overrides.gpuMemoryTotalMb ?? 16000,
          active_requests: 0,
          uptime: 60.0
        }));
        return;
      }

      // Synthesize
      if (method === 'POST' && path === '/v1/audio/speech') {
        const input = parsed.input || '';
        const format = parsed.response_format || 'wav';

        if (!input.trim()) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'input is required' }));
          return;
        }

        if (overrides.synthesizeError) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'mock engine error' }));
          return;
        }

        // 模拟推理延迟
        setTimeout(() => {
          const audio = generateAudio();
          const mime = format === 'mp3' ? 'audio/mpeg'
            : format === 'flac' ? 'audio/flac'
            : 'audio/wav';

          res.setHeader('Content-Type', mime);
          res.writeHead(200);
          res.end(audio);

          // 记录请求（用于测试验证）
          if (overrides.onSynthesize) {
            overrides.onSynthesize({ input, format, params: parsed });
          }
        }, synthesizeDelay);
        return;
      }

      // Clear cache
      if (method === 'POST' && path === '/v1/cache/clear') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'cleared' }));
        return;
      }

      // Memory info
      if (method === 'GET' && path === '/v1/memory') {
        res.writeHead(200);
        res.end(JSON.stringify({
          vram_used_mb: 2000,
          vram_total_mb: 16000,
          shared_used_mb: 0,
          shared_total_mb: 0
        }));
        return;
      }

      // Runtime config
      if (method === 'PUT' && path === '/v1/config') {
        if (overrides.onSetConfig) {
          overrides.onSetConfig(parsed);
        }
        res.writeHead(200);
        res.end(JSON.stringify({ key: parsed.key, value: parsed.value }));
        return;
      }

      // 404 fallback
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  return {
    server,

    /** 启动服务器并返回端口 */
    async start() {
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          resolve(server.address().port);
        });
      });
    },

    /** 停止服务器 */
    async stop() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },

    getPort() { return server.address()?.port; }
  };
}
