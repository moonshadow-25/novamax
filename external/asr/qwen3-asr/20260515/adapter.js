/**
 * Qwen3-ASR Adapter — 管理 FastAPI 子进程，通过 HTTP 通信。
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';

// ISO 语言码 → Qwen3 规范名
const LANG_MAP = { zh: 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian', pt: 'Portuguese', it: 'Italian', ar: 'Arabic', th: 'Thai', vi: 'Vietnamese', tr: 'Turkish', hi: 'Hindi', nl: 'Dutch', sv: 'Swedish', da: 'Danish', fi: 'Finnish', pl: 'Polish', cs: 'Czech', fil: 'Filipino', fa: 'Persian', el: 'Greek', ro: 'Romanian', hu: 'Hungarian', mk: 'Macedonian', id: 'Indonesian', ms: 'Malay' };

export default class Qwen3AsrAdapter {
  constructor(contract) { this.meta = contract; this._process = null; this._port = null; this._baseUrl = null; this._initialized = false; }

  async initialize(config) {
    if (this._initialized) return;
    const engineDir = path.dirname(fileURLToPath(import.meta.url));

    const pythonExe = fs.existsSync(path.join(engineDir, 'python.exe')) ? path.join(engineDir, 'python.exe') : path.join(engineDir, 'Scripts', 'python.exe');
    if (!fs.existsSync(pythonExe)) throw { code: 'PYTHON_NOT_FOUND', message: `Python: ${pythonExe}` };
    if (!fs.existsSync(config.modelFilePath)) throw { code: 'MODEL_NOT_FOUND', message: `Model: ${config.modelFilePath}` };

    this._port = await this._findFreePort();
    this._baseUrl = `http://127.0.0.1:${this._port}`;

    // 启动内嵌的 FastAPI 服务
    const serverPy = path.join(engineDir, 'serve.py');
    if (!fs.existsSync(serverPy)) {
      // 内嵌 serve.py —— 写临时文件
      fs.writeFileSync(serverPy, this._servePy());
    }

    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HOME: path.join(engineDir, '..', '..', '..', 'data', 'hf_cache') };
    // transformers 引擎需要模型目录（含 config.json 等），不是单个文件
    const modelDir = path.dirname(config.modelFilePath);
    const pyEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HOME: path.join(engineDir, '..', '..', '..', 'data', 'hf_cache') };
    this._process = spawn(pythonExe, [serverPy, '--model', modelDir, '--port', String(this._port)], {
      cwd: engineDir, shell: false, env: pyEnv, stdio: ['ignore', 'pipe', 'pipe']
    });

    let exitCode = null, spawnErr = null;
    this._process.on('error', (err) => { spawnErr = err; });
    this._process.on('exit', (code) => { exitCode = code; });
    // 必须消费 stdout/stderr，否则管道缓冲区满后子进程会阻塞
    const logOut = config.log || (() => {});
    this._process.stdout.on('data', (d) => { logOut(`[qwen3-asr] ${d.toString().trim()}`); });
    this._process.stderr.on('data', (d) => { logOut(`[qwen3-asr:err] ${d.toString().trim()}`); });

    await this._waitForReady();
    if (exitCode != null) throw { code: 'ENGINE_CRASH', message: `Python 进程异常退出 (code=${exitCode})${spawnErr ? ': ' + spawnErr.message : ''}` };
    this._initialized = true;
  }

  async transcribe(audioPath, params = {}) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    if (params.language) fd.append('language', LANG_MAP[params.language] || params.language);
    if (params.response_format) fd.append('response_format', params.response_format);
    if (params.temperature != null) fd.append('temperature', String(params.temperature));
    if (params.prompt) fd.append('prompt', params.prompt);

    const res = await fetch(`${this._baseUrl}/v1/audio/transcriptions`, { method: 'POST', body: fd, signal: AbortSignal.timeout(7200000) });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw { code: 'ENGINE_ERROR', message: `${res.status}: ${t.slice(0, 200)}` }; }
    return res.json();
  }

  async health() { try { const r = await fetch(`${this._baseUrl}/health`, { signal: AbortSignal.timeout(3000) }); return { status: r.ok ? 'healthy' : 'unhealthy' }; } catch { return { status: 'unhealthy' }; } }

  async dispose() {
    if (this._process) { try { spawn('taskkill', ['/F', '/T', '/PID', String(this._process.pid)], { shell: true, stdio: 'ignore' }); } catch {} this._process = null; }
    this._initialized = false;
  }

  getPid() { return this._process?.pid || null; }
  getPort() { return this._port; }

  _findFreePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); }); }

  async _waitForReady(max = 90) {
    for (let i = 0; i < max; i++) {
      if (this._process?.exitCode != null) throw { code: 'ENGINE_CRASH', message: `Python 进程异常退出 (code=${this._process.exitCode})` };
      try { const r = await fetch(`${this._baseUrl}/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    throw { code: 'ENGINE_START_TIMEOUT', message: 'Python 进程启动超时 (90s)' };
  }

  _servePy() {
    return `import sys, os, io, json, tempfile, argparse
from pathlib import Path
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, str(Path(__file__).parent / 'Qwen3-ASR'))

import torch
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
import uvicorn
import librosa
import soundfile as sf

app = FastAPI()

# 延迟加载模型
_model = None
_model_path = None

def get_model(model_path):
    global _model, _model_path
    if _model is None or _model_path != model_path:
        from qwen_asr.inference.qwen3_asr import Qwen3ASRModel
        _model = Qwen3ASRModel.from_pretrained(model_path, device_map="auto", torch_dtype=torch.bfloat16)
        _model_path = model_path
    return _model

@app.get("/health")
async def health(): return {"status": "healthy"}

@app.get("/v1/models")
async def models(): return {"object": "list", "data": []}

@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model: str = Form(None), language: str = Form(None),
    response_format: str = Form("json"), temperature: float = Form(0.0), prompt: str = Form(None)):
    try:
        # 保存上传文件
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(await file.read())
            tmp_path = f.name

        # 重采样到 16kHz
        audio, sr = librosa.load(tmp_path, sr=16000, mono=True)
        sf.write(tmp_path, audio, 16000)

        m = get_model(args.model)
        result = m.transcribe(audio=tmp_path, language=language or None, context=prompt or None)[0]

        os.unlink(tmp_path)

        text = result.text
        if response_format == "text": return PlainTextResponse(text)
        elif response_format == "srt": return PlainTextResponse(_format_srt(result))
        elif response_format == "vtt": return PlainTextResponse(_format_vtt(result))
        else: return JSONResponse({"text": text})
    except Exception as e: raise HTTPException(500, str(e))

def _format_srt(result):
    if not result.time_stamps: return f"1\\n00:00:00,000 --> 00:00:01,000\\n{result.text}\\n"
    lines = []
    for i, ts in enumerate(result.time_stamps): lines.append(f"{i+1}\\n{_srt_time(ts[0])} --> {_srt_time(ts[1])}\\n{result.text}")  # simplified
    return "\\n".join(lines)

def _format_vtt(result):
    if not result.time_stamps: return f"WEBVTT\\n\\n00:00:00.000 --> 00:00:01.000\\n{result.text}\\n"
    lines = ["WEBVTT", ""]
    for i, ts in enumerate(result.time_stamps): lines.append(f"{_vtt_time(ts[0])} --> {_vtt_time(ts[1])}\\n{result.text}")
    return "\\n".join(lines)

def _srt_time(s): h,m=divmod(int(s),3600); mi,s=divmod(m,60); ms=int((s-int(s))*1000); return f"{int(h):02d}:{int(mi):02d}:{int(s):02d},{ms:03d}"
def _vtt_time(s): h,m=divmod(int(s),3600); mi,s=divmod(m,60); ms=int((s-int(s))*1000); return f"{int(h):02d}:{int(mi):02d}:{int(s):02d}.{ms:03d}"

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="info")
`;
  }
}
