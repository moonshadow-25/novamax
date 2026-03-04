import modelManager from './modelManager.js';

class ParameterService {
  /**
   * 获取模型的有效参数（用户参数优先，带版本控制）
   */
  getEffectiveParameters(model) {
    const defaultParams = model.parameters || {};
    const defaultVersion = defaultParams.version || '1.0.0';

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
    const { version, _source, _version, _note, ...cleanParams } = userParams;

    await modelManager.update(modelId, {
      user_parameters: cleanParams,
      user_parameters_version: defaultVersion // 记录基于哪个版本
    });

    return this.getEffectiveParameters(modelManager.getById(modelId));
  }

  /**
   * 重置为默认参数
   */
  async resetToDefault(modelId) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('模型不存在');
    }

    await modelManager.update(modelId, {
      user_parameters: null,
      user_parameters_version: null
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

    const currentParams = model.user_parameters || {};
    const { [key]: removed, ...remainingParams } = currentParams;

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
        min: 512,
        max: 1048576,
        default: 8192
      },
      gpu_layers: {
        type: 'number',
        label: 'GPU 层数',
        description: '-1=全部使用GPU, 0=仅CPU, >0=指定层数',
        min: -1,
        max: 1000,
        default: -1
      },
      threads: {
        type: 'number',
        label: 'CPU 线程数',
        description: 'CPU 推理使用的线程数',
        min: 1,
        max: 128,
        default: 8
      },
      parallel: {
        type: 'number',
        label: '并行请求数',
        description: '同时处理的请求数量',
        min: 1,
        max: 16,
        default: 2
      },
      batch: {
        type: 'number',
        label: 'Batch Size',
        description: '批处理大小',
        min: 1,
        max: 2048,
        default: 512
      },
      ubatch: {
        type: 'number',
        label: 'Micro Batch',
        description: '微批处理大小',
        min: 1,
        max: 2048,
        default: 512
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
