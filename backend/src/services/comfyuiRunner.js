import path from 'path';
import fs from 'fs';
import yaml from 'yaml';
import { PROJECT_ROOT, DATA_DIR, MODELS_RUN_DIR } from '../config/constants.js';
import configManager from './configManager.js';
import engineManager from './engineManager.js';

/**
 * ComfyUI运行器
 * 负责生成ComfyUI启动命令和配置文件
 */
class ComfyUIRunner {
  /**
   * 生成ComfyUI启动命令
   * @param {Object} model - 模型配置
   * @param {number} port - 端口号
   * @returns {Object} 命令对象 { command, args }
   */
  generateCommand(model, port) {
    const comfyuiPath = engineManager.getEnginePath('comfyui');

    // ComfyUI配置
    const config = model.comfyui_config || {
      port: 8188,
      host: '0.0.0.0'
    };

    // 生成extra_model_paths配置文件
    const configPath = this.generateModelPathsConfig(model.id);

    // 构建启动参数
    const args = [
      path.join(comfyuiPath, 'main.py'),
      '--port', port.toString(),
      '--listen', config.host || '0.0.0.0'
    ];

    // 如果有自定义模型路径配置，添加参数
    if (configPath) {
      args.push('--extra-model-paths-config', configPath);
    }

    const venvPython = path.join(comfyuiPath, 'venv', 'Scripts', 'python.exe');

    return {
      command: venvPython,
      args,
      cwd: comfyuiPath
    };
  }

  /**
   * 生成extra_model_paths.yaml配置文件
   * @param {string} modelId - 模型ID
   * @returns {string} 配置文件路径
   */
  generateModelPathsConfig(modelId) {
    const configDir = path.join(DATA_DIR, 'comfyui_config');
    const configPath = path.join(configDir, `${modelId}.yaml`);

    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // ComfyUI模型目录
    const modelsDir = path.join(MODELS_RUN_DIR, 'comfyui', 'models');

    // 生成配置内容
    const config = {
      comfyui: {
        base_path: modelsDir,
        checkpoints: 'checkpoints',
        clip: 'clip',
        clip_vision: 'clip_vision',
        configs: 'configs',
        controlnet: 'controlnet',
        diffusers: 'diffusers',
        diffusion_models: 'diffusion_models',
        embeddings: 'embeddings',
        gligen: 'gligen',
        hypernetworks: 'hypernetworks',
        loras: 'loras',
        photomaker: 'photomaker',
        style_models: 'style_models',
        text_encoders: 'text_encoders',
        unet: 'unet',
        upscale_models: 'upscale_models',
        vae: 'vae',
        vae_approx: 'vae_approx'
      }
    };

    // 写入YAML文件
    const yamlContent = yaml.stringify(config);
    fs.writeFileSync(configPath, yamlContent, 'utf-8');

    console.log(`✓ 生成ComfyUI配置文件: ${configPath}`);

    return configPath;
  }

  /**
   * 清理配置文件
   * @param {string} modelId - 模型ID
   */
  cleanupConfig(modelId) {
    const configPath = path.join(DATA_DIR, 'comfyui_config', `${modelId}.yaml`);

    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      console.log(`✓ 清理ComfyUI配置文件: ${configPath}`);
    }
  }

  /**
   * 检查ComfyUI是否可用
   * @returns {boolean} ComfyUI是否存在
   */
  checkComfyUIAvailable() {
    const comfyuiPath = engineManager.getEnginePath('comfyui');
    if (!comfyuiPath) return false;
    return fs.existsSync(path.join(comfyuiPath, 'main.py'));
  }

  /**
   * 获取ComfyUI版本信息
   * @returns {Object|null} 版本信息
   */
  getComfyUIVersion() {
    // TODO: 从ComfyUI目录读取版本信息
    return {
      version: 'unknown',
      available: this.checkComfyUIAvailable()
    };
  }
}

export default new ComfyUIRunner();
