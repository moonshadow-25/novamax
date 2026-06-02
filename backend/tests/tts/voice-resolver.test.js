/**
 * voice/resolver 单元测试。
 * 测试 Voice ID → VoiceReference 解析逻辑。
 */
import { describe, it } from 'node:test';
import { createTestDb, fixtureVoice, assertEqual, assert } from './test-setup.js';
import { resolveVoice } from '../../src/tts/voice/resolver.js';

describe('voice/resolver', () => {
  it('解析 clone 模式 voice 返回完整 VoiceReference', () => {
    const db = createTestDb();
    fixtureVoice(db, { id: 'AAAAAA', name: '测试', voice_mode: 'clone', reference_audio_path: '/path/to/audio.wav' });

    const ref = resolveVoice(db, 'AAAAAA');

    assertEqual(ref.id, 'AAAAAA', 'voiceRef 包含 id');
    assertEqual(ref.mode, 'clone', 'mode 正确');
    assertEqual(ref.reference_audio, '/path/to/audio.wav', 'reference_audio 路径正确');
    assert(!ref.instruction, '无 instruction');
  });

  it('解析 design 模式 voice 返回 instruction', () => {
    const db = createTestDb();
    fixtureVoice(db, { id: 'BBBBBB', name: '设计音色', voice_mode: 'design', instruction: '青年男声' });

    const ref = resolveVoice(db, 'BBBBBB');

    assertEqual(ref.mode, 'design');
    assertEqual(ref.instruction, '青年男声');
    assert(!ref.reference_audio, 'design 模式无 reference_audio');
  });

  it('不存在的 voice 抛出 INVALID_VOICE', () => {
    const db = createTestDb();
    try {
      resolveVoice(db, 'ZZZZZZ');
      assert(false, '应该抛出异常');
    } catch (e) {
      assertEqual(e.code, 'INVALID_VOICE');
      assert(e.message.includes('ZZZZZZ'), '错误信息包含 voice ID');
    }
  });
});
