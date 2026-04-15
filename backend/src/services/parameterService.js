import modelManager from './modelManager.js';
import { DEFAULT_LLM_PARAMETERS } from '../config/constants.js';

class ParameterService {
  _sanitizeByModelSource(model, params) {
    if (model?.source === 'cloudapi') {
      const { rpc_enable, rpc_devices, ...rest } = params;
      return rest;
    }
    return params;
  }

  /**
   * 获取模型的有效参数（用户参数优先，带版本控制）
   */
  getEffectiveParameters(model) {
    const deletedKeys = new Set(model.deleted_parameters || []);
    const rawDefault = model.parameters || {};
    // 过滤掉用户主动删除的 key
    const defaultParams = Object.fromEntries(
      Object.entries(rawDefault).filter(([k]) => !deletedKeys.has(k))
    );
    const defaultVersion = rawDefault.version || '1.0.0';

    // 如果没有用户参数，返回默认参数
    if (!model.user_parameters) {
      return {
        ...defaultParams,
        _source: 'default',
        _version: defaultVersion
      };
    }

    // 检查版本号
    const userParamsVersion = model.user_parameters_version || '0.0.0';

    // 如果默认参数版本号更新了，使用默认参数
    if (this._compareVersions(defaultVersion, userParamsVersion) > 0) {
      return {
        ...defaultParams,
        _source: 'default',
        _version: defaultVersion,
        _note: '默认参数已更新，用户参数已重置'
      };
    }

    // 使用用户参数（合并默认参数作为后备）
    return {
      ...defaultParams,
      ...model.user_parameters,
      version: defaultVersion, // 保留版本号
      _source: 'user',
      _version: userParamsVersion
    };
  }

  /**
   * 保存用户参数
   */
  async saveUserParameters(modelId, userParams) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    const defaultVersion = model.parameters?.version || '1.0.0';

    // 移除 version 字段（版本号由默认参数控制）
    const { version, _source, _version, _note, ...cleanParamsRaw } = userParams;
    const cleanParams = this._sanitizeByModelSource(model, cleanParamsRaw);

    // 归一化 RPC 参数：关闭且无设备时视为“未配置”，避免仅开关来回导致进入用户自定义状态
    if (cleanParams.rpc_enable !== true) {
      delete cleanParams.rpc_enable;
    }
    const normalizedRpcDevices = Array.isArray(cleanParams.rpc_devices)
      ? cleanParams.rpc_devices.map(v => String(v).trim()).filter(Boolean)
      : [];
    if (normalizedRpcDevices.length === 0) {
      delete cleanParams.rpc_devices;
    } else {
      cleanParams.rpc_devices = normalizedRpcDevices;
    }

    // 判断提交的参数是否与默认完全一致，若是则存 null（显示"默认配置"）
    // 注意：折叠面板未展开时 Ant Design Form 不挂载字段，port 等 key 可能不在 cleanParams 里，
    //       因此只检查前端实际发来的 key，未发来的 key 视为与默认一致。
    const defaultRaw = model.parameters || {};
    // 用 DEFAULT_LLM_PARAMETERS 兜底，兼容旧数据库记录里 model.parameters 缺字段的情况
    const { version: _dlpV, ...defaultLlmBase } = DEFAULT_LLM_PARAMETERS;
    const defaultComparable = Object.fromEntries(
      Object.entries({ ...defaultLlmBase, ...defaultRaw })
        .filter(([k]) => k !== 'version' && !k.startsWith('_'))
    );
    const _isNeutralValue = (v) => {
      if (v === undefined || v === null || v === '') return true;
      const s = String(v).toLowerCase();
      return s === 'false' || s === '0' || s === 'off';
    };
    const isIdenticalToDefault = (() => {
      for (const k of Object.keys(cleanParams)) {
        const defaultVal = defaultComparable[k];
        if (defaultVal !== undefined) {
          // 该 key 在默认里有，值必须相同
          if (String(cleanParams[k]) !== String(defaultVal)) return false;
        } else {
          // 该 key 不在默认里，若为非零值则视为用户自定义
          if (!_isNeutralValue(cleanParams[k])) return false;
        }
      }
      return true;
    })();

