/**
 * TTS Engine Manager — 引擎生命周期管理的唯一权威模块。
 *
 * 职责：
 *   1. 列出已安装引擎（contract.json + adapter.js），并解析关联的模型目录
 *   2. 引擎启动 / 停止 / 状态查询
 *   3. 管理运行中的适配器实例
 *
 * 工作区不直接启动引擎。工作区存储的是引擎管理器提供的信息（engine_type），
 * 启动时调用引擎管理器，由引擎管理器负责 adapter 加载、模型解析和 initialize。
 */
import ttsAdapterLoader from './ttsAdapterLoader.js';
import modelManager from './modelManager.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

class TtsEngineManager {
  constructor() {
    /** @type {Map<string, { adapter: object, modelDir: string, status: string }>} */
    this._instances = new Map();
  }

  /* ========================================================================
   * 公共 API — 引擎列表
   * ======================================================================== */

  /**
   * 列出所有已安装的 TTS 引擎及其关联的模型信息。
   * 工作区创建时从此获取可选引擎列表。
   *
   * @returns {Array<{ engine_type: string, engine_name: string, version: string,
   *                   contract: object, model_id: string|null, model_dir: string|null,
   *                   model_name: string|null }>}
   */
  listEngines() {
    const contracts = ttsAdapterLoader.listContracts();
    return contracts.map(c => {
      const model = this._resolveModel(c.engine_type);
      return {
        engine_type: c.engine_type,
        engine_name: c.engine_name,
        version: c.version,
        contract: c.contract,
        model_id: model?.id || null,
        model_dir: model?.local_path || null,
        model_name: model?.name || null,
      };
    });
  }

  /* ========================================================================
   * 公共 API — 生命周期
   * ======================================================================== */

  /**
   * 启动引擎。
   *
   * 按 contract.json 中声明的 engine.type 查找并启动引擎。
   * 模型目录通过 model.engine_version 与 engine_type 精确匹配解析。
   *
   * @param {string} engineType - contract.json 的 engine.type
   * @returns {Promise<{ engine_type: string, status: string, model_dir: string }>}
   */
  async start(engineType) {
    const existing = this._instances.get(engineType);
    if (existing && existing.status === 'running') {
      return { engine_type: engineType, status: 'running', model_dir: existing.modelDir };
    }

    const adapter = await ttsAdapterLoader.getAdapter(engineType);
    const model = this._resolveModel(engineType);

    if (!model) {
      throw new Error(
        `未找到与引擎类型 "${engineType}" 关联的模型（按 engine_version 精确匹配）。` +
        `请在模型配置中将 engine_version 设为 "${engineType}"。`
      );
    }

    if (!model.local_path) {
      throw new Error(`模型 "${model.name}" 尚未配置本地路径，请先下载模型文件。`);
    }

    await adapter.initialize({
      modelDir: model.local_path,
      deviceId: -1,
      custom: {}
    });

    this._instances.set(engineType, {
      adapter,
      modelDir: model.local_path,
      status: 'running'
    });

    return {
      engine_type: engineType,
      status: 'running',
      model_dir: model.local_path,
      model_id: model.id,
      model_name: model.name,
    };
  }

  /**
   * 停止引擎。
   * @param {string} engineType
   */
  async stop(engineType) {
    const inst = this._instances.get(engineType);
    if (inst) {
      try { await inst.adapter.dispose(); } catch (e) { /* adapter 内部已处理 */ }
      this._instances.delete(engineType);
    }
    await ttsAdapterLoader.unloadAdapter(engineType);
    return { engine_type: engineType, status: 'stopped' };
  }

  /**
   * 是否有任意引擎正在运行。
   * @returns {boolean}
   */
  isRunning() {
    for (const inst of this._instances.values()) {
      if (inst.status === 'running') return true;
    }
    return false;
  }

  /**
   * 查询引擎运行状态。
   * @param {string} engineType
   */
  status(engineType) {
    const inst = this._instances.get(engineType);
    if (!inst) return { engine_type: engineType, status: 'stopped' };
    return {
      engine_type: engineType,
      status: inst.status,
      model_dir: inst.modelDir,
    };
  }

  /* ========================================================================
   * 内部
   * ======================================================================== */

  /**
   * 按 engine_type 解析关联的模型记录。
   *
   * 匹配规则：model.engine_version 与 engine_type 精确相等（大小写不敏感）。
   * 不做模糊匹配，不做 fallback。
   *
   * @param {string} engineType
   * @returns {object|null}
   */
  _resolveModel(engineType) {
    const norm = normalizeEngineType(engineType);
    return modelManager.getByType('tts').find(m => {
      if (m.engine_version) return normalizeEngineType(m.engine_version) === norm;
      return normalizeEngineType(m.id) === norm;
    }) || null;
  }
}

const ttsEngineManager = new TtsEngineManager();
export default ttsEngineManager;
