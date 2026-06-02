import fs from 'fs';
import { TTS_VOICES_DIR, TTS_WORKSPACES_DIR, TTS_REF_AUDIO_DIR, TTS_HISTORY_DIR } from '../../config/constants.js';

export function migrate(db) {
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
      folder_path TEXT NOT NULL, output_dir TEXT NOT NULL, cloned_from TEXT,
      model_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tts_reference_audios (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, file_path TEXT NOT NULL,
      file_size INTEGER, duration REAL, sample_rate INTEGER,
      format TEXT DEFAULT 'wav', transcript TEXT, transcript_lang TEXT,
      transcript_at TEXT, tags TEXT DEFAULT '[]', uploaded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tts_synthesis_history (
      id TEXT PRIMARY KEY, workspace_id TEXT, voice_id TEXT, text TEXT,
      text_hash TEXT, output_file TEXT, output_format TEXT DEFAULT 'wav',
      duration_seconds REAL, rtf REAL, engine_type TEXT, params TEXT DEFAULT '{}',
      status TEXT DEFAULT 'completed', error_message TEXT, source_file TEXT,
      source_type TEXT DEFAULT 'manual', created_at TEXT NOT NULL
    );
  `);

  for (const sql of [
    'ALTER TABLE tts_workspaces ADD COLUMN voice_id TEXT',
    'ALTER TABLE tts_workspaces ADD COLUMN active_voice_id TEXT',
    'ALTER TABLE tts_workspaces ADD COLUMN model_id TEXT',
    'ALTER TABLE tts_synthesis_history ADD COLUMN source_file TEXT',
    'ALTER TABLE tts_synthesis_history ADD COLUMN source_type TEXT DEFAULT \'manual\'',
  ]) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  fs.mkdirSync(TTS_VOICES_DIR, { recursive: true });
  fs.mkdirSync(TTS_WORKSPACES_DIR, { recursive: true });
  fs.mkdirSync(TTS_REF_AUDIO_DIR, { recursive: true });
  fs.mkdirSync(TTS_HISTORY_DIR, { recursive: true });
}
