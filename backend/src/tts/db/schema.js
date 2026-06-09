import fs from 'fs';

/**
 * TTS 数据库迁移定义。
 *
 * 每个迁移有唯一 version（递增整数）和 up() 函数。
 * 启动时 migrate() 只执行未应用过的迁移，已执行的跳过。
 * 新增迁移只需在 MIGRATIONS 数组末尾追加即可。
 */
const MIGRATIONS = [
  {
    version: 1,
    description: '创建 tts_workspaces + tts_synthesis_history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tts_workspaces (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, engine_type TEXT NOT NULL,
          voice_mode TEXT NOT NULL DEFAULT 'clone', voice_instruction TEXT, voice_id TEXT,
          reference_audio_id TEXT, active_voice_id TEXT, params TEXT NOT NULL DEFAULT '{}',
          folder_path TEXT NOT NULL, output_dir TEXT NOT NULL, cloned_from TEXT,
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
    },
  },
  {
    version: 2,
    description: 'tts_workspaces 增加 voice_id / active_voice_id / model_id 列',
    up(db) {
      for (const sql of [
        'ALTER TABLE tts_workspaces ADD COLUMN voice_id TEXT',
        'ALTER TABLE tts_workspaces ADD COLUMN active_voice_id TEXT',
        'ALTER TABLE tts_workspaces ADD COLUMN model_id TEXT',
      ]) {
        try { db.exec(sql); } catch { /* 列已存在 */ }
      }
    },
  },
  {
    version: 3,
    description: 'tts_synthesis_history 增加 source_file / source_type 列',
    up(db) {
      for (const sql of [
        'ALTER TABLE tts_synthesis_history ADD COLUMN source_file TEXT',
        'ALTER TABLE tts_synthesis_history ADD COLUMN source_type TEXT DEFAULT \'manual\'',
      ]) {
        try { db.exec(sql); } catch { /* 列已存在 */ }
      }
    },
  },
  {
    version: 4,
    description: '清理废弃表 tts_voices / tts_reference_audios（v5.0 重构后 voice 数据走文件系统，表结构也无保留价值）',
    up(db) {
      try { db.exec('DROP TABLE IF EXISTS tts_voices'); } catch {}
      try { db.exec('DROP TABLE IF EXISTS tts_reference_audios'); } catch {}
    },
  },
  {
    version: 5,
    description: '创建 tts_engine_runtime_config (运行时配置持久化，如 max_text_length)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tts_engine_runtime_config (
          engine_type TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (engine_type, key)
        );
      `);
    },
  },
];

export function migrate(db, dirs) {
  // 迁移追踪表
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
    console.log(`[tts-db] 迁移 v${m.version}: ${m.description}`);
    ran++;
  }
  if (ran === 0) {
    console.log(`[tts-db] 数据库已是最新 (已应用 ${applied.size} 个迁移)`);
  }

  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
}
