/**
 * TTS Synthesis Service v4.0
 *
 * 核心合成编排层。
 *
 * 职责：
 *   1. 接收合成请求（文本 / 文本文件）
 *   2. 文本智能分割（LLM + 算法，按 contract.capabilities.max_text_length）
 *   3. Voice ID → VoiceReference 解析
 *   4. 通过 ttsAdapterLoader 获取适配器
 *   5. 通过 ttsTaskQueue 控制并发
 *   6. 多段 ffmpeg 合片 + 结果存储 + 历史记录
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { PROJECT_ROOT } from '../config/constants.js';
import ttsAdapterLoader from './ttsAdapterLoader.js';
import ttsVoiceManager from './ttsVoiceManager.js';
import ttsTaskQueue from './ttsTaskQueue.js';
import configManager from './configManager.js';
import { segmentText } from './ttsTextSegmenter.js';

const HISTORY_DIR = path.join(PROJECT_ROOT, 'data', 'tts_services', 'history');
const FFMPEG_DIR = path.join(PROJECT_ROOT, 'external', 'ffmpeg');
const genId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;

const ffmpegExe = process.platform === 'win32'
  ? path.join(FFMPEG_DIR, 'ffmpeg.exe')
  : path.join(FFMPEG_DIR, 'ffmpeg');

class TtsSynthesisService {
  constructor() {
    this.db = null;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this.db = configManager.db;
    ttsVoiceManager.init();
    if (!this.db) { console.error('[TtsSynthesisService] db is null'); return; }
    this._migrate();
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    this._initialized = true;
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tts_synthesis_history (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT,
        voice_id      TEXT,
        text          TEXT,
        text_hash     TEXT,
        output_file   TEXT,
        output_format TEXT DEFAULT 'wav',
        duration_seconds REAL,
        rtf           REAL,
        engine_type   TEXT,
        params        TEXT DEFAULT '{}',
        status        TEXT DEFAULT 'completed',
        error_message TEXT,
        created_at    TEXT NOT NULL
      );
    `);
  }

  /* ========================================================================
   * 合成入口（单任务统一入口）
   *
   * 单任务 = 用户手动输入 OR 单个文件生成
   * 批量   = 逐个文件调用本方法
   * ======================================================================== */

  /**
   * @param {object} opts
   * @param {string} opts.text
   * @param {string} opts.voiceId
   * @param {string} opts.engineType
   * @param {string} [opts.engineVersion]
   * @param {string} [opts.outputFormat]
   * @param {string} [opts.outputDir]
   * @param {object} [opts.params]
   * @param {string} [opts.workspaceId]
   * @param {function} [opts.onProgress] - (done, total) => void
   */
  async synthesize({ text, voiceId, engineType, engineVersion, outputFormat = 'wav', outputDir = '', params = {}, workspaceId, onProgress }) {
    this._ensureInit();

    const adapter = await ttsAdapterLoader.getAdapter(engineType, engineVersion);
    const maxLen = adapter.meta?.capabilities?.max_text_length || 4000;
    const voiceRef = ttsVoiceManager.resolve(voiceId);
    const concurrency = adapter.meta?.capabilities?.max_concurrency || 1;
    const resolvedOutputDir = outputDir || HISTORY_DIR;

    // 智能分段（LLM + 算法）
    const segments = await segmentText(text, maxLen);

    // 构建队列项
    const items = segments.map((seg, i) => ({
      text: seg,
      voice: voiceRef,
      output_format: outputFormat,
      output_dir: resolvedOutputDir,
      workspace_id: workspaceId || '',
      request_id: genId('req'),
      params: { ...params, index: i }
    }));

    const synthesizeFn = async (item) => {
      const result = await adapter.synthesize(item);
      return result;
    };

    const batchResult = await ttsTaskQueue.enqueue(
      { engineType, maxConcurrency: concurrency, items },
      synthesizeFn,
      onProgress
    );

    // 合片或直接返回
    let audio, outFile;

    if (batchResult.results.length === 1) {
      audio = batchResult.results[0].audio;
      outFile = batchResult.results[0].output_path
        || path.join(HISTORY_DIR, `${genId('hist')}.${outputFormat}`);
      if (!batchResult.results[0].output_path) {
        fs.writeFileSync(outFile, audio);
      }
    } else {
      const concatResult = await this._ffmpegConcat(batchResult.results, outputFormat, resolvedOutputDir);
      audio = concatResult.audio;
      outFile = concatResult.output_path;
    }

    const totalDuration = batchResult.results.reduce((sum, r) => sum + (r?.duration_seconds || 0), 0);
    const avgRtf = batchResult.results.length > 0
      ? batchResult.results.reduce((s, r) => s + (r?.rtf || 0), 0) / batchResult.results.length
      : 0;

    // 历史记录
    const historyId = genId('hist');
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO tts_synthesis_history
      (id, workspace_id, voice_id, text, text_hash, output_file, output_format, duration_seconds, rtf, engine_type, params, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`)
      .run(historyId, workspaceId || null, voiceId, text,
        crypto.createHash('md5').update(text).digest('hex').slice(0, 16),
        outFile, outputFormat, totalDuration, avgRtf,
        engineType, JSON.stringify(params), now);

    return {
      historyId,
      audio,
      duration: totalDuration,
      output_file: outFile,
      segment_count: segments.length
    };
  }

  /* ========================================================================
   * 历史
   * ======================================================================== */

  getHistory(page = 1, pageSize = 20, workspaceId) {
    this._ensureInit();
    let where = '1=1';
    const params = [];
    if (workspaceId) { where += ' AND workspace_id = ?'; params.push(workspaceId); }

    const total = this.db.prepare(`SELECT COUNT(*) as c FROM tts_synthesis_history WHERE ${where}`).get(...params)?.c || 0;
    const offset = (page - 1) * pageSize;
    const items = this.db.prepare(`SELECT * FROM tts_synthesis_history WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(r => ({ ...r, params: JSON.parse(r.params || '{}') }));
    return { items, total, page, page_size: pageSize };
  }

  getHistoryItem(id) {
    this._ensureInit();
    const r = this.db.prepare('SELECT * FROM tts_synthesis_history WHERE id = ?').get(id);
    return r ? { ...r, params: JSON.parse(r.params || '{}') } : null;
  }

  getHistoryAudio(id) {
    const item = this.getHistoryItem(id);
    if (!item || !fs.existsSync(item.output_file)) return null;
    return fs.readFileSync(item.output_file);
  }

  deleteHistoryItem(id) {
    this._ensureInit();
    const item = this.getHistoryItem(id);
    if (item && fs.existsSync(item.output_file)) fs.unlinkSync(item.output_file);
    this.db.prepare('DELETE FROM tts_synthesis_history WHERE id = ?').run(id);
  }

  /* ========================================================================
   * 内部
   * ======================================================================== */

  _ensureInit() { if (!this._initialized) this.init(); }

  /**
   * ffmpeg 无损合片。
   * 将多段 WAV 文件按顺序拼接为单个文件。
   */
  async _ffmpegConcat(results, format, outputDir) {
    if (!fs.existsSync(ffmpegExe)) {
      // ffmpeg 不可用时回退到采样级拼接
      console.warn('[TtsSynthesisService] ffmpeg not found, using raw concat');
      const audio = this._rawConcat(results, format);
      const outFile = path.join(outputDir, `${genId('concat')}.${format}`);
      fs.writeFileSync(outFile, audio);
      return { audio, output_path: outFile };
    }

    // 收集已有文件路径或写入临时文件
    const inputFiles = [];
    const tempFiles = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.output_path && fs.existsSync(r.output_path)) {
        inputFiles.push(r.output_path);
      } else {
        const tmpPath = path.join(outputDir, `_seg_${i}_${genId('tmp')}.${format}`);
        fs.writeFileSync(tmpPath, r.audio);
        inputFiles.push(tmpPath);
        tempFiles.push(tmpPath);
      }
    }

    // 写入 concat list
    const listPath = path.join(outputDir, `${genId('list')}.txt`);
    const listContent = inputFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const outFile = path.join(outputDir, `${genId('concat')}.${format}`);

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegExe, [
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy', outFile, '-y'
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });

      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', code => {
        // 清理临时文件
        try { fs.unlinkSync(listPath); } catch {}
        for (const f of tempFiles) { try { fs.unlinkSync(f); } catch {} }

        if (code === 0) {
          const audio = fs.readFileSync(outFile);
          resolve({ audio, output_path: outFile });
        } else {
          console.error(`[TtsSynthesisService] ffmpeg exit ${code}: ${stderr.slice(-300)}`);
          // 回退到原始拼接
          const audio = this._rawConcat(results, format);
          fs.writeFileSync(outFile, audio);
          resolve({ audio, output_path: outFile });
        }
      });

      proc.on('error', () => {
        try { fs.unlinkSync(listPath); } catch {}
        for (const f of tempFiles) { try { fs.unlinkSync(f); } catch {} }
        const audio = this._rawConcat(results, format);
        fs.writeFileSync(outFile, audio);
        resolve({ audio, output_path: outFile });
      });
    });

    const audio = fs.readFileSync(outFile);
    return { audio, output_path: outFile };
  }

  /** 采样级 WAV 拼接（ffmpeg 不可用时的回退） */
  _rawConcat(results, format) {
    if (results.length === 0) return Buffer.alloc(0);
    if (results.length === 1) return results[0].audio;

    if (format === 'wav' && results.every(r => r.audio.length > 44)) {
      const header = results[0].audio.slice(0, 44);
      const dataChunks = results.map(r => r.audio.slice(44));
      const totalData = Buffer.concat(dataChunks);
      const out = Buffer.concat([header, totalData]);
      out.writeUInt32LE(36 + totalData.length, 4);
      out.writeUInt32LE(totalData.length, 40);
      return out;
    }

    return Buffer.concat(results.map(r => r.audio));
  }
}

const ttsSynthesisService = new TtsSynthesisService();
export default ttsSynthesisService;
