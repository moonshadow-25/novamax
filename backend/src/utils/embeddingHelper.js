/**
 * Embedding 模型判断辅助工具
 * 集中管理 Embedding 模型的关键词匹配模式与判断逻辑，供各模块统一调用。
 *
 * 判断优先级：
 *   1. modelData.embedding === true（显式标志）
 *   2. modelData.parameters.embedding === true（参数中的显式标志）
 *   3. 关键词正则匹配（name / id / modelscope_id / api_model）
 */

export const EMBEDDING_PATTERN =
  /(?:embedding|embed|sentence[-_ ]?transformer|text2vec|semantic|vector|dpr|contriever|simcse|sbert)/i;

/**
 * 判断模型数据是否为 Embedding 模型（与模型类型无关）。
 * @param {object} modelData - 模型数据对象
 * @returns {boolean}
 */
export function isEmbeddingModelData(modelData) {
  if (modelData?.embedding === true) return true;
  if (modelData?.parameters?.embedding === true) return true;

  const keywords = [
    modelData?.name,
    modelData?.id,
    modelData?.modelscope_id,
    modelData?.api_model,
  ].filter(v => typeof v === 'string' && v.trim().length > 0);

  return keywords.some(v => EMBEDDING_PATTERN.test(v));
}