    if (isIdenticalToDefault) {
      await modelManager.update(modelId, {
        user_parameters: null,
        user_parameters_version: null,
        deleted_parameters: []
      });
    } else {
      await modelManager.update(modelId, {
        user_parameters: cleanParams,
        user_parameters_version: defaultVersion // 记录基于哪个版本
      });
    }

    return this.getEffectiveParameters(modelManager.getById(modelId));
  }

  /**
   * 重置为默认参数（同时重置引擎版本和自动启动）
   */
  async resetToDefault(modelId) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    await modelManager.update(modelId, {
      user_parameters: null,
      user_parameters_version: null,
      deleted_parameters: [],  // 清空删除记录，让 models.json 的参数完全恢复
      engine_version: null,    // 恢复为默认（最新）引擎版本
      auto_start: false        // 关闭自动启动
    });

    return this.getEffectiveParameters(modelManager.getById(modelId));
  }

  /**
   * 添加自定义键值对
   */
  async addCustomParameter(modelId, key, value) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    // 如果用户重新添加了此前删除的 key，从删除记录中移除
    const prevDeleted = model.deleted_parameters || [];
    if (prevDeleted.includes(key)) {
      await modelManager.update(modelId, {
        deleted_parameters: prevDeleted.filter(k => k !== key)
      });
    }

    const currentParams = model.user_parameters || {};
    const updatedParams = {
      ...currentParams,
      [key]: value
    };

    return this.saveUserParameters(modelId, updatedParams);
  }

  /**
   * 删除自定义参数
   */
  async removeCustomParameter(modelId, key) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    // 从 user_parameters 里移除
    const currentParams = this._sanitizeByModelSource(model, model.user_parameters || {});
    const { [key]: removed, ...remainingParams } = currentParams;

    // 同时从 parameters（默认参数）里移除，防止它通过 defaultParams 合并回来
    if (model.parameters && key in model.parameters) {
      const { [key]: _removed, ...remainingDefault } = model.parameters;
      await modelManager.update(modelId, { parameters: remainingDefault });
    }

    // 记录用户主动删除的 key，防止远程同步时恢复
    const deletedSet = new Set(model.deleted_parameters || []);
    deletedSet.add(key);
    await modelManager.update(modelId, { deleted_parameters: [...deletedSet] });

    return this.saveUserParameters(modelId, remainingParams);
  }

  /**
   * 比较版本号 (semver 格式: major.minor.patch)
   * 返回: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  _compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }

    return 0;
  }

  /**
   * 获取参数的元数据（类型、描述等）
   */
  getParameterMetadata() {
    return {
      // 运行时参数
      context_length: {
        type: 'number',
        label: '上下文长度',
        description: 'LLM 可以记住的 token 数量',
        min: 0,
        max: 1048576,
        default: 8192
      },
      port: {
        type: 'number',
        label: '端口号',
        description: '模型服务监听端口',
        min: 1,
        max: 65535,
        default: 1234
      },
      parallel: {
        type: 'number',
        label: '并行请求数',
        description: '同时处理的请求数量',
        min: 1,
        max: 16,
        default: 1
      },
      'no-mmap': {
        type: 'boolean',
        label: 'no-mmap',
        description: '禁用内存映射，避免模型文件被映射到内存',
        default: true
      },
      'n-gpu-layers': {
        type: 'number',
        label: 'n-gpu-layers',
        description: '加载到 GPU 的层数',
        min: -1,
        max: 9999,
        default: 100
      },

      // 采样参数
      temperature: {
        type: 'number',
        label: '温度',
        description: '控制输出随机性，越高越随机',
        min: 0,
        max: 2,
        step: 0.1,
        default: 0.7
      },
      top_p: {
        type: 'number',
        label: 'Top P',
        description: '核采样参数',
        min: 0,
        max: 1,
        step: 0.05,
        default: 0.9
      },
      top_k: {
        type: 'number',
        label: 'Top K',
        description: 'Top-K 采样',
        min: 0,
        max: 200,
        default: 40
      },
      repeat_penalty: {
        type: 'number',
        label: '重复惩罚',
        description: '防止重复输出',
        min: 0,
        max: 2,
        step: 0.1,
        default: 1.1
      }
    };
  }
}

export default new ParameterService();
