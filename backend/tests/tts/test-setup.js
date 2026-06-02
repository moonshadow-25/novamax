/**
 * TTS 测试基础设施。
 *
 * 提供：
 *   1. 临时 SQLite DB（内存模式）
 *   2. Schema 迁移
 *   3. 标准测试 fixture（workspace, voice, 参考音频）
 *   4. 清理函数
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _dbCounter = 0;

/** 创建临时内存数据库并运行迁移 */
export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tts_voices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, voice_mode TEXT NOT NULL DEFAULT 'clone',
      reference_audio_path TEXT, instruction TEXT, emotion_preset TEXT DEFAULT '{}',
      engine_meta TEXT DEFAULT '{}', tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tts_workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, engine_type TEXT NOT NULL,
      voice_mode TEXT NOT NULL DEFAULT 'clone', voice_instruction TEXT, voice_id TEXT,
      reference_audio_id TEXT, active_voice_id TEXT, params TEXT NOT NULL DEFAULT '{}',
      folder_path TEXT NOT NULL, output_dir TEXT NOT NULL,
      model_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tts_synthesis_history (
      id TEXT PRIMARY KEY, workspace_id TEXT, voice_id TEXT, text TEXT,
      text_hash TEXT, output_file TEXT, output_format TEXT DEFAULT 'wav',
      duration_seconds REAL, rtf REAL, engine_type TEXT, params TEXT DEFAULT '{}',
      status TEXT DEFAULT 'completed', error_message TEXT, source_file TEXT,
      source_type TEXT DEFAULT 'manual', created_at TEXT NOT NULL
    );
  `);

  return db;
}

/** 创建临时输出目录 */
export function createTempDir() {
  const dir = path.join(os.tmpdir(), `novamax-test-tts-${_dbCounter++}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 生成最小有效 WAV 文件 (1 秒 24kHz 16-bit mono) */
export function generateTestWav(sampleRate = 24000, durationSec = 1) {
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2; // 16-bit mono
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);        // chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample

  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  // Zero samples (silence)
  const samples = Buffer.alloc(dataSize);
  return Buffer.concat([header, samples]);
}

/** 标准 fixture: 插入 clone 模式 voice */
export function fixtureVoice(db, overrides = {}) {
  const id = overrides.id || 'AAAAAA';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO tts_voices (id,name,voice_mode,reference_audio_path,instruction,emotion_preset,engine_meta,tags,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, overrides.name || '测试音色', overrides.voice_mode || 'clone',
      overrides.reference_audio_path || null, overrides.instruction || null,
      '{}', '{}', '[]', now, now);
  return { id, name: overrides.name || '测试音色' };
}

/** 标准 fixture: 插入 workspace */
export function fixtureWorkspace(db, overrides = {}) {
  const id = overrides.id || 'ws-test-001';
  const now = new Date().toISOString();
  const engineType = overrides.engine_type || 'indextts2';
  const modelId = overrides.model_id || 'TEST01';
  const folderPath = overrides.folder_path || '/tmp/test-workspace';
  const outputDir = overrides.output_dir || path.join(folderPath, 'outputs');
  const voiceId = overrides.voice_id || 'AAAAAA';

  db.prepare(`INSERT INTO tts_workspaces (id,name,engine_type,voice_mode,voice_id,active_voice_id,params,folder_path,output_dir,model_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, overrides.name || '测试工作区', engineType, overrides.voice_mode || 'clone',
      voiceId, voiceId, JSON.stringify(overrides.params || {}),
      folderPath, outputDir, modelId, now);
  return { id, engine_type: engineType, model_id: modelId, voice_id: voiceId };
}

/** 清理临时目录 */
export function cleanupTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/** 简单断言包装（兼容 node:test 和直接调用） */
export function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${message || ''}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

export function assertContains(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(`FAIL: ${message || ''}\n  "${substr}" not found in "${str}"`);
  }
}
