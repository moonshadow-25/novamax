import path from 'path';
import { PROJECT_ROOT } from '../../config/constants.js';
import { genId } from '../../utils/idGen.js';

function toDbPath(absPath) {
  if (!absPath) return absPath;
  const root = PROJECT_ROOT.replace(/\\/g, '/') + '/';
  const p = absPath.replace(/\\/g, '/');
  return p.startsWith(root) ? p.slice(root.length) : absPath;
}

function fromDbPath(dbPath) {
  if (!dbPath) return dbPath;
  if (path.isAbsolute(dbPath)) return dbPath;
  return path.join(PROJECT_ROOT, dbPath);
}

function deserialize(row) {
  if (!row) return null;
  return {
    ...row,
    reference_audio_path: fromDbPath(row.reference_audio_path),
    emotion_preset: JSON.parse(row.emotion_preset || '{}'),
    engine_meta: JSON.parse(row.engine_meta || '{}'),
    tags: JSON.parse(row.tags || '[]')
  };
}

export function getVoice(db, id) {
  return deserialize(db.prepare('SELECT * FROM tts_voices WHERE id = ?').get(id));
}

export function listVoices(db, { page = 1, pageSize = 100, search } = {}) {
  let where = '1=1';
  const params = [];
  if (search) {
    where += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM tts_voices WHERE ${where}`).get(...params)?.c || 0;
  const items = db.prepare(`SELECT * FROM tts_voices WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(deserialize);
  return { items, total, page, page_size: pageSize };
}

export function createVoice(db, { id, name, voice_mode, reference_audio_path, instruction, emotion_preset, engine_meta, tags }) {
  const voiceId = id || `voice_${genId('v')}`;
  const now = new Date().toISOString();
  const dbPath = toDbPath(reference_audio_path);

  const existing = db.prepare('SELECT id FROM tts_voices WHERE id = ?').get(voiceId);
  if (existing) {
    db.prepare(`UPDATE tts_voices SET name=?, voice_mode=?, reference_audio_path=?, instruction=?, emotion_preset=?, engine_meta=?, tags=?, updated_at=? WHERE id=?`)
      .run(name, voice_mode, dbPath || null, instruction || null,
        JSON.stringify(emotion_preset || {}), JSON.stringify(engine_meta || {}), JSON.stringify(tags || []), now, voiceId);
    return getVoice(db, voiceId);
  }

  db.prepare(`INSERT INTO tts_voices (id,name,voice_mode,reference_audio_path,instruction,emotion_preset,engine_meta,tags,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(voiceId, name, voice_mode, dbPath || null, instruction || null,
      JSON.stringify(emotion_preset || {}), JSON.stringify(engine_meta || {}), JSON.stringify(tags || []), now, now);
  return getVoice(db, voiceId);
}

export function deleteVoice(db, id) {
  db.prepare('DELETE FROM tts_voices WHERE id = ?').run(id);
  db.prepare('UPDATE tts_workspaces SET active_voice_id = NULL WHERE active_voice_id = ?').run(id);
}
