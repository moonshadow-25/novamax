import path from 'path';
import fs from 'fs';
let _projectRoot = '';

export function setRoot(r) { _projectRoot = r; }

// DB 存相对路径，避免跨机器绝对路径问题
function toDbPath(absPath) {
  if (!absPath) return absPath;
  const root = _projectRoot.replace(/\\/g, '/') + '/';
  const p = absPath.replace(/\\/g, '/');
  return p.startsWith(root) ? p.slice(root.length) : absPath;
}

function fromDbPath(dbPath) {
  if (!dbPath) return dbPath;
  if (path.isAbsolute(dbPath)) return dbPath; // 兼容旧数据
  return path.join(_projectRoot, dbPath);
}

function deserialize(row) {
  if (!row) return null;
  const folderPath = fromDbPath(row.folder_path);
  const outputDir = fromDbPath(row.output_dir) || path.join(folderPath, 'outputs');
  return { ...row, params: JSON.parse(row.params || '{}'), folder_path: folderPath, output_dir: outputDir };
}

export function getWorkspace(db, id) {
  return deserialize(db.prepare('SELECT * FROM tts_workspaces WHERE id = ?').get(id));
}

export function listWorkspaces(db) {
  return db.prepare('SELECT * FROM tts_workspaces ORDER BY created_at DESC').all().map(deserialize);
}

export function createWorkspace(db, { id, name, engine_type, voice_mode, voice_instruction, voice_id, reference_audio_id, params, folder_path, output_dir }) {
  // 兼容旧数据：如果已存在同 model_id 的记录，只更新路径和 id，保留已有参数
  const dup = db.prepare('SELECT params FROM tts_workspaces WHERE model_id = ? AND id != ?').get(id, id);
  if (dup) {
    const existingParams = JSON.parse(dup.params || '{}');
    const merged = { ...existingParams, ...(params || {}) };
    db.prepare('UPDATE tts_workspaces SET id=?, name=?, engine_type=?, voice_mode=?, voice_instruction=?, voice_id=?, params=?, folder_path=?, output_dir=?, model_id=? WHERE model_id=? AND id!=?')
      .run(id, name, engine_type, voice_mode || 'clone', voice_instruction || null,
        voice_id || null, JSON.stringify(merged), toDbPath(folder_path), toDbPath(output_dir), id, id, id);
    return getWorkspace(db, id);
  }

  const now = new Date().toISOString();
  db.prepare(`INSERT INTO tts_workspaces
    (id,name,engine_type,voice_mode,voice_instruction,voice_id,active_voice_id,reference_audio_id,params,folder_path,output_dir,model_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, engine_type, voice_mode || 'clone', voice_instruction || null,
      voice_id || null, voice_id || null, reference_audio_id || null,
      JSON.stringify(params || {}), toDbPath(folder_path), toDbPath(output_dir), id, now);
  return getWorkspace(db, id);
}

export function deleteWorkspace(db, id) {
  db.prepare('DELETE FROM tts_workspaces WHERE id = ?').run(id);
}

export function updateParams(db, id, params) {
  db.prepare('UPDATE tts_workspaces SET params = ? WHERE id = ?').run(JSON.stringify(params || {}), id);
  const ws = db.prepare('SELECT folder_path FROM tts_workspaces WHERE id = ?').get(id);
  if (ws?.folder_path) {
    const folderAbs = fromDbPath(ws.folder_path);
    const configPath = path.join(folderAbs, 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      cfg.params = params || {};
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    }
  }
}

export function updateOutputDir(db, id, output_dir) {
  db.prepare('UPDATE tts_workspaces SET output_dir = ? WHERE id = ?').run(toDbPath(output_dir), id);
}

export function activateVoice(db, workspaceId, voiceId) {
  db.prepare('UPDATE tts_workspaces SET active_voice_id = ? WHERE id = ?').run(voiceId, workspaceId);
}
