export async function segmentText(text, maxLen, llmPort) {
  if (text.length <= maxLen) return [text];
  const targets = calculateTargets(text.length, maxLen);
  if (targets.length === 0) return [text];

  const segments = [];
  let startPos = 0;
  for (const target of targets) {
    const pos = llmPort
      ? await llmSplit(text, target, maxLen, llmPort)
      : algoSplit(text, target, maxLen);
    const cutPos = Math.max(startPos + 1, Math.min(text.length - 1, pos));
    segments.push(text.slice(startPos, cutPos).trim());
    startPos = cutPos;
  }
  segments.push(text.slice(startPos).trim());
  return segments.filter(s => s.length > 0);
}

function calculateTargets(totalLen, maxLen) {
  const targets = [];
  let remaining = totalLen;
  let offset = 0;
  while (remaining > maxLen) {
    if (remaining <= maxLen * 2) { targets.push(offset + Math.floor(remaining / 2)); break; }
    offset += maxLen; targets.push(offset); remaining -= maxLen;
  }
  return targets;
}

async function llmSplit(text, target, maxLen, llmPort) {
  const halfWindow = Math.floor(maxLen * 0.1);
  const ws = Math.max(0, target - halfWindow);
  const we = Math.min(text.length, target + halfWindow);
  const excerptStart = Math.max(0, ws - 200);
  const excerptEnd = Math.min(text.length, we + 200);

  try {
    const resp = await fetch(`http://127.0.0.1:${llmPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SPLITTER_SYS },
          { role: 'user', content: splitterUserMsg(text.slice(excerptStart, excerptEnd), ws - excerptStart, we - excerptStart) }
        ],
        tools: [SPLITTER_TOOL],
        tool_choice: { type: 'function', function: { name: 'find_split_position' } },
        temperature: 0.1, max_tokens: 200
      })
    });
    const data = await resp.json();
    const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (tc?.function?.name === 'find_split_position') {
      const args = JSON.parse(tc.function.arguments);
      if (typeof args.position === 'number') return excerptStart + args.position;
    }
  } catch {}

  return algoSplit(text, target, maxLen);
}

function algoSplit(text, target, maxLen) {
  const halfWindow = Math.floor(maxLen * 0.1);
  const start = Math.max(0, target - halfWindow);
  const end = Math.min(text.length, target + halfWindow);
  const wnd = text.slice(start, end);

  let best = -1, m;
  const sentenceEnd = /[。！？.!?][\s\n]*/g;
  while ((m = sentenceEnd.exec(wnd)) !== null) {
    const pos = start + m.index + m[0].length;
    if (pos > start && pos < end) best = pos;
  }
  if (best > 0) return best;

  const para = /\n\s*\n/.exec(wnd);
  if (para) return start + para.index + 1;

  const sec = /[，、；,:;]\s*/g;
  while ((m = sec.exec(wnd)) !== null) {
    const pos = start + m.index + m[0].length;
    if (pos > start && pos < end) best = pos;
  }
  if (best > 0) return best;

  return target;
}

const SPLITTER_SYS = `你是一个文本分割工具。你的唯一职责是在给定的搜索窗口 [search_start, search_end] 内，找到最合适的自然分割点。

选择分割点的优先级（从高到低）：
1. 句子结束符之后：。！？.!? 及紧随的换行或空白之后
2. 段落分隔符之后：连续两个及以上换行
3. 次级断句符之后：，、；,:;
4. 词间空格之后：避免截断英文单词
5. 如果以上均不存在，选择窗口内最接近中心的位置

返回位置必须在 [search_start, search_end] 范围内。使用 find_split_position 工具返回结果。`;

function splitterUserMsg(excerpt, searchStart, searchEnd) {
  return [
    `请在以下文本片段中找到最佳分割点。`,
    ``,
    `搜索窗口: [${searchStart}, ${searchEnd}]`,
    ``,
    `文本片段:`,
    `"""`,
    excerpt,
    `"""`,
    ``,
    `注意: 位置编号从 0 开始。`,
    `请在搜索窗口 [${searchStart}, ${searchEnd}] 内找到最合适的断句点。`
  ].join('\n');
}

const SPLITTER_TOOL = {
  type: 'function',
  function: {
    name: 'find_split_position',
    description: '在给定文本片段的搜索窗口内找到最佳分割位置。',
    parameters: {
      type: 'object',
      properties: {
        position: { type: 'integer', description: '选定的分割位置（相对于文本片段的字符偏移量），必须在 [search_start, search_end] 范围内。' }
      },
      required: ['position']
    }
  }
};
