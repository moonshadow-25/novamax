import axios from 'axios';
import modelManager from './modelManager.js';
import processManager from './processManager.js';

const COMFYUI_HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

/**
 * OpenAI兼容API代理服务
 * 将OpenAI格式的请求转换为ComfyUI API调用
 */
class OpenAIProxyService {
  constructor() {
    this.tasks = new Map(); // taskId -> task info
  }

  /**
   * 生成图像/视频（OpenAI兼容接口）
   * @param {string} modelId - 模型ID
   * @param {Object} params - OpenAI格式的参数
   * @returns {Object} OpenAI格式的响应
   */
  async generate(modelId, params) {
    const model = modelManager.getById(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    // 检查进程是否运行
    const status = processManager.getStatus(modelId);
    if (!status.running) {
      throw new Error('ComfyUI not running. Please start the workflow first.');
    }

    // 1. 映射参数到工作流
    const workflow = await this.mapParametersToWorkflow(
      model.workflow.original,
      model.parameter_mapping,
      params
    );

    // 2. 提交到ComfyUI
    const promptId = await this.submitWorkflow(status.port, workflow);

    // 3. 等待结果
    const result = await this.pollResult(status.port, promptId);

    // 4. 格式化为OpenAI响应
    return this.formatOpenAIResponse(result, params);
  }

  /**
   * 映射OpenAI参数到ComfyUI工作流
   * @param {Object} workflowJson - 原始工作流
   * @param {Object} mapping - 参数映射配置
   * @param {Object} params - OpenAI格式参数
   * @returns {Object} 映射后的工作流
   */
  async mapParametersToWorkflow(workflowJson, mapping, params) {
    // 深拷贝工作流
    const workflow = JSON.parse(JSON.stringify(workflowJson));

    // 映射prompt
    if (params.prompt && mapping.inputs.prompt) {
      const { node_id, field } = mapping.inputs.prompt;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.prompt;
      }
    }

    // 映射negative_prompt
    if (params.negative_prompt && mapping.inputs.negative_prompt) {
      const { node_id, field } = mapping.inputs.negative_prompt;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.negative_prompt;
      }
    }

    // 映射size (例如: "1024x1024")
    if (params.size) {
      const [width, height] = params.size.split('x').map(Number);

      if (mapping.inputs.width) {
        const { node_id, field } = mapping.inputs.width;
        if (workflow[node_id]) {
          workflow[node_id].inputs[field] = width;
        }
      }

      if (mapping.inputs.height) {
        const { node_id, field } = mapping.inputs.height;
        if (workflow[node_id]) {
          workflow[node_id].inputs[field] = height;
        }
      }
    }

