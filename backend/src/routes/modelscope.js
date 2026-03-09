import express from 'express';
import modelscopeService from '../services/modelscopeService.js';
import modelscopeParser from '../services/modelscopeParser.js';
import modelManager from '../services/modelManager.js';

const router = express.Router();

router.post('/modelscope/token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    modelscopeService.setToken(token);
    res.json({ success: true, message: 'Token set successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/modelscope/user/:username/models', async (req, res) => {
  try {
    const { username } = req.params;
    const data = await modelscopeService.getUserModels(username);

    const allModels = data.Data || [];
    const novaModels = modelscopeService.filterNovaAIModels(allModels);

    res.json({
      total: novaModels.length,
      models: novaModels
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/modelscope/model/:owner/:name/files', async (req, res) => {
  try {
    const { owner, name } = req.params;
    const modelId = `${owner}/${name}`;
    const files = await modelscopeService.getModelFiles(modelId);
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/modelscope/import', async (req, res) => {
  try {
    const { owner, name, fileName, modelType } = req.body;

    if (!owner || !name || !fileName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const modelId = `${owner}/${name}`;
    const downloadUrl = modelscopeService.getDownloadUrl(modelId, fileName);

    const newModel = await modelManager.add({
      name: name,
      type: modelType || 'llm',
      path: downloadUrl,
      source: 'modelscope',
      modelscope_id: modelId,
      settings: {
        context_size: 4096,
        gpu_layers: 35
      }
    });

    res.json({
      success: true,
      model: newModel
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/modelscope/auto-import/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const data = await modelscopeService.getUserModels(username);

    const allModels = data.Data || [];
    const novaModels = modelscopeService.filterNovaAIModels(allModels);

    const imported = [];

    for (const model of novaModels) {
      try {
        const modelId = `${model.Owner}/${model.Name}`;
        const files = await modelscopeService.getModelFiles(modelId);

        const ggufFile = files.Data?.Files?.find(f =>
          f.Name.endsWith('.gguf')
        );

        if (ggufFile) {
          const downloadUrl = modelscopeService.getDownloadUrl(modelId, ggufFile.Path);

          const newModel = await modelManager.add({
            name: model.Name,
            type: 'llm',
            path: downloadUrl,
            source: 'modelscope',
            modelscope_id: modelId,
            description: model.Description || '',
            settings: {
              context_size: 4096,
              gpu_layers: 35
            }
          });

          imported.push(newModel);
        }
      } catch (error) {
        console.error(`Failed to import ${model.Name}:`, error.message);
      }
    }

    res.json({
      success: true,
      imported: imported.length,
      models: imported
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 新功能：解析 ModelScope URL
router.post('/modelscope/parse-url', async (req, res) => {
  try {
    const { url, type = 'llm' } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL 参数缺失' });
    }

    // 验证类型
    const validTypes = ['llm', 'comfyui', 'tts', 'whisper'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `无效的模型类型: ${type}` });
    }

    // 解析 URL
    let parsedUrl;
    try {
      parsedUrl = modelscopeParser.parseModelUrl(url);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const { modelId, folder } = parsedUrl;

    // 获取模型信息
    let modelInfo;
    try {
      modelInfo = await modelscopeParser.fetchModelInfo(modelId);
    } catch (error) {
      if (error.message.includes('未找到')) {
        return res.status(404).json({ error: '在 ModelScope 上未找到该模型' });
      } else if (error.message.includes('无法连接')) {
        return res.status(503).json({ error: '无法连接到 ModelScope' });
      }
      throw error;
    }

    const { modelData, files, description } = modelInfo;

    // 生成配置
    let config;
    try {
      config = modelscopeParser.generateModelConfig(
        modelId,
        type,
        modelData,
        files,
        description,
        folder
      );
    } catch (error) {
      if (error.message.includes('没有 GGUF')) {
        return res.status(422).json({ error: '该仓库中没有 GGUF 文件' });
      }
      throw error;
    }

    // 生成预览数据
    const preview = {
      name: config.name,
      description: config.description,
      quantizations: config.quantizations || [],
      mmproj_count: config.mmproj_options?.length || 0,
      capabilities: config.capabilities,
      filter_folder: folder
    };

    res.json({
      success: true,
      modelId,
      folder,
      preview,
      config
    });
  } catch (error) {
    console.error('解析 URL 错误:', error);
    res.status(500).json({ error: error.message || '服务器内部错误' });
  }
});

// 新功能：搜索 ModelScope 模型
router.post('/modelscope/search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: '搜索查询至少需要 2 个字符' });
    }

    const result = await modelscopeParser.searchModels(query.trim());

    res.json({
      success: true,
      models: result.models,
      totalCount: result.totalCount
    });
  } catch (error) {
    console.error('搜索模型错误:', error);
    res.status(500).json({ error: error.message || '搜索失败' });
  }
});

// 新功能：确认并保存模型配置
router.post('/modelscope/confirm', async (req, res) => {
  try {
    const { config } = req.body;

    if (!config || !config.type) {
      return res.status(400).json({ error: '无效的模型配置' });
    }

    // 验证类型
    const validTypes = ['llm', 'comfyui', 'tts', 'whisper'];
    if (!validTypes.includes(config.type)) {
      return res.status(400).json({ error: `无效的模型类型: ${config.type}` });
    }

    // 检查是否已存在相同 modelscope_id 的模型
    if (config.modelscope_id) {
      const existing = modelManager.getAll().find(
        m => m.modelscope_id === config.modelscope_id && m.type === config.type
      );
      if (existing) {
        return res.status(409).json({ error: `模型已存在：${existing.modelscope_id}` });
      }
    }

    // 保存模型
    const savedModel = await modelManager.create(config.type, config);

    res.json({
      success: true,
      model: savedModel
    });
  } catch (error) {
    console.error('保存模型错误:', error);
    res.status(500).json({ error: error.message || '保存模型失败' });
  }
});

export default router;
