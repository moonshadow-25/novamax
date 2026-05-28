/**
 * TTS Text Segmenter
 *
 * 将超长文本分割为多段，每段不超过 maxLen。
 * 分割目标位由算法计算，精确分割点由 LLM 在搜索窗口内选定。
 * LLM 不可用时回退到算法分割（句子边界）。
 */
import processManager from './processManager.js';
import axios from 'axios';

const LLM_TIMEOUT = 15000;

/* ========================================================================
 * 公共 API
 * ======================================================================== */

/**
 * @param {string} text - 原始文本
 * @param {number} maxLen - 单段最大字符数（来自 contract.capabilities.max_text_length）
 * @returns {Promise<string[]>} 分割后的文本段数组
 */
export async function segmentText(text, maxLen) {
  if (!text || text.length <= maxLen) return [text];

  const targets = calculateTargets(text.length, maxLen);
  if (targets.length === 0) return [text];

  const llmPort = findRunningLlmPort();

  const segments = [];
  let startPos = 0;

  for (const target of targets) {
    const pos = llmPort
      ? await findSplitWithLlm(text, target, maxLen, llmPort)
      : findSplitAlgorithmic(text, target, maxLen);

    const cutPos = Math.max(startPos + 1, Math.min(text.length - 1, pos));
    segments.push(text.slice(startPos, cutPos).trim());
    startPos = cutPos;
  }
  segments.push(text.slice(startPos).trim());

  return segments.filter(s => s.length > 0);
}

/* ========================================================================
 * 目标点位计算（纯算法）
 * ======================================================================== */

/**
 * 计算分割目标位。
 * 规则：每 maxLen 个字符一个目标；剩余不足 maxLen*2 时平分。
 */
export function calculateTargets(totalLen, maxLen) {
  const targets = [];
  let remaining = totalLen;
  let offset = 0;

  while (remaining > maxLen) {
    if (remaining <= maxLen * 2) {
      targets.push(offset + Math.floor(remaining / 2));
      break;
    }
    offset += maxLen;
    targets.push(offset);
    remaining -= maxLen;
  }

  return targets;
}

/* ========================================================================
 * LLM 分割
 * ======================================================================== */

function findRunningLlmPort() {
  const running = processManager.getAllRunning();
  const llm = running.find(p => p.type === 'llm');
  return llm?.port || null;
}

async function findSplitWithLlm(text, target, maxLen, llmPort) {
  const halfWindow = Math.floor(maxLen * 0.1);
  const windowStart = Math.max(0, target - halfWindow);
  const windowEnd = Math.min(text.length, target + halfWindow);

  const excerptStart = Math.max(0, windowStart - 200);
  const excerptEnd = Math.min(text.length, windowEnd + 200);
  const textExcerpt = text.slice(excerptStart, excerptEnd);

  const adjStart = windowStart - excerptStart;
  const adjEnd   = windowEnd - excerptStart;

  const body = {
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserMessage(textExcerpt, adjStart, adjEnd) }
    ],
    tools: [buildToolDefinition()],
    tool_choice: { type: 'function', function: { name: 'find_split_position' } },
    temperature: 0.1,
    max_tokens: 200
  };

  try {
    const resp = await axios.post(`http://127.0.0.1:${llmPort}/v1/chat/completions`, body, {
      timeout: LLM_TIMEOUT,
      validateStatus: () => true
    });

    const toolCall = resp.data?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall && toolCall.function?.name === 'find_split_position') {
      const args = JSON.parse(toolCall.function.arguments);
      if (typeof args.position === 'number') {
        return excerptStart + args.position;
      }
    }
  } catch {
    // LLM 调用失败，回退
  }

  return findSplitAlgorithmic(text, target, maxLen);
}

/* ========================================================================
 * 算法回退分割
 * ======================================================================== */

function findSplitAlgorithmic(text, target, maxLen) {
  const halfWindow = Math.floor(maxLen * 0.1);
  const start = Math.max(0, target - halfWindow);
  const end = Math.min(text.length, target + halfWindow);
  const window = text.slice(start, end);

  // 优先级 1: 句子结束符
  const sentenceEnd = /[。！？.!?][\s\n]*/g;
  let best = -1;
  let match;
  while ((match = sentenceEnd.exec(window)) !== null) {
    const pos = start + match.index + match[0].length;
    if (pos > start && pos < end) best = pos;
  }
  if (best > 0) return best;

  // 优先级 2: 段落分隔
  const paraBreak = /\n\s*\n/;
  const paraMatch = paraBreak.exec(window);
  if (paraMatch) return start + paraMatch.index + 1;

  // 优先级 3: 次级断句符
  const secondary = /[，、；,:;]\s*/g;
  while ((match = secondary.exec(window)) !== null) {
    const pos = start + match.index + match[0].length;
    if (pos > start && pos < end) best = pos;
  }
  if (best > 0) return best;

  // 优先级 4: 接近中心点的空格
  const center = target - start;
  const spaces = /\s+/g;
  let closest = target;
  let minDist = Infinity;
  while ((match = spaces.exec(window)) !== null) {
    const pos = start + match.index + Math.floor(match[0].length / 2);
    const dist = Math.abs(pos - target);
    if (dist < minDist && pos > start && pos < end) {
      minDist = dist;
      closest = pos;
    }
  }
  if (minDist < halfWindow) return closest;

  // 优先级 5: 返回 target 本身
  return target;
}

/* ========================================================================
 * LLM 提示词与工具定义
 * ======================================================================== */

function buildSystemPrompt() {
  return `你是一个文本分割工具。你的唯一职责是在给定的搜索窗口 [search_start, search_end] 内，找到最合适的自然分割点。

选择分割点的优先级（从高到低）：
1. 句子结束符之后：。！？.!? 及紧随的换行或空白之后
2. 段落分隔符之后：连续两个及以上换行
3. 次级断句符之后：，、；,:;
4. 词间空格之后：避免截断英文单词
5. 如果以上均不存在，选择窗口内最接近中心的位置

约束：
- 返回位置必须在 [search_start, search_end] 范围内
- 不得截断引号内文本
- 不得在连续数字中间分割
- 不得在连续英文字母中间分割
- 优先选择语义完整的位置

你必须使用 find_split_position 工具返回结果。`;
}

function buildUserMessage(textExcerpt, searchStart, searchEnd) {
  return [
    `请在以下文本片段中找到最佳分割点。`,
    ``,
    `搜索窗口: [${searchStart}, ${searchEnd}]`,
    ``,
    `文本片段:`,
    `"""`,
    textExcerpt,
    `"""`,
    ``,
    `注意: 位置编号从 0 开始，以文本片段的第一个字符为 0。`,
    `请在搜索窗口 [${searchStart}, ${searchEnd}] 内找到最合适的断句点。`
  ].join('\n');
}

function buildToolDefinition() {
  return {
    type: 'function',
    function: {
      name: 'find_split_position',
      description: '在给定文本片段的搜索窗口内找到最佳分割位置。',
      parameters: {
        type: 'object',
        properties: {
          position: {
            type: 'integer',
            description: '选定的分割位置（相对于文本片段的字符偏移量），必须在 [search_start, search_end] 范围内。该位置之后的第一个字符将成为下一段的开头。'
          }
        },
        required: ['position']
      }
    }
  };
}
