/**
 * synthesis/segmenter 单元测试。
 * 测试短文本不分割、长文本算法分割。
 */
import { describe, it } from 'node:test';
import { assertEqual, assert } from './test-setup.js';
import { segmentText } from '../../src/tts/synthesis/segmenter.js';

describe('synthesis/segmenter', () => {
  it('短文本不分割', async () => {
    const text = '你好世界，这是一段短文本。';
    const segs = await segmentText(text, 50, 0);
    assertEqual(segs.length, 1);
    assertEqual(segs[0], text);
  });

  it('长文本在句子边界分割', async () => {
    // 每句 ~30 字符，maxLen=40，3 句应分为 2+1 段
    const sentences = [
      '第一段文本内容，包含一些描述性的文字。',
      '第二段文本内容，也是比较长的描述。',
      '第三段文本内容，用于测试分割逻辑。',
    ];
    const text = sentences.join('');
    const segs = await segmentText(text, 40, 0);
    assert(segs.length >= 2, `应该至少2段，实际 ${segs.length} 段`);
    // 每段不超过 maxLen
    for (const seg of segs) {
      assert(seg.length <= 40, `每段不应超过 40 字符，实际 ${seg.length}: "${seg.slice(0, 20)}..."`);
    }
  });

  it('超长文本多段分割', async () => {
    // 构造 300 字符文本，maxLen=50 → 至少 6 段
    let text = '';
    for (let i = 0; i < 10; i++) {
      text += `这是第${i + 1}个句子，包含一些测试用的文本内容。`;
    }
    const segs = await segmentText(text, 50, 0);
    assert(segs.length >= 5, `超长文本应分多段，实际 ${segs.length}`);
    // 所有段拼接后应等于原文（去除首尾空白）
    assertEqual(segs.join(''), text, '分段拼接后应等于原文');
  });

  it('空文本返回单段', async () => {
    const segs = await segmentText('', 50, 0);
    assertEqual(segs.length, 1);
    assertEqual(segs[0], '');
  });
});