    // 映射steps
    if (params.steps !== undefined && mapping.inputs.steps) {
      const { node_id, field } = mapping.inputs.steps;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.steps;
      }
    }

    // 映射cfg_scale
    if (params.cfg_scale !== undefined && mapping.inputs.cfg_scale) {
      const { node_id, field } = mapping.inputs.cfg_scale;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.cfg_scale;
      }
    }

    // 映射seed
    if (params.seed !== undefined && mapping.inputs.seed) {
      const { node_id, field } = mapping.inputs.seed;
      if (workflow[node_id]) {
        // -1表示随机种子，生成一个随机数
        const seed = params.seed === -1 ? Math.floor(Math.random() * 1000000000) : params.seed;
        workflow[node_id].inputs[field] = seed;
      }
    }

    // 映射sampler
    if (params.sampler && mapping.inputs.sampler) {
      const { node_id, field } = mapping.inputs.sampler;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.sampler;
      }
    }

    // 映射scheduler
    if (params.scheduler && mapping.inputs.scheduler) {
      const { node_id, field } = mapping.inputs.scheduler;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.scheduler;
      }
    }

    // 映射batch_size
    if (params.n !== undefined && mapping.inputs.batch_size) {
      const { node_id, field } = mapping.inputs.batch_size;
      if (workflow[node_id]) {
        workflow[node_id].inputs[field] = params.n;
      }
    }

    // 映射所有 image 类型参数（image, image_2, image_mask 等）
    for (const [key, paramDef] of Object.entries(mapping.inputs)) {
      if (paramDef.type === 'image' && params[key]) {
        const { node_id, field } = paramDef;
        if (workflow[node_id]) {
          workflow[node_id].inputs[field] = params[key];
        }
      }
    }

    // 通用兜底：映射所有非标准参数（用户自定义映射、length 等）
    const STANDARD_KEYS = new Set([
      'prompt', 'negative_prompt', 'seed', 'sampler', 'scheduler',
      'steps', 'cfg_scale', 'batch_size', 'width', 'height'
    ]);
    for (const [key, paramDef] of Object.entries(mapping.inputs)) {
      if (paramDef.type === 'image') continue;
      if (STANDARD_KEYS.has(key)) continue;
      if (params[key] !== undefined && workflow[paramDef.node_id]) {
        workflow[paramDef.node_id].inputs[paramDef.field] = params[key];
      }
    }

    return workflow;
  }

  /**
   * 提交工作流到ComfyUI
   * @param {string|number} hostOrPort - ComfyUI主机地址或端口（兼容旧调用）
   * @param {Object|number} workflowOrPort - 工作流JSON或端口
   * @param {Object} [workflow] - 工作流JSON（当第一参数为host时使用）
   * @returns {string} prompt_id
   */
  async submitWorkflow(hostOrPort, workflowOrPort, workflow) {
    let host, port, wf;
    if (workflow !== undefined) {
      // 新调用: submitWorkflow(host, port, workflow)
      host = hostOrPort;
      port = workflowOrPort;
      wf = workflow;
    } else {
      // 旧调用: submitWorkflow(port, workflow)
      host = '127.0.0.1';
      port = hostOrPort;
      wf = workflowOrPort;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(`http://${host}:${port}/prompt`, {
          method: 'POST',
          signal: controller.signal,
          headers: { ...COMFYUI_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: wf })
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await response.json();
      if (!data.prompt_id) {
        throw new Error('Failed to submit workflow: no prompt_id returned');
      }
      return data.prompt_id;
    } catch (error) {
      throw new Error(`Failed to submit workflow: ${error.message}`);
    }
  }

  /**
   * 检查ComfyUI连接
   * @param {string} host - ComfyUI主机地址
   * @param {number} port - ComfyUI端口
   * @returns {Object} 连接状态
   */
  async checkConnection(host, port) {
    const p = Number(port);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`http://${host}:${p}/system_stats`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      const data = await response.json();
      return { connected: true, ...data };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 轮询ComfyUI结果
   * @param {string|number} hostOrPort - 主机或端口
   * @param {string|number} promptIdOrPort - promptId或端口
   * @param {string} [promptId] - prompt ID（当第一参数为host时使用）
   * @returns {Object} 生成结果
   */
  async pollResult(hostOrPort, promptIdOrPort, promptId) {
    let host, port, pid;
    if (promptId !== undefined) {
      host = hostOrPort;
      port = promptIdOrPort;
      pid = promptId;
    } else {
      host = '127.0.0.1';
      port = hostOrPort;
      pid = promptIdOrPort;
    }
    const maxAttempts = 300; // 最多等待5分钟 (300 * 1秒)
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        // 检查历史记录
        const historyResponse = await fetch(
          `http://${host}:${port}/history/${pid}`,
          { headers: COMFYUI_HEADERS, signal: AbortSignal.timeout(5000) }
        );
        const historyData = await historyResponse.json();
        const history = historyData[pid];

        if (history && history.status) {
          const status = history.status;

          // 检查是否完成
          if (status.completed) {
            return {
              promptId: pid,
              status: 'completed',
              outputs: history.outputs
            };
          }

          // 检查是否出错
          if (status.status_str === 'error') {
            throw new Error(`ComfyUI execution failed: ${JSON.stringify(status.messages)}`);
          }
        }

        // 等待1秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw new Error('Timeout waiting for ComfyUI result');
        }
        // 继续轮询
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error('Timeout waiting for ComfyUI result');
  }

  /**
   * 格式化为OpenAI响应
   * @param {Object} comfyuiResult - ComfyUI结果
   * @param {Object} originalParams - 原始请求参数
   * @returns {Object} OpenAI格式响应
   */
  formatOpenAIResponse(comfyuiResult, originalParams) {
    const images = [];

    // 从outputs中提取图片
    if (comfyuiResult.outputs) {
      for (const [nodeId, output] of Object.entries(comfyuiResult.outputs)) {
        if (output.images && Array.isArray(output.images)) {
          for (const image of output.images) {
            images.push({
              url: `/api/comfyui/outputs/${image.filename}`,
              filename: image.filename,
              subfolder: image.subfolder || '',
              type: image.type || 'output'
            });
          }
        }
      }
    }

    return {
      created: Math.floor(Date.now() / 1000),
      data: images.map(img => ({
        url: `http://localhost:3001${img.url}`
      }))
    };
  }

  /**
   * 获取生成进度
   * @param {string|number} hostOrPort - 主机或端口
   * @param {string|number} promptIdOrPort - promptId或端口
   * @param {string} [promptId] - prompt ID（当第一参数为host时使用）
   * @returns {Object} 进度信息
   */
  async getProgress(hostOrPort, promptIdOrPort, promptId) {
    let host, port, pid;
    if (promptId !== undefined) {
      host = hostOrPort;
      port = promptIdOrPort;
      pid = promptId;
    } else {
      host = '127.0.0.1';
      port = hostOrPort;
      pid = promptIdOrPort;
    }
    try {
      // ComfyUI的进度API
      const queueResponse = await fetch(
        `http://${host}:${port}/queue`,
        { headers: COMFYUI_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      const queue = await queueResponse.json();
      const runningTasks = queue.queue_running || [];
      const pendingTasks = queue.queue_pending || [];

      // 检查是否在运行中
      const runningTask = runningTasks.find(t => t[1] === pid);
      if (runningTask) {
        return {
          status: 'running',
          progress: 50 // ComfyUI不提供详细进度，返回估计值
        };
      }

      // 检查是否在等待中
      const pendingTask = pendingTasks.find(t => t[1] === pid);
      if (pendingTask) {
        return {
          status: 'pending',
          progress: 0
        };
      }

      // 检查历史记录看是否完成
      const historyResponse = await fetch(
        `http://${host}:${port}/history/${pid}`,
        { headers: COMFYUI_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      const historyData = await historyResponse.json();

      if (historyData[pid]) {
        return {
          status: 'completed',
          progress: 100
        };
      }

      return {
        status: 'unknown',
        progress: 0
      };
    } catch (error) {
      throw new Error(`Failed to get progress: ${error.message}`);
    }
  }
}

export default new OpenAIProxyService();
