import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(PROJECT_ROOT, 'release');

// 打包选项
const SKIP_EXTERNAL = process.env.SKIP_EXTERNAL === 'true';

console.log('\n🚀 开始打包 NovaMax (便携版)...');
if (SKIP_EXTERNAL) {
  console.log('⚠️  精简模式：跳过 external 目录\n');
} else {
  console.log('📦 完整模式：包含所有外部工具\n');
}

// 1. 清理旧的发布目录
console.log('📁 清理发布目录...');
if (fs.existsSync(RELEASE_DIR)) {
  try {
    // 尝试直接删除
    fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EBUSY') {
      console.log('⚠️  无法删除 release 目录（可能被占用）');
      console.log('   尝试方案：先改名再删除...');
      
      // 尝试改名后删除
      const backupDir = path.join(PROJECT_ROOT, 'release.old.' + Date.now());
      try {
        fs.renameSync(RELEASE_DIR, backupDir);
        console.log(`   ✓ 已改名为: ${path.basename(backupDir)}`);
        console.log('   提示：可手动删除该目录');
      } catch (renameError) {
        console.error('\n❌ 无法清理 release 目录，请：');
        console.error('   1. 关闭所有在 release 目录中的终端窗口');
        console.error('   2. 确保没有程序正在运行 release 中的文件');
        console.error('   3. 手动删除 release 目录后重试\n');
        process.exit(1);
      }
    } else {
      throw error;
    }
  }
}
fs.mkdirSync(RELEASE_DIR, { recursive: true });

// 2. 构建前端
console.log('🔨 开始构建前端...');
const frontendDist = path.join(PROJECT_ROOT, 'frontend/dist');
try {
  execSync('npm run build', { 
    cwd: path.join(PROJECT_ROOT, 'frontend'),
    stdio: 'inherit' 
  });
  console.log('✅ 前端构建完成');
} catch (error) {
  console.error('❌ 前端构建失败');
  process.exit(1);
}

// 3. 复制后端代码和依赖
console.log('📋 复制后端代码...');
const backendDest = path.join(RELEASE_DIR, 'backend');
fs.mkdirSync(backendDest, { recursive: true });

// 复制源码
const backendSrc = path.join(PROJECT_ROOT, 'backend/src');
copyDirectory(backendSrc, path.join(backendDest, 'src'));

// 复制 package.json 和 package-lock.json
fs.copyFileSync(
  path.join(PROJECT_ROOT, 'backend/package.json'),
  path.join(backendDest, 'package.json')
);

if (fs.existsSync(path.join(PROJECT_ROOT, 'backend/package-lock.json'))) {
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'backend/package-lock.json'),
    path.join(backendDest, 'package-lock.json')
  );
}

// 复制 node_modules（生产依赖）
console.log('📦 复制依赖包 (这可能需要几分钟)...');
const nodeModulesSrc = path.join(PROJECT_ROOT, 'backend/node_modules');
const nodeModulesDest = path.join(backendDest, 'node_modules');
if (fs.existsSync(nodeModulesSrc)) {
  copyDirectory(nodeModulesSrc, nodeModulesDest, ['pkg', '.cache', '.bin']);
  console.log('✅ 后端代码已复制');
} else {
  console.log('⚠️  node_modules 不存在，跳过');
}

// 4. 复制前端构建产物
console.log('📋 复制前端文件...');
const frontendDest = path.join(RELEASE_DIR, 'frontend');
copyDirectory(frontendDist, path.join(frontendDest, 'dist'));
console.log('✅ 前端文件已复制');

// 5. 复制外部工具（Node.js, Python, llamacpp 等）
if (!SKIP_EXTERNAL) {
  console.log('📋 复制外部工具...');
  const externalSrc = path.join(PROJECT_ROOT, 'external');
  const externalDest = path.join(RELEASE_DIR, 'external');
  
  if (fs.existsSync(externalSrc)) {
    console.log('   复制 external 目录 (这可能需要几分钟)...');
    copyDirectory(externalSrc, externalDest);
    console.log('✅ 外部工具已复制 (Node.js, Python, llamacpp)');
  } else {
    console.log('⚠️  external 目录不存在，跳过');
  }
} else {
  console.log('⏭️  跳过外部工具（精简模式）');
  console.log('   请配置 backend/config/external-paths.json 使用外部工具');
}

