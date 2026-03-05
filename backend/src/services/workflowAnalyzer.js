import axios from 'axios';

/**
 * ComfyUI工作流分析器
 * 负责分析工作流JSON,提取节点信息、所需模型、参数映射等
 */
class WorkflowAnalyzer {
  /**
   * 分析工作流的主入口
   * @param {Object} workflowJson - ComfyUI工作流JSON对象
   * @param {string} name - 工作流名称
   * @returns {Object} 分析结果
   */
  async analyzeWorkflow(workflowJson, name = 'Untitled Workflow') {
    try {
      console.log('开始分析工作流:', name);

      // 1. 提取节点信息
      const nodes = this.extractNodes(workflowJson);
      console.log(`提取到 ${nodes.length} 个节点`);

      // 2. 提取所需模型
      const requiredModels = this.extractRequiredModels(nodes);
      console.log(`找到 ${requiredModels.length} 个所需模型`);

      // 3. 检测工作流类型
      const workflowType = this.detectWorkflowType(nodes);
      console.log('工作流类型:', workflowType);

      // 4. 生成参数映射
      const parameterMapping = this.generateParameterMapping(nodes, workflowJson);
      console.log('参数映射生成完成');

      // 5. 使用LLM分析工作流
      const llmAnalysis = await this.llmAnalyze(workflowJson, workflowType);
      console.log('LLM分析完成');

      // 6. 生成默认参数
      const defaultParameters = this.generateDefaultParameters(parameterMapping);

      return {
        workflow: {
          original: workflowJson,
          type: workflowType,
          analyzed_at: new Date().toISOString(),
          llm_analysis: llmAnalysis
        },
        required_models: requiredModels,
        parameter_mapping: parameterMapping,
        default_parameters: defaultParameters,
        node_count: nodes.length
      };
    } catch (error) {
      console.error('工作流分析失败:', error);
      throw new Error(`工作流分析失败: ${error.message}`);
    }
  }

  /**
   * 提取工作流中的所有节点
   * @param {Object} workflowJson - 工作流JSON
   * @returns {Array} 节点数组
   */
  extractNodes(workflowJson) {
    const nodes = [];

    // ComfyUI工作流的节点存储在顶层对象的键中
    for (const [nodeId, nodeData] of Object.entries(workflowJson)) {
      if (typeof nodeData === 'object' && nodeData.class_type) {
        nodes.push({
          id: nodeId,
          class_type: nodeData.class_type,
          inputs: nodeData.inputs || {},
          _meta: nodeData._meta || {}
        });
      }
    }

    return nodes;
  }

  /**
   * 从节点中提取所需模型
   * @param {Array} nodes - 节点数组
   * @returns {Array} 所需模型列表
   */
  extractRequiredModels(nodes) {
    const models = [];

    // Loader节点 → { type: ComfyUI目录名, field: 输入字段名 }
    const loaderMapping = {
      'CLIPLoader':               { type: 'text_encoders',         field: 'clip_name' },
      'DualCLIPLoader':           { type: 'text_encoders',         field: 'clip_name1' },
      'TripleCLIPLoader':         { type: 'text_encoders',         field: 'clip_name1' },
      'VAELoader':                { type: 'vae',                   field: 'vae_name' },
      'UNETLoader':               { type: 'diffusion_models',      field: 'unet_name' },
      'CheckpointLoaderSimple':   { type: 'checkpoints',           field: 'ckpt_name' },
      'CheckpointLoader':         { type: 'checkpoints',           field: 'ckpt_name' },
      'LoraLoader':               { type: 'loras',                 field: 'lora_name' },
      'LoraLoaderModelOnly':      { type: 'loras',                 field: 'lora_name' },
      'ControlNetLoader':         { type: 'controlnet',            field: 'control_net_name' },
      'UpscaleModelLoader':       { type: 'upscale_models',        field: 'model_name' },
      'LatentUpscaleModelLoader': { type: 'latent_upscale_models', field: 'model_name' },
      'LTXVGemmaCLIPModelLoader': { type: 'text_encoders',         field: 'model_name' },
      'LTXVAudioVAELoader':       { type: 'checkpoints',           field: 'ckpt_name' },
    };

    const pushModel = (type, filename, node_id, field) => {
      if (filename && typeof filename === 'string') {
        models.push({ type, filename, node_id, field, downloaded: false, local_path: null });
      }
    };

    for (const node of nodes) {
      const loaderInfo = loaderMapping[node.class_type];
      if (loaderInfo) {
        pushModel(loaderInfo.type, node.inputs[loaderInfo.field], node.id, loaderInfo.field);

        // DualCLIPLoader 第二个 CLIP
        if (node.class_type === 'DualCLIPLoader') {
          pushModel('text_encoders', node.inputs.clip_name2, node.id, 'clip_name2');
        }
        // TripleCLIPLoader 第二、三个 CLIP
        if (node.class_type === 'TripleCLIPLoader') {
          pushModel('text_encoders', node.inputs.clip_name2, node.id, 'clip_name2');
          pushModel('text_encoders', node.inputs.clip_name3, node.id, 'clip_name3');
        }
        // LTXAVTextEncoderLoader：text_encoder → text_encoders，ckpt_name → checkpoints
        if (node.class_type === 'LTXAVTextEncoderLoader') {
          pushModel('text_encoders', node.inputs.text_encoder, node.id, 'text_encoder');
          pushModel('checkpoints',   node.inputs.ckpt_name,    node.id, 'ckpt_name');
        }
      }
    }

    return models;
  }

