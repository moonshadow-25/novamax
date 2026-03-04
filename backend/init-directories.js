/**
 * 初始化 NovaMax 目录结构
 * 运行: node init-directories.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../');

const directories = [
  // 基础目录
  'data',
  'data/models',
  'data/downloads',
  'data/models_dir',
  'data/presets',

  // 元数据配置目录
  'data/models',

  // 下载临时目录（按类型）
  'data/downloads/llm',
  'data/downloads/comfyui',
  'data/downloads/tts',
  'data/downloads/whisper',

  // 运行时模型目录（按类型）
  'data/models_dir/llm',
  'data/models_dir/comfyui',
  'data/models_dir/tts',
  'data/models_dir/whisper',
];

const files = {
  // 模型元数据文件
  'data/models/llm.json': { models: [] },
  'data/models/comfyui.json': { models: [] },
  'data/models/tts.json': { models: [] },
  'data/models/whisper.json': { models: [] },
};

console.log('初始化 NovaMax 目录结构...\n');

// 创建目录
directories.forEach(dir => {
  const fullPath = path.join(PROJECT_ROOT, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✓ 创建目录: ${dir}`);
  } else {
    console.log(`○ 已存在: ${dir}`);
  }
});

console.log('');

// 创建初始化文件
Object.entries(files).forEach(([filePath, content]) => {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, JSON.stringify(content, null, 2));
    console.log(`✓ 创建文件: ${filePath}`);
  } else {
    console.log(`○ 已存在: ${filePath}`);
  }
});

console.log('\n目录结构初始化完成！');
console.log('\n目录结构：');
console.log('data/');
console.log('├─ models/          # 模型元数据配置（JSON）');
console.log('├─ downloads/       # 临时下载目录');
console.log('│  ├─ llm/');
console.log('│  ├─ tts/');
console.log('│  └─ whisper/');
console.log('├─ models_dir/      # 运行时模型目录（llama-server --models-dir）');
console.log('│  ├─ llm/');
console.log('│  ├─ tts/');
console.log('│  └─ whisper/');
console.log('└─ presets/         # INI 预设配置（llama-server --models-preset）');