// 6. 复制配置文件模板
console.log('📋 复制配置文件...');
const configSrc = path.join(PROJECT_ROOT, 'backend/config/external-paths.json');
const configDest = path.join(RELEASE_DIR, 'backend/config/external-paths.json');
if (fs.existsSync(configSrc)) {
  // 确保目标目录存在
  fs.mkdirSync(path.dirname(configDest), { recursive: true });
  fs.copyFileSync(configSrc, configDest);
  console.log('✅ 配置文件已复制');
}

// 7. 创建 data 目录（用户数据）
console.log('📋 创建数据目录...');
const dataDest = path.join(RELEASE_DIR, 'data');
fs.mkdirSync(dataDest, { recursive: true });

// 复制默认数据（如果存在）
const dataSrc = path.join(PROJECT_ROOT, 'data');
if (fs.existsSync(dataSrc)) {
  const defaultFiles = ['models.json', 'config.json', 'presets.json', 'parameters.json'];
  defaultFiles.forEach(file => {
    const srcFile = path.join(dataSrc, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(dataDest, file));
    } else {
      // 创建空的 JSON 文件
      fs.writeFileSync(path.join(dataDest, file), '[]');
    }
  });
}
console.log('✅ 数据目录已创建');

// 8. 创建启动脚本
console.log('📄 创建启动脚本...');

// Windows 批处理启动脚本（使用英文避免编码问题）
const startBat = `@echo off
title NovaMax
cls

echo ========================================
echo    NovaMax - AI Model Platform
echo ========================================
echo.
echo Starting service...
echo.

cd /d "%~dp0"
set NODE_ENV=production

external\\node\\node.exe backend\\src\\index.js

if errorlevel 1 (
    echo.
    echo ========================================
    echo Service failed - Check error messages
    echo ========================================
    pause
) else (
    echo.
    echo Service stopped
    pause
)
`;
fs.writeFileSync(path.join(RELEASE_DIR, 'NovaMax.bat'), startBat, 'utf8');

// 创建隐藏窗口启动脚本（通过 VBS）
const startVbs = `Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
WshShell.Run "NovaMax.bat", 0, False
Set WshShell = Nothing
Set fso = Nothing
`;
fs.writeFileSync(path.join(RELEASE_DIR, 'NovaMax-Silent.vbs'), startVbs);

// 创建停止服务脚本
const stopBat = `@echo off
title Stop NovaMax
cls

echo ========================================
echo    Stop NovaMax Service
echo ========================================
echo.

taskkill /FI "WINDOWTITLE eq NovaMax*" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /FI "MEMUSAGE gt 50000" /F >nul 2>&1

echo Service stopped
echo.
pause
`;
fs.writeFileSync(path.join(RELEASE_DIR, 'Stop-NovaMax.bat'), stopBat, 'utf8');

console.log('✅ 启动脚本已创建');

// 9. 创建用户文档
console.log('📄 创建用户文档...');

const readme = `# NovaMax - AI 模型运行平台

## 🚀 快速开始

### 方法 1：显示窗口启动（推荐）
双击 **NovaMax.bat** 启动程序，会显示控制台窗口。

### 方法 2：后台静默启动
双击 **NovaMax-Silent.vbs** 后台启动，不显示窗口。

### 访问界面
启动后，浏览器会自动打开。如果没有，请手动访问：
**http://localhost:3001**

### 停止服务
- 方法1启动：在控制台窗口按 Ctrl+C 或关闭窗口
- 方法2启动：打开任务管理器，结束 node.exe 进程

## 📁 目录结构

- \`NovaMax.bat\` - 显示窗口启动脚本
- \`NovaMax-Silent.vbs\` - 后台静默启动脚本
- \`backend/\` - 后端服务代码
- \`frontend/\` - 前端界面文件
- \`external/\` - 外部工具 (Node.js, Python, llamacpp)
- \`data/\` - 用户数据和配置

## ⚙️ 配置说明

所有配置文件存储在 \`data/\` 目录：
- \`models.json\` - 模型列表
- \`config.json\` - 系统配置
- \`presets.json\` - 预设参数
- \`parameters.json\` - 运行参数

## 🔧 常见问题

### 端口被占用
如果提示端口 3001 被占用，编辑 \`backend/src/index.js\`，修改 PORT 变量。

### 找不到 Python
确保 \`external/python313/python.exe\` 文件存在。

### 无法访问界面
检查防火墙是否拦截，或尝试访问 http://127.0.0.1:3001

## 📦 更新说明

更新时，只需备份 \`data/\` 目录，然后用新版本替换其他文件即可。

## 🗑️ 卸载

直接删除整个文件夹，无需卸载程序。
用户数据全部在本地，不会残留系统文件。

## 📊 系统要求

- Windows 10/11 (64位)
- 至少 4GB 内存
- 建议 SSD 硬盘

## 📚 技术信息

- 构建日期: ${new Date().toISOString().split('T')[0]}
- 架构: 便携版 (无需安装)

## 🆘 获取帮助

如遇问题，请查看控制台输出的错误信息。
也可以访问项目主页获取帮助。

---

感谢使用 NovaMax！
`;
fs.writeFileSync(path.join(RELEASE_DIR, 'README.txt'), readme);
console.log('✅ 用户文档已创建');

