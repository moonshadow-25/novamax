import fs from 'fs';
import path from 'path';

export function scanVoices(refAudioDir) {
  if (!fs.existsSync(refAudioDir)) return [];
  return fs.readdirSync(refAudioDir)
    .filter(f => /\.(wav|mp3|flac)$/i.test(f))
    .map(f => {
      const base = path.parse(f).name;
      const idx = base.indexOf('_');
      const voiceId = idx > 0 ? base.slice(0, idx) : base;
      const name = idx > 0 ? base.slice(idx + 1) : base;
      const stat = fs.statSync(path.join(refAudioDir, f));
      return {
        id: voiceId,
        name,
        voice_mode: 'clone',
        reference_audio_path: path.join(refAudioDir, f),
        file_size: stat.size,
        format: path.extname(f).slice(1).toLowerCase(),
        uploaded_at: stat.mtime.toISOString(),
        emotion_preset: {},
        engine_meta: {},
        tags: [],
        instruction: null
      };
    })
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

export function getVoice(id, refAudioDir) {
  return scanVoices(refAudioDir).find(v => v.id === id) || null;
}

export function listVoices({ page = 1, pageSize = 100, search } = {}, refAudioDir) {
  let voices = scanVoices(refAudioDir);
  if (search) voices = voices.filter(v => v.name.toLowerCase().includes(search.toLowerCase()));
  const total = voices.length;
  const items = voices.slice((page - 1) * pageSize, page * pageSize);
  return { items, total, page, page_size: pageSize };
}

export function deleteVoice(id, refAudioDir) {
  const v = scanVoices(refAudioDir).find(v => v.id === id);
  if (v && fs.existsSync(v.reference_audio_path)) {
    fs.unlinkSync(v.reference_audio_path);
  }
}