  /**
   * 检测工作流类型
   * @param {Array} nodes - 节点数组
   * @returns {string} 工作流类型
   */
  detectWorkflowType(nodes) {
    let hasImageInput = false;
    let hasVideoOutput = false;

    for (const node of nodes) {
      // 检查是否有图像输入节点
      if (node.class_type === 'LoadImage' || node.class_type === 'LoadImageMask') {
        hasImageInput = true;
      }

      // 检查是否有视频输出节点
      if (node.class_type === 'SaveVideo' ||
          node.class_type === 'VHS_VideoCombine' ||
          node.class_type.includes('Video')) {
        hasVideoOutput = true;
      }
    }

    // 判断类型
    if (hasVideoOutput) {
      return hasImageInput ? 'img2video' : 'text2video';
    } else {
      return hasImageInput ? 'img2img' : 'text2img';
    }
  }

  /**
   * 生成参数映射
   * @param {Array} nodes - 节点数组
   * @returns {Object} 参数映射对象
   */
  generateParameterMapping(nodes, workflowJson = {}) {
    const mapping = {
      inputs: {},
      outputs: {}
    };

    let promptNode = null;
    let negativePromptNode = null;
    let samplerNode = null;
    let emptyLatentNode = null;
    let seedNode = null;
    let saveNode = null;
    let videoFrameNode = null;   // PrimitiveInt for frame_rate/length
    let videoLengthNode = null;  // EmptyLTXVLatentVideo

    for (const node of nodes) {
      // 提示词节点
      if (node.class_type === 'CLIPTextEncode') {
        // inputs.text 是字符串才是直接输入，是数组说明来自其他节点
        if (!promptNode && typeof node.inputs.text === 'string') promptNode = node;
        else if (!negativePromptNode && typeof node.inputs.text === 'string') negativePromptNode = node;
      }
      // PrimitiveStringMultiline 作为 prompt 输入
      if (node.class_type === 'PrimitiveStringMultiline' && !promptNode) {
        promptNode = { ...node, inputs: { text: node.inputs.value ?? '' } };
      }

      // 采样器节点（优先 KSampler）
      if (!samplerNode && (
        node.class_type === 'KSampler' ||
        node.class_type === 'KSamplerAdvanced' ||
        node.class_type === 'SamplerCustom' ||
        node.class_type === 'SamplerCustomAdvanced'
      )) samplerNode = node;

      // 视频采样步数（Flux2Scheduler / LTXVScheduler）
      if (!samplerNode && (
        node.class_type === 'Flux2Scheduler' ||
        node.class_type === 'LTXVScheduler'
      )) samplerNode = node;

      // 空白潜在节点
      if (!emptyLatentNode && (
        node.class_type === 'EmptyLatentImage' ||
        node.class_type === 'EmptySD3LatentImage' ||
        node.class_type === 'EmptyFlux2LatentImage'
      )) emptyLatentNode = node;

      // 视频潜在节点
      if (node.class_type === 'EmptyLTXVLatentVideo') videoLengthNode = node;

      // 随机噪声节点（有 noise_seed 字段）
      if (!seedNode && node.class_type === 'RandomNoise') seedNode = node;

      // 保存节点
      if (!saveNode && (
        node.class_type === 'SaveImage' ||
        node.class_type === 'PreviewImage' ||
        node.class_type === 'SaveVideo'
      )) saveNode = node;
    }

    // 辅助函数：仅取标量值（数组表示节点连接，不作为默认值）
    const scalarVal = (v) => (v !== undefined && !Array.isArray(v) ? v : undefined);

    // 辅助函数：解析节点引用，追踪 PrimitiveInt/PrimitiveFloat 一层
    // 返回 { value, node_id, field }，若不是 Primitive 引用则 node_id/field 为 null
    const resolveRef = (v) => {
      if (!Array.isArray(v)) return { value: v, node_id: null, field: null };
      const refNode = workflowJson[v[0]];
      if (refNode?.class_type === 'PrimitiveInt' || refNode?.class_type === 'PrimitiveFloat') {
        return { value: refNode.inputs.value, node_id: v[0], field: 'value' };
      }
      return { value: undefined, node_id: null, field: null };
    };

    // prompt
    if (promptNode) {
      mapping.inputs.prompt = { node_id: promptNode.id, field: 'text', type: 'string', description: '正面提示词',
        default_value: scalarVal(promptNode.inputs.text) ?? '' };
    }
    if (negativePromptNode) {
      mapping.inputs.negative_prompt = { node_id: negativePromptNode.id, field: 'text', type: 'string', description: '负面提示词',
        default_value: scalarVal(negativePromptNode.inputs.text) ?? '' };
    }

    // 采样器参数
    if (samplerNode) {
      if (samplerNode.inputs.steps !== undefined) {
        mapping.inputs.steps = { node_id: samplerNode.id, field: 'steps', type: 'number', description: '采样步数',
          default_value: scalarVal(samplerNode.inputs.steps) };
      }
      if (samplerNode.inputs.cfg !== undefined) {
        mapping.inputs.cfg_scale = { node_id: samplerNode.id, field: 'cfg', type: 'number', description: 'CFG引导强度',
          default_value: scalarVal(samplerNode.inputs.cfg) };
      }
      if (samplerNode.inputs.seed !== undefined) {
        mapping.inputs.seed = { node_id: samplerNode.id, field: 'seed', type: 'number', description: '随机种子(-1为随机)',
          default_value: -1 };
      }
      if (samplerNode.inputs.sampler_name !== undefined) {
        mapping.inputs.sampler = { node_id: samplerNode.id, field: 'sampler_name', type: 'string', description: '采样器名称',
          default_value: scalarVal(samplerNode.inputs.sampler_name) };
      }
      if (samplerNode.inputs.scheduler !== undefined) {
        mapping.inputs.scheduler = { node_id: samplerNode.id, field: 'scheduler', type: 'string', description: '调度器',
          default_value: scalarVal(samplerNode.inputs.scheduler) };
      }
    }
    // RandomNoise seed
    if (!mapping.inputs.seed && seedNode) {
      mapping.inputs.seed = { node_id: seedNode.id, field: 'noise_seed', type: 'number', description: '随机种子(-1为随机)',
        default_value: -1 };
    }

    // 图像尺寸（静态潜在节点）
    if (emptyLatentNode) {
      if (emptyLatentNode.inputs.width !== undefined) {
        mapping.inputs.width = { node_id: emptyLatentNode.id, field: 'width', type: 'number', description: '图像宽度',
          default_value: scalarVal(emptyLatentNode.inputs.width) };
      }
      if (emptyLatentNode.inputs.height !== undefined) {
        mapping.inputs.height = { node_id: emptyLatentNode.id, field: 'height', type: 'number', description: '图像高度',
          default_value: scalarVal(emptyLatentNode.inputs.height) };
      }
      if (emptyLatentNode.inputs.batch_size !== undefined) {
        mapping.inputs.batch_size = { node_id: emptyLatentNode.id, field: 'batch_size', type: 'number', description: '批次大小',
          default_value: scalarVal(emptyLatentNode.inputs.batch_size) };
      }
    }

    // 视频专用参数
    if (videoLengthNode) {
      if (videoLengthNode.inputs.width !== undefined) {
        mapping.inputs.width = { node_id: videoLengthNode.id, field: 'width', type: 'number', description: '视频宽度',
          default_value: scalarVal(videoLengthNode.inputs.width) };
      }
      if (videoLengthNode.inputs.height !== undefined) {
        mapping.inputs.height = { node_id: videoLengthNode.id, field: 'height', type: 'number', description: '视频高度',
          default_value: scalarVal(videoLengthNode.inputs.height) };
      }
      if (videoLengthNode.inputs.length !== undefined) {
        const lengthRef = resolveRef(videoLengthNode.inputs.length);
        mapping.inputs.length = {
          node_id: lengthRef.node_id || videoLengthNode.id,
          field: lengthRef.node_id ? 'value' : 'length',
          type: 'number',
          description: '视频帧数',
          default_value: lengthRef.value ?? scalarVal(videoLengthNode.inputs.length)
        };
      }
      if (videoLengthNode.inputs.batch_size !== undefined) {
        mapping.inputs.batch_size = { node_id: videoLengthNode.id, field: 'batch_size', type: 'number', description: '批次大小',
          default_value: scalarVal(videoLengthNode.inputs.batch_size) };
      }
    }

    // 输出节点
    if (saveNode) {
      mapping.outputs.save_node_id = saveNode.id;
      mapping.outputs.filename_prefix = saveNode.inputs.filename_prefix || 'ComfyUI';
    }

    // 图像输入参数（img2img / img2video 工作流）—— 支持多个 LoadImage 节点
    const imageNodes = nodes.filter(n => n.class_type === 'LoadImage' || n.class_type === 'LoadImageMask');
    imageNodes.forEach((node, i) => {
      const isMask = node.class_type === 'LoadImageMask';
      const key = i === 0 ? 'image' : (isMask ? 'image_mask' : `image_${i + 1}`);
      const desc = i === 0 ? '输入图像' : (isMask ? '遮罩图像' : `输入图像 ${i + 1}`);
      mapping.inputs[key] = { node_id: node.id, field: 'image', type: 'image', description: desc };
    });

    return mapping;
  }

