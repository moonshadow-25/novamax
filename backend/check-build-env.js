import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');

console.log('🔍 检查打包环境...\n');

let hasError = false;

// 1. 检查前端构建
const frontendDist = path.join(PROJECT_ROOT, 'frontend/dist');
if (!fs.existsSync(frontendDist)) {
  console.log('❌ 前端未构建: frontend/dist 不存在');
  console.log('   请运行: cd frontend && npm run build\n');
  hasError = true;
} else {
  const indexHtml = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    console.log('✅ 前端已构建');
  } else {
    console.log('⚠️  frontend/dist 存在但缺少 index.html');
    hasError = true;
  }
}

// 2. 检查 Python 环境
const pythonExe = path.join(PROJECT_ROOT, 'external/python313/python.exe');
if (!fs.existsSync(pythonExe)) {
  console.log('❌ Python 环境不存在: external/python313/python.exe');
  hasError = true;
} else {
  console.log('✅ Python 环境存在');
}

// 3. 检查 Python 脚本
const pythonScripts = [
  'backend/src/services/modelscope_downloader.py',
  'backend/src/services/hf_downloader.py'
];

let scriptsOk = true;
pythonScripts.forEach(script => {
  const scriptPath = path.join(PROJECT_ROOT, script);
  if (!fs.existsSync(scriptPath)) {
    console.log(`❌ Python 脚本不存在: ${script}`);
    scriptsOk = false;
    hasError = true;
  }
});

if (scriptsOk) {
  console.log('✅ Python 脚本完整');
}

// 4. 检查 node_modules
const backendNodeModules = path.join(PROJECT_ROOT, 'backend/node_modules');
if (!fs.existsSync(backendNodeModules)) {
  console.log('❌ 后端依赖未安装: backend/node_modules');
  console.log('   请运行: cd backend && npm install\n');
  hasError = true;
} else {
  console.log('✅ 后端依赖已安装');
}

// 5. 检查关键目录
const externalDir = path.join(PROJECT_ROOT, 'external');
if (!fs.existsSync(externalDir)) {
  console.log('❌ external 目录不存在');
  hasError = true;
} else {
  console.log('✅ external 目录存在');
  
  // 检查 Node.js
  const nodeExe = path.join(externalDir, 'node/node.exe');
  if (fs.existsSync(nodeExe)) {
    console.log('✅ Node.js 运行时存在 (external/node/)');
  } else {
    console.log('⚠️  Node.js 不存在，打包时会自动复制');
  }
}

// 6. 检查打包脚本
const buildScript = path.join(PROJECT_ROOT, 'backend/build-portable.js');
if (!fs.existsSync(buildScript)) {
  console.log('❌ 打包脚本不存在: backend/build-portable.js');
  hasError = true;
} else {
  console.log('✅ 打包脚本存在 (便携版)');
}

// 7. 估算打包后大小
console.log('\n📊 估算打包大小:');

function getDirectorySize(dir) {
  let size = 0;
  if (!fs.existsSync(dir)) return size;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirectorySize(fullPath);
    } else {
      try {
        size += fs.statSync(fullPath).size;
      } catch (e) {
        // 跳过无法访问的文件
      }
    }
  }
  return size;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const backendSrcSize = getDirectorySize(path.join(PROJECT_ROOT, 'backend/src'));
const backendNodeModulesSize = getDirectorySize(backendNodeModules);

const sizes = {
  'frontend/dist': getDirectorySize(frontendDist),
  'external': getDirectorySize(externalDir),
  'backend/src': backendSrcSize,
  'backend/node_modules': backendNodeModulesSize
};

let totalSize = 0;
Object.entries(sizes).forEach(([name, size]) => {
  console.log(`   ${name.padEnd(20)} ${formatSize(size)}`);
  totalSize += size;
});

console.log(`   ${'总计 (估算)'.padEnd(20)} ${formatSize(totalSize)}\n`);

// 总结
console.log('='.repeat(60));
if (hasError) {
  console.log('❌ 环境检查失败，请先解决上述问题再打包');
  process.exit(1);
} else {
  console.log('✅ 环境检查通过，可以开始打包');
  console.log('\n运行以下命令开始打包:');
  console.log('   cd backend && npm run build');
}
console.log('='.repeat(60));
