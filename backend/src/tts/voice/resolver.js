import fs from 'fs';
import path from 'path';

export function resolveVoice(_db, voiceId, refAudioDir) {
  if (!fs.existsSync(refAudioDir)) {
    throw { code: 'INVALID_VOICE', message: `Voice ${voiceId} 不存在` };
  }
  const prefix = `${voiceId}_`;
  const match = fs.readdirSync(refAudioDir).find(f => f.startsWith(prefix) && /\.(wav|mp3|flac)$/i.test(f));
  if (!match) {
    throw { code: 'INVALID_VOICE', message: `Voice ${voiceId} 不存在` };
  }
  return {
    id: voiceId,
    mode: 'clone',
    reference_audio: path.join(refAudioDir, match),
  };
}
