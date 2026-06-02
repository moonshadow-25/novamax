import path from 'path';
import crypto from 'crypto';
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
    output_file: fromDbPath(row.output_file),
    params: JSON.parse(row.params || '{}')
  };
}

export function listHistory(db, { page = 1, pageSize = 20, workspaceId } = {}) {
  let where = '1=1';
  const params = [];
  if (workspaceId) {
    where += ' AND workspace_id = ?';
    params.push(workspaceId);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM tts_synthesis_history WHERE ${where}`).get(...params)?.c || 0;
  const items = db.prepare(`SELECT * FROM tts_synthesis_history WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map(deserialize);
  return { items, total, page, page_size: pageSize };
}

export function createHistory(db, { workspaceId, voiceId, text, outputFile, outputFormat, duration, rtf, engineType, params, sourceFile, sourceType }) {
  const id = genId('hist');
  db.prepare(`INSERT INTO tts_synthesis_history
    (id, workspace_id, voice_id, text, text_hash, output_file, output_format, duration_seconds, rtf, engine_type, params, source_file, source_type, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?)`)
    .run(id, workspaceId || null, voiceId, text,
      crypto.createHash('md5').update(text).digest('hex').slice(0, 16),
      toDbPath(outputFile), outputFormat, duration, rtf, engineType, JSON.stringify(params),
      sourceFile || null, sourceType || 'manual', new Date().toISOString());
  return id;
}

export function deleteHistory(db, id) {
  db.prepare('DELETE FROM tts_synthesis_history WHERE id = ?').run(id);
}
