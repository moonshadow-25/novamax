/**
 * 云API代理服务器（Node.js版本）
 * 提供OpenAI兼容的API接口，将请求转发到配置的云API服务
 * 支持流式输出
 *
 * 用法: node cloudApiProxy.js --api-key KEY --base-url URL --model-name NAME --platform-name PLATFORM --port PORT
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

// 从命令行参数解析配置
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const CONFIG = {
  api_key: getArg('--api-key') || '',
  base_url: getArg('--base-url') || '',
  model_name: getArg('--model-name') || '',
  platform_name: getArg('--platform-name') || '',
  port: parseInt(getArg('--port') || '1234', 10),
};

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] ${msg}`);
  process.stdout.flush?.();
}

/**
 * 转发请求到云API，支持流式和非流式
 */
function forwardRequest(reqPath, body, streamCallback, doneCallback) {
  const targetUrl = new URL(CONFIG.base_url.replace(/\/$/, '') + reqPath);
  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const postData = JSON.stringify(body);
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.api_key}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 300000,
  };

  const req = lib.request(options, (res) => {
    doneCallback(null, res);
  });

  req.on('error', (err) => doneCallback(err));
  req.on('timeout', () => {
    req.destroy();
    doneCallback(new Error('请求超时'));
  });

  req.write(postData);
  req.end();
}

function getRequest(reqPath, doneCallback) {
  const targetUrl = new URL(CONFIG.base_url.replace(/\/$/, '') + reqPath);
  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.api_key}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify({
        model: CONFIG.model_name,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false,
      })),
    },
    timeout: 10000,
  };

  const req = lib.request(options, (res) => doneCallback(null, res));
  req.on('error', (err) => doneCallback(err));
  req.on('timeout', () => { req.destroy(); doneCallback(new Error('连接超时，请检查网络或Base URL是否正确')); });

  req.write(JSON.stringify({
    model: CONFIG.model_name,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 5,
    stream: false,
  }));
  req.end();
}

function readBody(req, cb) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString())); }
    catch (e) { cb(e); }
  });
  req.on('error', cb);
}

function json(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

const server = http.createServer((req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // GET /v1/models
  if (req.method === 'GET' && url === '/v1/models') {
    return json(res, 200, {
      object: 'list',
      data: [{
        id: CONFIG.model_name,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: CONFIG.platform_name,
      }],
    });
  }

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    return json(res, 200, {
      status: 'ok',
      platform: CONFIG.platform_name,
      model: CONFIG.model_name,
    });
  }

  // GET /test_connection
  if (req.method === 'GET' && url === '/test_connection') {
    log(`测试连接: ${CONFIG.base_url}/chat/completions`);
    getRequest('/chat/completions', (err, upstream) => {
      if (err) {
        const msg = err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')
          ? `无法连接到API服务器，请检查Base URL是否正确: ${err.message}`
          : err.message;
        log(`连接测试失败: ${msg}`);
        return json(res, 503, { success: false, message: msg });
      }
      if (upstream.statusCode === 200) {
        log('连接测试成功');
        return json(res, 200, { success: true, message: '连接测试成功', platform: CONFIG.platform_name, model: CONFIG.model_name });
      }
      const chunks = [];
      upstream.on('data', c => chunks.push(c));
      upstream.on('end', () => {
        let detail = '';
        try { detail = JSON.stringify(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { detail = Buffer.concat(chunks).toString().slice(0, 200); }
        const msg = `API返回错误状态码 ${upstream.statusCode}: ${detail}`;
        log(`连接测试失败: ${msg}`);
        json(res, 400, { success: false, message: msg, status_code: upstream.statusCode });
      });
    });
    return;
  }

  // POST /v1/chat/completions
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    readBody(req, (err, body) => {
      if (err) return json(res, 400, { error: '请求数据解析失败' });

      const stream = body.stream || false;
      body.model = CONFIG.model_name;

      log(`转发请求到: ${CONFIG.base_url}/chat/completions  模型: ${CONFIG.model_name}, 流式: ${stream}`);

      forwardRequest('/chat/completions', body, null, (err, upstream) => {
        if (err) return json(res, 500, { error: err.message });

        if (upstream.statusCode !== 200) {
          const chunks = [];
          upstream.on('data', c => chunks.push(c));
          upstream.on('end', () => {
            json(res, upstream.statusCode, { error: `云API返回错误: ${upstream.statusCode} - ${Buffer.concat(chunks).toString().slice(0, 500)}` });
          });
          return;
        }

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });
          // 直接管道转发流式数据
          upstream.on('data', chunk => {
            res.write(chunk);
          });
          upstream.on('end', () => res.end());
          upstream.on('error', (e) => {
            res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
            res.end();
          });
        } else {
          const chunks = [];
          upstream.on('data', c => chunks.push(c));
          upstream.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(body);
          });
          upstream.on('error', (e) => json(res, 500, { error: e.message }));
        }
      });
    });
    return;
  }

  // POST /v1/embeddings
  if (req.method === 'POST' && url === '/v1/embeddings') {
    readBody(req, (err, body) => {
      if (err) return json(res, 400, { error: '请求数据解析失败' });
      body.model = CONFIG.model_name;

      forwardRequest('/embeddings', body, null, (err, upstream) => {
        if (err) return json(res, 500, { error: err.message });

        const chunks = [];
        upstream.on('data', c => chunks.push(c));
        upstream.on('end', () => {
          res.writeHead(upstream.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(Buffer.concat(chunks));
        });
      });
    });
    return;
  }

  json(res, 404, { error: 'Not Found' });
});

server.listen(CONFIG.port, '0.0.0.0', () => {
  log(`[云API代理] 启动服务器`);
  log(`[云API代理] 平台: ${CONFIG.platform_name}`);
  log(`[云API代理] 模型: ${CONFIG.model_name}`);
  log(`[云API代理] Base URL: ${CONFIG.base_url}`);
  log(`[云API代理] 监听端口: ${CONFIG.port}`);
  log(`[云API代理] 服务地址: http://127.0.0.1:${CONFIG.port}`);
  // 输出就绪信号给processManager检测
  log(`server is listening on port ${CONFIG.port}`);
});

server.on('error', (err) => {
  log(`[云API代理] 服务器错误: ${err.message}`);
  process.exit(1);
});
