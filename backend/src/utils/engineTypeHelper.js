/**
 * 引擎类型标识符归一化。
 * 剥离所有非字母数字字符并转小写，使不同命名惯例可互相比对。
 *
 * "indextts1.5" / "index-tts1.5" / "index_tts1.5" → "indextts15"
 */
export function normalizeEngineType(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 版本号降序比较（新版本在前）。纯字母序，不依赖 numeric 模式 */
export function compareVersions(a, b) {
  return String(b || '').localeCompare(String(a || ''));
}
