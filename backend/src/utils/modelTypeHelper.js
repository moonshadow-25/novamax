/**
 * 模型类型判断工具
 * 集中管理各类模型（Embedding、Reranker 等）的关键词匹配模式与判断逻辑。
 *
 * 判断优先级：
 *   1. modelData.<type> === true（显式标志）
 *   2. modelData.parameters.<type> === true（参数中的显式标志）
 *   3. 关键词正则匹配（name / id / modelscope_id / api_model）
 *
 * 注意：Reranker 优先于 Embedding 判断，避免含 bge/jina 的 reranker 模型被误判。
 */

// ── Reranker ──────────────────────────────────────────────────────────────────
// 匹配常见 reranker 模型名称，需在 embedding 之前判断
export const RERANKER_PATTERN =
  /(?:rerank|re-rank|cross[-_ ]?encoder|ms-?marco.*(?:rerank|cross)|bge-?reranker|jina-?reranker|cohere\.?rerank|colbert)/i;

/**
 * 判断模型数据是否为 Reranker 模型。
 * @param {object} modelData
 * @returns {boolean}
 */
export function isRerankerModelData(modelData) {
  if (modelData?.reranker === true) return true;
  if (modelData?.parameters?.reranker === true) return true;

  const keywords = [
    modelData?.name,
    modelData?.id,
    modelData?.modelscope_id,
    modelData?.api_model,
  ].filter(v => typeof v === 'string' && v.trim().length > 0);

  return keywords.some(v => RERANKER_PATTERN.test(v));
}

// ── Embedding ─────────────────────────────────────────────────────────────────
export const EMBEDDING_PATTERN =
  /(?:embed|e5|bge|gte|instructor|sentence[-_ ]?transformer|text2vec|jina|voyage|cohere\.?embed|thenlper|dpr|contriever|simcse|sbert|roberta.*(?:embed|encoder)|bert.*(?:embed|encoder)|ms-?marco.*(?:embed|encoder)|semantic|vector)/i;

/**
 * 判断模型数据是否为 Embedding 模型（与模型类型无关）。
 * Reranker 模型即使名称含 embedding 关键词也不会被判断为 embedding。
 * @param {object} modelData
 * @returns {boolean}
 */
export function isEmbeddingModelData(modelData) {
  if (isRerankerModelData(modelData)) return false;

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

// ── 子类型（chat / embedding / reranker）───────────────────────────────────────

/**
 * LLM 模型的默认服务端口（按子类型区分）。
 * reranker 单独使用 1245，embedding 使用 1278，普通 chat 使用 1234。
 */
export const MODEL_SUBTYPE_PORTS = {
  chat: 1234,
  embedding: 1278,
  reranker: 1245,
};

/**
 * 获取 LLM 模型的子类型（与模型 type 无关，仅对 llm 有意义）。
 * 判断优先级：reranker > embedding > chat。
 * @param {object} modelData
 * @returns {'chat'|'embedding'|'reranker'}
 */
export function getModelSubtype(modelData) {
  if (isRerankerModelData(modelData)) return 'reranker';
  if (isEmbeddingModelData(modelData)) return 'embedding';
  return 'chat';
}
