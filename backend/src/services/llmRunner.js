import path from 'path';
import fs from 'fs';
import { MODELS_RUN_DIR, PRESETS_DIR, DEFAULT_PORTS } from '../config/constants.js';
import presetService from './presetService.js';
import parameterService from './parameterService.js';

/**
 * 生成 llama-server 路由模式启动命令
 * 支持动态加载多个模型
 */
export function generateRouterCommand(type = 'llm', port = DEFAULT_PORTS.LLAMACPP_START) {
  // 确保预设文件存在
  if (!presetService.presetExists(type)) {
    throw new Error(`预设文件不存在: ${type}.ini`);
  }

  const modelsDir = path.join(MODELS_RUN_DIR, type);
  const presetPath = presetService.getPresetPath(type);

  const args = [
    '--models-dir', modelsDir,
    '--models-preset', presetPath,
    '--port', port.toString(),
    '--host', '0.0.0.0',
    '--timeout', '600',
  ];

  return {
    command: 'llama-server',
    args,
    mode: 'router',
    modelsDir,
    presetPath
  };
}

/**
 * 参数名映射：内部参数名 -> llama-server 命令行参数
 */
const PARAM_MAPPING = {
  context_length: '--ctx-size',
  gpu_layers: '--gpu-layers',
  threads: '--threads',
  parallel: '--parallel',
  batch: '-b',         // 修正：使用短参数
  ubatch: '-ub',       // 修正：使用短参数
  // 其他参数可以直接使用
};

/**
 * 生成单模型模式启动命令（向后兼容）
 * 已弃用，推荐使用路由模式
 */
export function generateSingleModelCommand(model, port) {
  if (!model.local_path) {
    throw new Error('模型文件路径不存在');
  }

  // 查找模型文件（优先使用用户选中的激活文件）
  const modelPath = _findModelFile(model.local_path, model);
  if (!modelPath) {
    throw new Error('找不到模型文件');
  }

  // 获取有效参数（合并用户参数和默认参数）
  const effectiveParams = parameterService.getEffectiveParameters(model);

  // 必需参数（始终包含）
  const args = [
    '-m', modelPath,
    '--port', port.toString(),
    '--host', '0.0.0.0',
  ];

  // 默认参数值（当用户未设置时使用）
  const defaults = {
    context_length: 8192,
    gpu_layers: -1,
    threads: 8,
    parallel: 2,
    batch: 512,
    ubatch: 512
  };

  // 动态添加参数
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = effectiveParams[key] ?? defaultValue;

    // 支持用 "-" 删除参数
    if (value === '-') {
      console.log(`  跳过参数: ${key} (值为 "-")`);
      continue;
    }

    // 获取命令行参数名
    const paramName = PARAM_MAPPING[key] || `--${key.replace(/_/g, '-')}`;

    // 布尔标志处理
    if (typeof value === 'boolean') {
      if (value === true) {
        args.push(paramName); // 只添加参数名，不添加值
      }
      // false 则跳过该参数
    } else {
      args.push(paramName, value.toString());
    }
  }

  // 添加其他自定义参数（不在默认列表中的）
  // 排除采样参数（这些应该在推理时传递，不在启动时设置）
  const samplingParams = ['temperature', 'top_p', 'top_k', 'repeat_penalty', 'min_p', 'typical_p', 'tfs_z', 'mirostat', 'mirostat_tau', 'mirostat_eta'];

  for (const [key, value] of Object.entries(effectiveParams)) {
    // 跳过内部字段、已处理的参数、采样参数
    if (key.startsWith('_') || key === 'version' || defaults.hasOwnProperty(key) || samplingParams.includes(key)) {
      continue;
    }

    // 支持用 "-" 删除参数
    if (value === '-') {
      console.log(`  跳过自定义参数: ${key} (值为 "-")`);
      continue;
    }

    // 获取命令行参数名
    const paramName = PARAM_MAPPING[key] || `--${key.replace(/_/g, '-')}`;

    // 布尔标志处理
    if (typeof value === 'boolean') {
      if (value === true) {
        args.push(paramName); // 只添加参数名，不添加值
        console.log(`  添加布尔标志: ${paramName}`);
      }
      // false 则跳过该参数
    } else {
      args.push(paramName, value.toString());
    }
  }

  // 多模态投影文件
  const mmprojPath = _findMmprojFile(model.local_path);
  if (mmprojPath) {
    args.push('--mmproj', mmprojPath);
  }

  return {
    command: 'llama-server',
    args,
    mode: 'single',
    modelPath
  };
}

/**
 * 查找模型主文件
 * 优先使用 downloaded_files 中 is_active 的文件
 */
function _findModelFile(localPath, model) {
  // 检查是否是单文件模型
  if (localPath.endsWith('.gguf') && fs.existsSync(localPath)) {
    return localPath;
  }

  // 检查是否是目录
  if (fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
    // 优先使用用户选中的激活文件
    if (model?.downloaded_files?.length > 0) {
      const activeFile = model.downloaded_files.find(f => f.is_active);
      if (activeFile) {
        const activePath = path.join(localPath, activeFile.filename);
        if (fs.existsSync(activePath)) {
          console.log(`使用激活文件: ${activeFile.filename}`);
          return activePath;
        }
      }
    }

    // 回退：使用目录中第一个 .gguf 文件
    const files = fs.readdirSync(localPath);
    const modelFile = files.find(f => f.endsWith('.gguf') && !f.startsWith('mmproj'));
    if (modelFile) {
      return path.join(localPath, modelFile);
    }
  }

  return null;
}

/**
 * 查找 mmproj 文件
 */
function _findMmprojFile(localPath) {
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
    return null;
  }

  const files = fs.readdirSync(localPath);
  const mmprojFile = files.find(f => f.startsWith('mmproj') && f.endsWith('.gguf'));

  return mmprojFile ? path.join(localPath, mmprojFile) : null;
}

/**
 * 验证 llama-server 是否可用
 */
export async function checkLlamaServerAvailable() {
  const { spawn } = await import('child_process');

  return new Promise((resolve) => {
    const proc = spawn('llama-server', ['--version']);

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));

    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 3000);
  });
}
