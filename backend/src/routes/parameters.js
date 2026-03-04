import express from 'express';
import parameterService from '../services/parameterService.js';
import presetService from '../services/presetService.js';
import modelManager from '../services/modelManager.js';

const router = express.Router();

// 获取模型的有效参数
router.get('/parameters/:modelId', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.modelId);

    if (!model) {
      return res.status(404).json({ error: '模型不存在' });
    }

    const params = parameterService.getEffectiveParameters(model);
    res.json({ parameters: params });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 保存用户参数
router.put('/parameters/:modelId', async (req, res) => {
  try {
    // 1. 保存用户参数到 JSON
    const params = await parameterService.saveUserParameters(
      req.params.modelId,
      req.body.parameters
    );

    // 2. 重新生成 INI 文件（关键！）
    const model = modelManager.getById(req.params.modelId);
    if (model) {
      await presetService.generatePresetFile(model.type);
      console.log(`✓ 参数已保存并更新 INI: ${req.params.modelId}`);
    }

    res.json({ parameters: params });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 重置为默认参数
router.post('/parameters/:modelId/reset', async (req, res) => {
  try {
    // 1. 重置参数
    const params = await parameterService.resetToDefault(req.params.modelId);

    // 2. 重新生成 INI 文件
    const model = modelManager.getById(req.params.modelId);
    if (model) {
      await presetService.generatePresetFile(model.type);
      console.log(`✓ 参数已重置并更新 INI: ${req.params.modelId}`);
    }

    res.json({ parameters: params });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加自定义参数
router.post('/parameters/:modelId/custom', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: '缺少参数名称' });
    }

    // 1. 添加自定义参数
    const params = await parameterService.addCustomParameter(
      req.params.modelId,
      key,
      value
    );

    // 2. 重新生成 INI 文件
    const model = modelManager.getById(req.params.modelId);
    if (model) {
      await presetService.generatePresetFile(model.type);
      console.log(`✓ 自定义参数已添加并更新 INI: ${key} = ${value}`);
    }

    res.json({ parameters: params });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除自定义参数
router.delete('/parameters/:modelId/custom/:key', async (req, res) => {
  try {
    // 1. 删除自定义参数
    const params = await parameterService.removeCustomParameter(
      req.params.modelId,
      req.params.key
    );

    // 2. 重新生成 INI 文件
    const model = modelManager.getById(req.params.modelId);
    if (model) {
      await presetService.generatePresetFile(model.type);
      console.log(`✓ 自定义参数已删除并更新 INI: ${req.params.key}`);
    }

    res.json({ parameters: params });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取参数元数据
router.get('/parameters/metadata/all', async (req, res) => {
  try {
    const metadata = parameterService.getParameterMetadata();
    res.json({ metadata });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
