/**
 * 构建时配置
 *
 * BUILD_VARIANT 由 esbuild define 在打包时注入：
 *   stable → 正式版（发布 ModelScope）
 *   beta   → 测试版（上传服务器）
 */

/* global __BUILD_VARIANT__ */
export const BUILD_VARIANT =
  (typeof __BUILD_VARIANT__ !== 'undefined') ? __BUILD_VARIANT__ : 'stable';

export const REMOTE_SERVER_URL_STABLE = 'https://www.firstarpc.com/download/novamax/';
export const REMOTE_SERVER_URL_BETA   = 'https://www.firstarpc.com/download/novamax/test/';

export const REMOTE_MODELS_PATH  = 'models.json';
export const REMOTE_ENGINES_PATH = 'engines.json';
