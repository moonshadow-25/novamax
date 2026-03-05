import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';
import workflowAnalyzer from '../services/workflowAnalyzer.js';
import comfyuiModelManager from '../services/comfyuiModelManager.js';
import modelscopeParser from '../services/modelscopeParser.js';
import openaiProxyService from '../services/openaiProxyService.js';
import urlConverter from '../services/urlConverter.js';
import comfyuiDownloader from '../services/comfyuiDownloader.js';
import { PROJECT_ROOT } from '../config/constants.js';

const router = express.Router();

// 配置文件上传
const uploadDir = path.join(PROJECT_ROOT, 'backend', 'temp', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB (images can be large)
  }
});

/**
 * 从完整工作流中提取模型URL映射
 * @param {Object} fullWorkflow - 完整工作流JSON
 * @returns {Object} 文件名到URL的映射
 */
function extractURLsFromFullWorkflow(fullWorkflow) {
  const urlMap = {};

  if (!fullWorkflow.nodes || !Array.isArray(fullWorkflow.nodes)) {
    return urlMap;
  }

  // URL信息存放在 MarkdownNote 节点的 widgets_values[0] Markdown 文本中
  // 格式: [filename.safetensors](https://...)
  fullWorkflow.nodes.forEach(node => {
    if (node.type === 'MarkdownNote' && Array.isArray(node.widgets_values) && node.widgets_values[0]) {
      const markdown = node.widgets_values[0];
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(markdown)) !== null) {
        const name = match[1];
        const url = match[2];
        const info = { url, node_type: 'MarkdownNote' };
        urlMap[name] = info;
        // 同时以 basename 为 key，方便匹配
        const basename = name.split('/').pop().split('\\').pop();
        if (basename !== name) {
          urlMap[basename] = info;
        }
      }
    }
  });

  console.log(`从完整工作流提取到 ${Object.keys(urlMap).length} 个模型URL`);
  return urlMap;
}

/**
 * 上传并分析工作流（支持双文件）
 * POST /api/comfyui/upload-workflow
 */
