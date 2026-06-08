import fs from 'fs';

const MIGRATIONS = [
  {
    version: 1,
    description: '创建 asr_transcription_history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS asr_transcription_history (
          id TEXT PRIMARY KEY, model_id TEXT NOT NULL,
          original_filename TEXT, audio_path TEXT, result_text TEXT,
          output_format TEXT DEFAULT 'json', language TEXT, task_type TEXT DEFAULT 'transcribe',
          duration_seconds REAL, word_count INTEGER DEFAULT 0,
          output_files TEXT DEFAULT '[]', source_type TEXT DEFAULT 'manual', source_file TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_asr_hist_model ON asr_transcription_history(model_id);
        CREATE INDEX IF NOT EXISTS idx_asr_hist_created ON asr_transcription_history(created_at);
      `);
    },
  },
];

export function migrate(db, dataDir) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');

  const applied = new Set(
    db.prepare('SELECT version FROM _migrations').all().map(r => r.version)
  );

  const now = new Date().toISOString();
  let ran = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    m.up(db);
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(m.version, now);
    console.log(`[asr-db] 迁移 v${m.version}: ${m.description}`);
    ran++;
  }
  if (ran === 0) {
    console.log(`[asr-db] 数据库已是最新 (已应用 ${applied.size} 个迁移)`);
  }

  fs.mkdirSync(dataDir, { recursive: true });
}
