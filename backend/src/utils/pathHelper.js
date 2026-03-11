import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ============ 外部配置管理 ============

let externalConfig = null;

/**
 * 加载外部工具路径配置
 */
function loadExternalConfig() {
  if (externalConfig !== null) {
    return externalConfig;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const configPath = path.join(__dirname, '..', 'config', 'external-paths.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      externalConfig = JSON.parse(content);
      console.log('✓ 已加载外部工具配置');
    } else {
      // 如果配置文件不存在，使用默认配置
      externalConfig = {
        node: '',
        python: '',
        llamacpp: ''
      };
    }
  } catch (error) {
    console.error('⚠ 加载外部工具配置失败，使用默认配置:', error.message);
    externalConfig = {
      node: '',
      python: '',
      llamacpp: ''
    };
  }

  return externalConfig;
}

/**
 * 重新加载配置（用于配置更新后）
 */
export function reloadExternalConfig() {
  externalConfig = null;
  return loadExternalConfig();
}

// ============ 路径获取函数 ============

/**
 * 获取项目根目录
 * - 开发环境: 项目根目录 (novamax_dev/)
 * - 便携版: release 目录
 */
export function getProjectRoot() {
  // 检测便携版环境：backend/src/utils -> backend -> release
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  // 向上查找，检查是否为便携版结构
  const backendDir = path.resolve(__dirname, '../..');
  const possibleReleaseDir = path.resolve(backendDir, '..');
  
  // 如果 ../frontend/dist 存在，说明是便携版
  if (fs.existsSync(path.join(possibleReleaseDir, 'frontend/dist'))) {
    return possibleReleaseDir;
  }
  
  // 否则是开发环境，继续向上一层到项目根目录
  return path.resolve(backendDir, '..');
}

/**
 * 获取资源文件路径
 * - 开发环境: 相对于项目根目录
 * - 便携版: 相对于 release 目录
 */
export function getResourcePath(...parts) {
  const root = getProjectRoot();
  return path.join(root, ...parts);
}

/**
 * 获取 Node.js 可执行文件路径
 * 支持外部配置，优先使用外部路径
 */
export function getNodePath() {
  const bundledPath = getResourcePath('external', 'node', 'node.exe');
  const config = loadExternalConfig();
  
  if (config.node && typeof config.node === 'string') {
    const configPath = path.isAbsolute(config.node) 
      ? config.node 
      : path.resolve(process.cwd(), config.node);
    
    if (fs.existsSync(configPath)) {
      console.log(`  → 使用 Node.js: ${configPath}`);
      return configPath;
    } else {
      console.warn(`  ⚠ 配置的 Node.js 不存在: ${configPath}, 使用默认路径`);
    }
  }
  
  return bundledPath;
}

/**
 * 获取 Python 可执行文件路径
 * 支持外部配置，优先使用外部路径
 */
export function getPythonPath() {
  const bundledPath = getResourcePath('external', 'python313', 'python.exe');
  const config = loadExternalConfig();
  
  if (config.python && typeof config.python === 'string') {
    const configPath = path.isAbsolute(config.python) 
      ? config.python 
      : path.resolve(process.cwd(), config.python);
    
    if (fs.existsSync(configPath)) {
      console.log(`  → 使用 Python: ${configPath}`);
      return configPath;
    } else {
      console.warn(`  ⚠ 配置的 Python 不存在: ${configPath}, 使用默认路径`);
    }
  }
  
  return bundledPath;
}

/**
 * 获取 llama.cpp 目录路径
 * 支持外部配置，优先使用外部路径
 */
export function getLlamaCppPath() {
  const bundledPath = getResourcePath('external', 'llamacpp');
  const config = loadExternalConfig();
  
  if (config.llamacpp && typeof config.llamacpp === 'string') {
    const configPath = path.isAbsolute(config.llamacpp)
      ? config.llamacpp
      : path.resolve(process.cwd(), config.llamacpp);
    
    if (fs.existsSync(configPath)) {
      console.log(`  → 使用 llama.cpp: ${configPath}`);
      return configPath;
    } else {
      console.warn(`  ⚠ 配置的 llama.cpp 不存在: ${configPath}, 使用默认路径`);
    }
  }
  
  return bundledPath;
}

/**
 * 获取 Python 脚本路径
 * - 所有环境: backend/src/services/ 目录下的脚本
 */
export function getPythonScriptPath(scriptName) {
  const __filename = fileURLToPath(import.meta.url);
  return path.join(path.dirname(__filename), '..', 'services', scriptName);
}

/**
 * 获取前端静态文件目录
 */
export function getFrontendDistPath() {
  return getResourcePath('frontend', 'dist');
}

/**
 * 获取数据目录路径
 */
export function getDataPath(...parts) {
  return getResourcePath('data', ...parts);
}

export default {
  getProjectRoot,
  getResourcePath,
  getNodePath,
  getPythonPath,
  getLlamaCppPath,
  getPythonScriptPath,
  getFrontendDistPath,
  getDataPath,
  reloadExternalConfig
};