  /**
   * 生成默认参数
   * @param {Object} parameterMapping - 参数映射
   * @returns {Object} 默认参数
   */
  generateDefaultParameters(parameterMapping) {
    const defaults = {};
    for (const [key, paramDef] of Object.entries(parameterMapping.inputs)) {
      if (paramDef.type === 'image') continue;
      if (paramDef.default_value !== undefined) {
        defaults[key] = paramDef.default_value;
      }
    }
    return defaults;
  }

  /**
   * 使用LLM分析工作流
   * @param {Object} workflowJson - 工作流JSON
   * @param {string} preliminaryType - 初步判断的类型
   * @returns {string} LLM分析结果
   */
  async llmAnalyze(workflowJson, preliminaryType) {
    try {
      // 构建提示词
      const prompt = `你是ComfyUI工作流分析专家。请分析以下工作流并提供简洁的功能描述。

工作流类型初步判断: ${preliminaryType}

工作流节点信息:
${this.summarizeWorkflow(workflowJson)}

请用1-2句话描述这个工作流的主要功能和特点。`;

      // TODO: 调用LLM API
      // 这里需要根据实际情况调用LLM服务
      // const response = await this.callLLM(prompt);

      // 暂时返回基于规则的描述
      const typeDescriptions = {
        'text2img': '这是一个文生图工作流，可以根据文本提示词生成图像。',
        'img2img': '这是一个图生图工作流，可以基于输入图像进行修改和转换。',
        'text2video': '这是一个文生视频工作流，可以根据文本提示词生成视频。',
        'img2video': '这是一个图生视频工作流，可以基于输入图像生成动态视频。'
      };

      return typeDescriptions[preliminaryType] || '这是一个ComfyUI工作流。';
    } catch (error) {
      console.error('LLM分析失败:', error);
      return '工作流分析失败';
    }
  }

  /**
   * 总结工作流信息（用于LLM分析）
   * @param {Object} workflowJson - 工作流JSON
   * @returns {string} 工作流摘要
   */
  summarizeWorkflow(workflowJson) {
    const nodes = this.extractNodes(workflowJson);
    const nodeTypes = {};

    for (const node of nodes) {
      nodeTypes[node.class_type] = (nodeTypes[node.class_type] || 0) + 1;
    }

    const summary = Object.entries(nodeTypes)
      .map(([type, count]) => `- ${type}: ${count}个`)
      .join('\n');

    return summary;
  }

  /**
   * 调用LLM API（待实现）
   * @param {string} prompt - 提示词
   * @returns {string} LLM响应
   */
  async callLLM(prompt) {
    // TODO: 实现LLM API调用
    // 可以使用本地运行的LLM或外部API
    throw new Error('LLM API未配置');
  }
}

export default new WorkflowAnalyzer();
