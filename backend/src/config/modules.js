/**
 * 模块注册表：每个功能模块到其依赖引擎的映射
 * 用于模块开关系统和引擎过滤
 */

export const MODULE_REGISTRY = [
  {
    id: 'llm',
    name: 'LLM',
    nameZh: '大语言模型',
    requiredEngines: ['llamacpp'],
    alwaysEnabled: true,
    order: 1
  },
  {
    id: 'comfyui',
    name: 'ComfyUI',
    nameZh: '图像生成',
    requiredEngines: ['comfyui'],
    recommended: true,
    order: 2
  },
  {
    id: 'tts',
    name: 'TTS',
    nameZh: '语音合成',
    requiredEngines: ['tts'],
    recommended: false,
    order: 3
  },
  {
    id: 'asr',
    name: 'ASR',
    nameZh: '语音识别',
    requiredEngines: ['asr'],
    recommended: false,
    order: 4
  },
  {
    id: 'ocr',
    name: 'OCR',
    nameZh: '文字识别',
    requiredEngines: ['ocr'],
    recommended: false,
    order: 5
  }
];

/** 低配设备判定阈值：专用显存 < 16 GB */
export const LOW_END_VRAM_THRESHOLD = 16 * 1024 * 1024 * 1024; // 16 GB in bytes

/**
 * 根据引擎 ID 查找所属模块
 * @param {string} engineId
 * @returns {object|null} 模块定义，如果引擎不属于任何模块则返回 null
 */
export function getModuleForEngine(engineId) {
  return MODULE_REGISTRY.find(m => m.requiredEngines.includes(engineId)) || null;
}