// 10. 显示打包结果
console.log('\n' + '='.repeat(60));
console.log('🎉 打包完成！');
console.log('='.repeat(60));
console.log(`📦 发布目录: ${RELEASE_DIR}`);
console.log(`📊 包含内容:`);

const stats = getDirectoryStats(RELEASE_DIR);
stats.forEach(stat => {
  console.log(`   ${stat.name.padEnd(25)} ${formatSize(stat.size)}`);
});

const totalSize = stats.reduce((sum, s) => sum + s.size, 0);
console.log(`   ${'总大小'.padEnd(25)} ${formatSize(totalSize)}`);
console.log(`\n💡 打包模式：${SKIP_EXTERNAL ? '精简版（~20MB）' : '完整版（~340MB）'}`);

if (SKIP_EXTERNAL) {
  console.log('\n⚠️  后续步骤：');
  console.log('   1. 编辑 release/backend/config/external-paths.json');
  console.log('   2. 设置 python.enabled=true 并指定路径');
  console.log('   3. 设置 llamacpp.enabled=true 并指定路径');
  console.log('   详见 docs/EXTERNAL_TOOLS_CONFIG.md');
}

console.log('\n✅ 测试运行: cd release && NovaMax.bat');
console.log('');

// 11. 压缩打包
console.log('\n📦 正在压缩打包...');
const archiveName = 'novamax.7z';
const archivePath = path.join(PROJECT_ROOT, archiveName);

// 删除旧的压缩包
if (fs.existsSync(archivePath)) {
  fs.unlinkSync(archivePath);
  console.log('   删除旧压缩包');
}

// 7-Zip 路径
const sevenZipPath = 'C:\\Program Files\\7-Zip\\7z.exe';

if (fs.existsSync(sevenZipPath)) {
  try {
    console.log('   使用 7-Zip 压缩中... (这可能需要几分钟)');
    
    // 使用 7z 最大压缩 (-mx9)，LZMA2 算法
    execSync(`"${sevenZipPath}" a -t7z -mx=9 -m0=lzma2 "${archivePath}" "${RELEASE_DIR}\\*"`, {
      stdio: 'pipe',
      cwd: PROJECT_ROOT
    });
    
    const archiveSize = fs.statSync(archivePath).size;
    console.log(`✅ 压缩完成: ${archiveName} (${formatSize(archiveSize)})`);
    console.log(`   位置: ${archivePath}`);
    
    const compressionRatio = ((1 - archiveSize / totalSize) * 100).toFixed(1);
    console.log(`   压缩率: ${compressionRatio}%`);
  } catch (error) {
    console.error('⚠️  压缩失败:', error.message);
    console.log('   打包文件仍在 release 目录中可用');
  }
} else {
  console.log('⚠️  未找到 7-Zip，跳过压缩');
  console.log('   提示: 安装 7-Zip 后可自动压缩打包');
  console.log('   下载: https://www.7-zip.org/');
}

// ============= 工具函数 =============

function copyDirectory(src, dest, excludeDirs = []) {
  if (!fs.existsSync(src)) return;
  
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // 跳过排除的目录
    if (entry.isDirectory() && excludeDirs.includes(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, excludeDirs);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getDirectoryStats(dir) {
  const stats = [];
  
  if (!fs.existsSync(dir)) return stats;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      const size = getDirectorySize(fullPath);
      stats.push({ name: entry.name + '/', size });
    } else {
      const size = fs.statSync(fullPath).size;
      stats.push({ name: entry.name, size });
    }
  }

  return stats;
}

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
