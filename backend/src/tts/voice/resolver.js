export function resolveVoice(db, voiceId) {
  const row = db.prepare('SELECT * FROM tts_voices WHERE id = ?').get(voiceId);
  if (!row) throw { code: 'INVALID_VOICE', message: `Voice ${voiceId} 不存在` };

  return {
    id: voiceId,
    mode: row.voice_mode,
    reference_audio: row.reference_audio_path || undefined,
    instruction: row.instruction || undefined,
    emotion_preset: JSON.parse(row.emotion_preset || '{}'),
    engine_meta: JSON.parse(row.engine_meta || '{}')
  };
}
