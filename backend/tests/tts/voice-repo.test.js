/**
 * db/voiceRepo 单元测试。
 * 测试 Voice CRUD 操作。
 */
import { describe, it } from 'node:test';
import { createTestDb, fixtureVoice, assertEqual, assert } from './test-setup.js';
import * as voiceRepo from '../../src/tts/db/voiceRepo.js';

describe('db/voiceRepo', () => {
  it('createVoice 创建新 voice', () => {
    const db = createTestDb();
    const voice = voiceRepo.createVoice(db, {
      id: 'CCCCCC', name: '新音色', voice_mode: 'clone',
      reference_audio_path: '/ref.wav'
    });

    assertEqual(voice.id, 'CCCCCC');
    assertEqual(voice.name, '新音色');
    assertEqual(voice.voice_mode, 'clone');
  });

  it('createVoice 同 ID 重复调用触发 UPDATE', () => {
    const db = createTestDb();
    voiceRepo.createVoice(db, { id: 'DDDDDD', name: '旧名', voice_mode: 'clone', reference_audio_path: '/old.wav' });
    voiceRepo.createVoice(db, { id: 'DDDDDD', name: '新名', voice_mode: 'clone', reference_audio_path: '/new.wav' });

    const voice = voiceRepo.getVoice(db, 'DDDDDD');
    assertEqual(voice.name, '新名', 'name 已更新');
    assertEqual(voice.reference_audio_path, '/new.wav', 'reference_audio_path 已更新');
  });

  it('listVoices 返回分页结果', () => {
    const db = createTestDb();
    for (let i = 0; i < 5; i++) {
      voiceRepo.createVoice(db, { id: `V${i}`, name: `Voice ${i}`, voice_mode: 'clone' });
    }

    const result = voiceRepo.listVoices(db, { page: 1, pageSize: 3 });
    assertEqual(result.items.length, 3);
    assertEqual(result.total, 5);
    assertEqual(result.page, 1);
  });

  it('listVoices 支持搜索', () => {
    const db = createTestDb();
    voiceRepo.createVoice(db, { id: 'EEEEEE', name: '测试音色', voice_mode: 'clone' });
    voiceRepo.createVoice(db, { id: 'FFFFFF', name: '其他', voice_mode: 'design' });

    const result = voiceRepo.listVoices(db, { search: '测试' });
    assertEqual(result.items.length, 1);
    assertEqual(result.items[0].id, 'EEEEEE');
  });

  it('deleteVoice 删除 voice 并清除 workspace 引用', () => {
    const db = createTestDb();
    voiceRepo.createVoice(db, { id: 'GGGGGG', name: '待删除', voice_mode: 'clone' });

    voiceRepo.deleteVoice(db, 'GGGGGG');
    const voice = voiceRepo.getVoice(db, 'GGGGGG');
    assert(!voice, 'voice 已删除');
  });
});