router.post('/comfyui/upload-workflow', upload.fields([
  { name: 'apiWorkflow', maxCount: 1 },
  { name: 'fullWorkflow', maxCount: 1 }
]), async (req, res) => {
  try {
    const apiFile = req.files?.apiWorkflow?.[0];
    const fullFile = req.files?.fullWorkflow?.[0];

    if (!apiFile) {
      return res.status(400).json({ error: 'API workflow file is required' });
    }

    const { name, description } = req.body;

    // 读取API工作流（必需，用于执行）
    const apiWorkflowContent = fs.readFileSync(apiFile.path, 'utf-8');
    const apiWorkflow = JSON.parse(apiWorkflowContent);

    // 读取完整工作流（可选，用于提取URL）
    let fullWorkflow = null;
    if (fullFile) {
      const fullWorkflowContent = fs.readFileSync(fullFile.path, 'utf-8');
      fullWorkflow = JSON.parse(fullWorkflowContent);
      console.log('检测到完整工作流文件，将提取模型下载链接');
    }

    // 清理临时文件
    fs.unlinkSync(apiFile.path);
    if (fullFile) {
      fs.unlinkSync(fullFile.path);
    }

    // 分析API工作流
    const analysis = await workflowAnalyzer.analyzeWorkflow(
      apiWorkflow,
      name || apiFile.originalname
    );

    // 如果有完整工作流，提取URL信息并补充到required_models
    if (fullWorkflow) {
      const urlMap = extractURLsFromFullWorkflow(fullWorkflow);

      analysis.required_models = analysis.required_models.map(model => {
        const urlInfo = urlMap[model.filename];

        if (urlInfo) {
          // 生成多个下载源
          const sources = urlConverter.generateDownloadSources(urlInfo.url);

          return {
            ...model,
            original_url: urlInfo.url,
            download_sources: sources,
            has_url: true
          };
        } else {
          return {
            ...model,
            has_url: false
          };
        }
      });

      console.log(`已为 ${analysis.required_models.filter(m => m.has_url).length}/${analysis.required_models.length} 个模型配置下载源`);
    }

    // 检查并更新模型下载状态
    analysis.required_models = comfyuiModelManager.updateModelsStatus(
      analysis.required_models
    );

    // 保存工作流到workflows目录
    const workflowId = Date.now().toString();
    const workflowsDir = path.join(PROJECT_ROOT, 'data', 'models_dir', 'comfyui', 'workflows');
    const workflowPath = path.join(workflowsDir, `${workflowId}.json`);

    // 确保目录存在
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
    }

    fs.writeFileSync(workflowPath, JSON.stringify(apiWorkflow, null, 2));

    res.json({
      success: true,
      workflow_id: workflowId,
      analysis,
      name: name || apiFile.originalname,
      description: description || '',
      has_full_workflow: !!fullWorkflow,
      models_with_urls: analysis.required_models.filter(m => m.has_url).length,
      total_models: analysis.required_models.length
    });
  } catch (error) {
    console.error('Upload workflow error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 分析已有工作流
 * POST /api/comfyui/analyze-workflow
 */
router.post('/comfyui/analyze-workflow', async (req, res) => {
  try {
    const { workflow, name } = req.body;

    if (!workflow) {
      return res.status(400).json({ error: 'Workflow data required' });
    }

    // 调用workflowAnalyzer分析工作流
    const analysis = await workflowAnalyzer.analyzeWorkflow(
      workflow,
      name || 'Untitled Workflow'
    );

    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    console.error('Analyze workflow error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 确认并保存工作流配置
 * POST /api/comfyui/confirm-workflow
 */
router.post('/comfyui/confirm-workflow', async (req, res) => {
  try {
    const { name, description, analysis, comfyui_config } = req.body;

    if (!name || !analysis) {
      return res.status(400).json({ error: 'Name and analysis required' });
    }

    // 创建模型配置
    const modelData = {
      name,
      description: description || analysis.workflow.llm_analysis,
      workflow: analysis.workflow,
      required_models: analysis.required_models,
      parameter_mapping: analysis.parameter_mapping,
      default_parameters: analysis.default_parameters,
      comfyui_config: comfyui_config || {
        port: 8188,
        host: '127.0.0.1'
      }
    };

    // 保存到comfyui.json
    const model = await modelManager.create('comfyui', modelData);

    res.json({
      success: true,
      model
    });
  } catch (error) {
    console.error('Confirm workflow error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取工作流所有节点（供前端下拉选择）
 * GET /api/comfyui/:id/workflow-nodes
 */
router.get('/comfyui/:id/workflow-nodes', (req, res) => {
  const model = modelManager.getById(req.params.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const workflowJson = model.workflow?.original || {};
  const nodes = Object.entries(workflowJson)
    .filter(([, data]) => data?.class_type)
    .map(([id, data]) => ({
      id,
      class_type: data.class_type,
      title: data._meta?.title || '',
      inputs: data.inputs || {}
    }));

  res.json({ success: true, nodes });
});

/**
 * 保存用户自定义参数映射
 * PUT /api/comfyui/:id/user-mapping
 */
router.put('/comfyui/:id/user-mapping', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const { user_parameter_mapping } = req.body;
    if (typeof user_parameter_mapping !== 'object') {
      return res.status(400).json({ error: 'user_parameter_mapping must be an object' });
    }

    await modelManager.update(req.params.id, { user_parameter_mapping });
    res.json({ success: true });
  } catch (error) {
    console.error('Save user mapping error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 搜索模型
 * POST /api/comfyui/:id/search-model
 */
router.post('/comfyui/:id/search-model', async (req, res) => {
  try {
    const { model_type, filename } = req.body;

    if (!model_type || !filename) {
      return res.status(400).json({ error: 'model_type and filename required' });
    }

    // 使用LLM生成搜索关键词
    const searchQuery = await comfyuiModelManager.generateSearchQuery(filename, model_type);

    // 调用ModelScope搜索
    const searchResults = await modelscopeParser.searchModels(searchQuery);

    // 智能匹配最佳结果
    const bestMatch = comfyuiModelManager.findBestMatch(searchResults, filename);

    res.json({
      success: true,
      query: searchQuery,
      results: searchResults,
      bestMatch,
      totalCount: searchResults.length
    });
  } catch (error) {
    console.error('Search model error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 下载模型（异步，立即返回 taskId）
 * POST /api/comfyui/:id/download-model
 */
router.post('/comfyui/:id/download-model', async (req, res) => {
  try {
    const { type, filename } = req.body;

    if (!type || !filename) {
      return res.status(400).json({ error: 'type and filename required' });
    }

    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const requiredModel = model.required_models?.find(
      m => m.type === type && m.filename === filename
    );

    if (!requiredModel) {
      return res.status(404).json({ error: 'Required model not found' });
    }

    if (!requiredModel.has_url || !requiredModel.download_sources) {
      return res.status(400).json({
        error: 'No download sources available. Please search for the model first.'
      });
    }

    const modelId = req.params.id;
    console.log(`异步启动下载: ${filename} (${type})`);

    const taskId = comfyuiDownloader.startDownload(requiredModel, async (result) => {
      if (result.success) {
        const latestModel = modelManager.getById(modelId);
        if (latestModel) {
          const idx = latestModel.required_models.findIndex(
            m => m.type === type && m.filename === filename
          );
          if (idx !== -1) {
            latestModel.required_models[idx].downloaded = true;
            latestModel.required_models[idx].local_path = result.path;
            latestModel.required_models[idx].download_source = result.source;
            await modelManager.update(modelId, {
              required_models: latestModel.required_models
            });
          }
        }
      }
    });

    res.json({ success: true, taskId });
  } catch (error) {
    console.error('Download model error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 批量下载所有缺失模型（异步，立即返回 tasks 列表）
 * POST /api/comfyui/:id/download-all-models
 */
router.post('/comfyui/:id/download-all-models', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const missingModels = (model.required_models || []).filter(
      m => !m.downloaded && m.has_url && m.download_sources
    );

    if (missingModels.length === 0) {
      return res.json({ success: true, message: '没有需要下载的模型', tasks: [] });
    }

    const modelId = req.params.id;
    console.log(`异步启动批量下载 ${missingModels.length} 个模型`);

    const tasks = missingModels.map(requiredModel => {
      const { type, filename } = requiredModel;
      const taskId = comfyuiDownloader.startDownload(requiredModel, async (result) => {
        if (result.success) {
          const latestModel = modelManager.getById(modelId);
          if (latestModel) {
            const idx = latestModel.required_models.findIndex(
              m => m.type === type && m.filename === filename
            );
            if (idx !== -1) {
              latestModel.required_models[idx].downloaded = true;
              latestModel.required_models[idx].local_path = result.path;
              latestModel.required_models[idx].download_source = result.source;
              await modelManager.update(modelId, {
                required_models: latestModel.required_models
              });
            }
          }
        }
      });
      return { taskId, filename, type };
    });

    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Batch download error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 查询下载任务状态
 * GET /api/comfyui/download-status/:taskId
 */
router.get('/comfyui/download-status/:taskId', (req, res) => {
  const task = comfyuiDownloader.getTask(req.params.taskId);
  if (!task) {
    return res.json({ success: true, task: { status: 'not_found' } });
  }
  res.json({ success: true, task });
});

/**
 * 获取模型状态
 * GET /api/comfyui/:id/models-status
 */
router.get('/comfyui/:id/models-status', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 扫描并更新模型状态
    const updatedModels = comfyuiModelManager.updateModelsStatus(model.required_models || []);

    // 保存更新后的状态
    await modelManager.update(req.params.id, {
      required_models: updatedModels
    });

    res.json({
      success: true,
      required_models: updatedModels,
      summary: {
        total: updatedModels.length,
        downloaded: updatedModels.filter(m => m.downloaded).length,
        missing: updatedModels.filter(m => !m.downloaded).length
      }
    });
  } catch (error) {
    console.error('Get models status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 启动ComfyUI
 * POST /api/comfyui/:id/start
 */
router.post('/comfyui/:id/start', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 检查所有required_models是否已下载
    const updatedModels = comfyuiModelManager.updateModelsStatus(model.required_models || []);
    const missingModels = updatedModels.filter(m => !m.downloaded);

    if (missingModels.length > 0) {
      return res.status(400).json({
        error: 'Some required models are missing',
        missingModels: missingModels.map(m => ({
          type: m.type,
          filename: m.filename
        }))
      });
    }

    // 启动ComfyUI进程
    const result = await processManager.startBackend(req.params.id);

    // 更新模型状态
    await modelManager.update(req.params.id, {
      status: 'running'
    });

    res.json({
      success: true,
      port: result.port,
      status: result.status
    });
  } catch (error) {
    console.error('Start ComfyUI error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 停止ComfyUI
 * POST /api/comfyui/:id/stop
 */
router.post('/comfyui/:id/stop', async (req, res) => {
  try {
    const result = await processManager.stopBackend(req.params.id);

    // 更新模型状态
    await modelManager.update(req.params.id, {
      status: 'stopped'
    });

    res.json({
      success: true,
      status: result.status
    });
  } catch (error) {
    console.error('Stop ComfyUI error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取ComfyUI状态
 * GET /api/comfyui/:id/status
 */
router.get('/comfyui/:id/status', async (req, res) => {
  try {
    const status = processManager.getStatus(req.params.id);
    res.json(status);
  } catch (error) {
    console.error('Get ComfyUI status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 检查ComfyUI连接状态
 * GET /api/comfyui/:id/check
 */
router.get('/comfyui/:id/check', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const { host, port } = model.comfyui_config || { host: '127.0.0.1', port: 8188 };
    console.log(`Checking ComfyUI connection: ${host}:${port}`);
    const result = await openaiProxyService.checkConnection(host, port);
    res.json({ success: true, connected: result.connected });
  } catch (error) {
    console.error('ComfyUI connection check failed:', error.message, '| code:', error.code, '| response status:', error.response?.status);
    res.json({ success: true, connected: false, error: error.message });
  }
});

/**
 * 上传图片到ComfyUI（代理转发）
 * POST /api/comfyui/:id/upload-image
 */
router.post('/comfyui/:id/upload-image', upload.single('image'), async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { host, port } = model.comfyui_config || { host: '127.0.0.1', port: 8188 };

    // 转发到 ComfyUI /upload/image（使用原生 fetch + FormData，避免 axios 代理问题）
    const fileBuffer = fs.readFileSync(req.file.path);
    const blob = new Blob([fileBuffer], { type: req.file.mimetype || 'image/png' });
    const form = new FormData();
    form.append('image', blob, req.file.originalname || 'upload.png');
    form.append('overwrite', 'true');

    const response = await fetch(`http://${host}:${port}/upload/image`, {
      method: 'POST',
      body: form,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000)
    });

    // 清理临时文件
    fs.unlinkSync(req.file.path);

    const data = await response.json();
    res.json({ success: true, filename: data.name });
  } catch (error) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    console.error('Upload image error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 异步提交工作流（立即返回 promptId，不等待完成）
 * POST /api/comfyui/:id/run
 */
router.post('/comfyui/:id/run', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const { host, port } = model.comfyui_config || { host: '127.0.0.1', port: 8188 };

    // 智能填充图像槽：用户提供的图像数少于工作流所需时，复用最后一张
    const params = { ...req.body };
    const imageParamKeys = Object.entries(model.parameter_mapping?.inputs || {})
      .filter(([, def]) => def.type === 'image')
      .map(([key]) => key);

    if (imageParamKeys.length > 1) {
      const providedImages = imageParamKeys
        .map(key => params[key])
        .filter(v => v && typeof v === 'string');

      if (providedImages.length > 0) {
        const lastImage = providedImages[providedImages.length - 1];
        for (const key of imageParamKeys) {
          if (!params[key]) {
            params[key] = lastImage;
            console.log(`Image slot "${key}" not provided, reusing: ${lastImage}`);
          }
        }
      }
    }

    // 合并自动映射 + 用户自定义映射（用户定义优先）
    const effectiveMapping = {
      ...model.parameter_mapping,
      inputs: {
        ...(model.parameter_mapping?.inputs || {}),
        ...(model.user_parameter_mapping || {})
      }
    };

    const workflow = await openaiProxyService.mapParametersToWorkflow(
      model.workflow.original,
      effectiveMapping,
      params
    );

    const promptId = await openaiProxyService.submitWorkflow(host, port, workflow);
    res.json({ success: true, promptId });
  } catch (error) {
    console.error('Run workflow error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 生成图像/视频 (OpenAI兼容API)
 * POST /api/comfyui/:id/generate
 */
router.post('/comfyui/:id/generate', async (req, res) => {
  try {
    const result = await openaiProxyService.generate(req.params.id, req.body);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取生成进度
 * GET /api/comfyui/:id/progress/:taskId
 */
router.get('/comfyui/:id/progress/:taskId', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    const processStatus = processManager.getStatus(req.params.id);
    const host = model?.comfyui_config?.host || '127.0.0.1';
    const port = processStatus.running ? processStatus.port : (model?.comfyui_config?.port || 8188);

    const progress = await openaiProxyService.getProgress(
      host,
      port,
      req.params.taskId
    );

    res.json({
      success: true,
      ...progress
    });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取生成结果
 * GET /api/comfyui/:id/result/:taskId
 */
router.get('/comfyui/:id/result/:taskId', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    const processStatus = processManager.getStatus(req.params.id);
    const host = model?.comfyui_config?.host || '127.0.0.1';
    const port = processStatus.running ? processStatus.port : (model?.comfyui_config?.port || 8188);

    // 使用pollResult获取最终结果（单次检查，非阻塞轮询）
    const result = await openaiProxyService.pollResult(host, port, req.params.taskId);

    // 提取输出文件，构造代理 URL（通过本后端转发，不直接暴露 ComfyUI 地址）
    const modelId = req.params.id;
    const images = [];
    if (result.outputs) {
      for (const output of Object.values(result.outputs)) {
        for (const img of (output.images || [])) {
          const qs = img.subfolder ? `?subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type || 'output'}` : `?type=${img.type || 'output'}`;
          images.push({ url: `/api/comfyui/${modelId}/view/${encodeURIComponent(img.filename)}${qs}`, filename: img.filename });
        }
        for (const vid of (output.videos || [])) {
          const qs = vid.subfolder ? `?subfolder=${encodeURIComponent(vid.subfolder)}&type=${vid.type || 'output'}` : `?type=${vid.type || 'output'}`;
          images.push({ url: `/api/comfyui/${modelId}/view/${encodeURIComponent(vid.filename)}${qs}`, filename: vid.filename });
        }
      }
    }

    res.json({
      success: true,
      data: images.map(img => ({ url: img.url }))
    });
  } catch (error) {
    console.error('Get result error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 代理 ComfyUI 输出图片（通过 ComfyUI /view 接口）
 * GET /api/comfyui/:id/view/:filename
 */
router.get('/comfyui/:id/view/:filename', async (req, res) => {
  try {
    const model = modelManager.getById(req.params.id);
    const { host, port } = model?.comfyui_config || { host: '127.0.0.1', port: 8188 };
    const { filename } = req.params;
    const subfolder = req.query.subfolder || '';
    const type = req.query.type || 'output';

    const viewUrl = `http://${host}:${port}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
    const response = await fetch(viewUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image from ComfyUI' });
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('View image error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;


