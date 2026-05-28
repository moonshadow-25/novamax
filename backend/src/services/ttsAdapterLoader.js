/**
 * TTS 适配器加载器
 *
 * 职责：
 *   1. 从已安装引擎目录加载 contract.json
 *   2. 动态导入 adapter.js 并实例化
 *   3. 缓存已加载的适配器实例
 *
 * 引擎必须提供 adapter.js，无 fallback。
 */
import path from 'path';
import fs from 'fs';
import engineManager from './engineManager.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

class TtsAdapterLoader {
  constructor() {
    // engineType@version -> AdapterInstance
    this.adapters = new Map();
  }

  /* ========================================================================
   * 公共 API
   * ======================================================================== */

  /**
   * 获取或加载引擎适配器。
   * @param {string} engineType - 引擎标识，如 "indextts2"
   * @param {string} [version] - 版本号，不传则使用默认版本
   * @returns {Promise<object>} ITtsEngine 兼容的适配器实例
   */
  async getAdapter(engineType, version) {
    const resolvedVersion = version || engineManager.getDefaultVersion('tts');
    const cacheKey = `${engineType}@${resolvedVersion}`;

    if (this.adapters.has(cacheKey)) {
      return this.adapters.get(cacheKey);
    }

    const adapter = await this._load(engineType, resolvedVersion);
    this.adapters.set(cacheKey, adapter);
    return adapter;
  }

  /**
   * 卸载适配器（dispose + 清缓存）。
   */
  async unloadAdapter(engineType, version) {
    const resolvedVersion = version || engineManager.getDefaultVersion('tts');
    const cacheKey = `${engineType}@${resolvedVersion}`;
    const adapter = this.adapters.get(cacheKey);
    if (adapter) {
      try { await adapter.dispose(); } catch (e) { /* ignore */ }
      this.adapters.delete(cacheKey);
    }
  }

  /**
   * 列出所有已安装引擎的 contract。
   */
  listContracts() {
    const result = [];
    const installed = engineManager.getInstalledVersions('tts');

    for (const ver of installed) {
      const contract = this._readContract(ver.path);
      if (!contract) continue;

      const engineType = contract?.engine?.type || contract?.engine_type || path.basename(ver.path);
      const engineName = contract?.engine?.name || contract?.engine_name || engineType;

      result.push({
        engine_type: engineType,
        engine_name: engineName,
        version: ver.version,
        path: ver.path,
        contract
      });
    }

    return result;
  }

  /* ========================================================================
   * 内部
   * ======================================================================== */

  async _load(engineType, version) {
    const engineDir = this._resolveEngineDir(engineType, version);
    if (!engineDir) {
      throw new Error(`引擎 ${engineType}@${version} 未安装`);
    }

    const contract = this._readContract(engineDir);
    if (!contract) {
      throw new Error(`引擎 ${engineType}@${version} 缺少 contract.json`);
    }

    const adapterPath = path.join(engineDir, 'adapter.js');
    if (!fs.existsSync(adapterPath)) {
      throw new Error(`引擎 ${engineType}@${version} 缺少 adapter.js，该引擎不支持接入`);
    }

    const module = await import(`file://${adapterPath}`);
    const AdapterClass = module.default || module.TtsEngineAdapter;
    if (!AdapterClass) {
      throw new Error(`adapter.js 未导出 default 或 TtsEngineAdapter`);
    }

    return new AdapterClass(contract);
  }

  _readContract(engineDir) {
    const contractPath = path.join(engineDir, 'contract.json');
    if (!fs.existsSync(contractPath)) return null;
    try { return JSON.parse(fs.readFileSync(contractPath, 'utf-8')); }
    catch { return null; }
  }

  _resolveEngineDir(engineType, version) {
    // 1. 按版本号精确查找
    const enginePath = engineManager.getEnginePath('tts', version);
    if (enginePath && fs.existsSync(enginePath)) return enginePath;

    // 2. 遍历已安装版本，按 contract.json 的 engine.type 精确匹配
    const installed = engineManager.getInstalledVersions('tts');
    for (const ver of installed) {
      const contract = this._readContract(ver.path);
      if (contract && normalizeEngineType(contract.engine?.type) === normalizeEngineType(engineType)) {
        return ver.path;
      }
    }

    return null;
  }

  _getTtsVariants() {
    const tts = engineManager.getEngine('tts');
    return tts?.variants || [];
  }
}

const ttsAdapterLoader = new TtsAdapterLoader();
export default ttsAdapterLoader;
