import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { build as esbuildBuild } from 'esbuild';
import { builtinModules } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(PROJECT_ROOT, 'release');

// ── 解析 --variant 参数 ──────────────────────────────────────
// stable（默认）= 正式版，发布 ModelScope
// beta           = 测试版，上传服务器
const variantArg = process.argv.find(a => a.startsWith('--variant='));
const VARIANT = variantArg ? variantArg.split('=')[1] : 'stable';
if (!['stable', 'beta'].includes(VARIANT)) {
  console.error(`❌ 未知 variant: ${VARIANT}，可选值: stable | beta`);
  process.exit(1);
}

const ARCHIVE_NAME = VARIANT === 'beta' ? 'novamax-beta.7z' : 'novamax.7z';

console.log('\n🚀 开始打包 NovaMax (便携版)...\n');
console.log(`📌 Variant : ${VARIANT} (${VARIANT === 'beta' ? '测试版 / 上传服务器' : '正式版 / ModelScope'})`);
console.log(`📦 输出包  : ${ARCHIVE_NAME}\n`);

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

// 3. 使用 esbuild 打包后端代码
console.log('🔨 开始打包后端 (esbuild)...');
const backendDest = path.join(RELEASE_DIR, 'backend');
const distDest = path.join(backendDest, 'dist');
fs.mkdirSync(distDest, { recursive: true });

// 读取 package.json 获取所有依赖名（标记为 external）
const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'backend/package.json'), 'utf-8'));
const externalDeps = Object.keys(pkg.dependencies || {});

const banner = [
  'import{fileURLToPath as __banner_fileURLToPath}from"url";',
  'import{dirname as __banner_dirname}from"path";',
  'const __filename=__banner_fileURLToPath(import.meta.url);',
  'const __dirname=__banner_dirname(__filename);',
].join('');

try {
  // esbuild JS API 打包：src/index.js -> dist/index.js
  await esbuildBuild({
    entryPoints: [path.join(PROJECT_ROOT, 'backend/src/index.js')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    minify: true,
    treeShaking: true,
    outfile: path.join(distDest, 'index.js'),
    external: [
      ...externalDeps,
      ...builtinModules,
      ...builtinModules.map(m => `node:${m}`),
    ],
    banner: { js: banner },
    define: {
      __BUILD_VARIANT__: JSON.stringify(VARIANT),
    },
  });

  console.log('✅ 后端 esbuild 打包完成');
} catch (error) {
  console.error('❌ 后端打包失败:', error.message);
  process.exit(1);
}

// 复制 Python 脚本到 dist/scripts/
console.log('📋 复制 Python 脚本...');
const scriptsDest = path.join(distDest, 'scripts');
fs.mkdirSync(scriptsDest, { recursive: true });
const pyScripts = ['modelscope_downloader.py', 'hf_downloader.py'];
for (const script of pyScripts) {
  const src = path.join(PROJECT_ROOT, 'backend/src/services', script);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(scriptsDest, script));
  }
}
console.log('✅ Python 脚本已复制');

// 打包 auxiliary scripts 为独立发布文件
console.log('🔨 打包辅助脚本...');
const auxiliaryManifestPath = path.join(PROJECT_ROOT, 'backend/src/auxiliary-scripts.json');
let auxiliaryScripts = [];
if (fs.existsSync(auxiliaryManifestPath)) {
  try {
    auxiliaryScripts = JSON.parse(fs.readFileSync(auxiliaryManifestPath, 'utf-8'));
  } catch (error) {
    console.error('❌ 读取 auxiliary-scripts.json 失败:', error.message);
    process.exit(1);
  }
}

if (auxiliaryScripts.length > 0) {
  for (const scriptEntry of auxiliaryScripts) {
    const srcPath = path.join(PROJECT_ROOT, 'backend', scriptEntry.source);
    const destPath = path.join(distDest, scriptEntry.target);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    if (!fs.existsSync(srcPath)) {
      console.warn(`⚠️ 辅助脚本未找到，跳过: ${scriptEntry.source}`);
      continue;
    }

    try {
      await esbuildBuild({
        entryPoints: [srcPath],
        bundle: true,
        platform: 'node',
        format: 'esm',
        minify: true,
        treeShaking: true,
        outfile: destPath,
        external: [
          ...externalDeps,
          ...builtinModules,
          ...builtinModules.map(m => `node:${m}`),
        ],
        banner: { js: banner },
        define: {
          __BUILD_VARIANT__: JSON.stringify(VARIANT),
        },
      });
      console.log(`✅ 已打包辅助脚本: ${scriptEntry.target}`);
    } catch (error) {
      console.error(`❌ 打包辅助脚本失败: ${scriptEntry.source}`, error.message);
      process.exit(1);
    }
  }
} else {
  console.log('ℹ️ auxiliary-scripts.json 未配置，跳过辅助脚本打包');
}

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
  copyDirectory(nodeModulesSrc, nodeModulesDest, ['pkg', '.cache', '.bin', 'esbuild', '@esbuild']);
  console.log('✅ 依赖包已复制');
} else {
  console.log('⚠️  node_modules 不存在，跳过');
}

// 4. 复制前端构建产物
console.log('📋 复制前端文件...');
const frontendDest = path.join(RELEASE_DIR, 'frontend');
copyDirectory(frontendDist, path.join(frontendDest, 'dist'));
console.log('✅ 前端文件已复制');

// 5. 复制外部工具（仅 node + python313，其余引擎按需下载）
console.log('📋 复制外部工具...');
const externalDest = path.join(RELEASE_DIR, 'external');
for (const tool of ['node', 'python313']) {
  const src = path.join(PROJECT_ROOT, 'external', tool);
  if (fs.existsSync(src)) {
    console.log(`   复制 external/${tool}...`);
    copyDirectory(src, path.join(externalDest, tool));
  } else {
    console.warn(`⚠️  external/${tool} 不存在，跳过`);
  }
}
console.log('✅ 外部工具已复制 (node, python313)');

// 5b. 复制 ci/ 安装脚本（引擎安装时需要）
console.log('📋 复制 ci/ 安装脚本...');
const ciSrc = path.join(PROJECT_ROOT, 'ci');
const ciDest = path.join(RELEASE_DIR, 'ci');
if (fs.existsSync(ciSrc)) {
  copyDirectory(ciSrc, ciDest);
  console.log('✅ ci/ 已复制');
} else {
  console.warn('⚠️  ci/ 目录不存在，跳过');
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
  const defaultFiles = ['models.json', 'config.json', 'presets.json', 'parameters.json', 'engines.json', 'update.json'];
  defaultFiles.forEach(file => {
    const srcFile = path.join(dataSrc, file);
    const rootFile = path.join(PROJECT_ROOT, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(dataDest, file));
    } else if (fs.existsSync(rootFile)) {
      // data/ 下没有，尝试项目根目录
      fs.copyFileSync(rootFile, path.join(dataDest, file));
    } else {
      // 创建空的 JSON 文件
      fs.writeFileSync(path.join(dataDest, file), '[]');
    }
  });
}

// 创建运行时必需的子目录
const runtimeDirs = [
  'logs',
  'updates',
  'downloads',
  'models',
  'models_dir',
  'presets',
  'cache',
  'asr_services',
];
for (const sub of runtimeDirs) {
  fs.mkdirSync(path.join(dataDest, sub), { recursive: true });
}

// 复制 TTS 预设数据（参考音频 + 工作区 + 音色库）
const ttsSrc = path.join(dataSrc, 'tts_services');
const ttsDest = path.join(dataDest, 'tts_services');
fs.mkdirSync(ttsDest, { recursive: true });

if (fs.existsSync(ttsSrc)) {
  // 复制 SQLite 数据库（含 workspace / voice 元数据）
  for (const dbFile of ['tts.db', 'tts.db-shm', 'tts.db-wal']) {
    const src = path.join(ttsSrc, dbFile);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(ttsDest, dbFile));
    }
  }

  // 复制工作区目录
  const wsSrc = path.join(ttsSrc, 'workspaces');
  if (fs.existsSync(wsSrc)) {
    copyDirectory(wsSrc, path.join(ttsDest, 'workspaces'));
    // 确保关键子目录存在（空目录在旧版 copyDirectory 中会丢失，保留此保障）
    const wsDest = path.join(ttsDest, 'workspaces');
    if (fs.existsSync(wsDest)) {
      for (const wsDir of fs.readdirSync(wsDest, { withFileTypes: true })) {
        if (wsDir.isDirectory()) {
          for (const sub of ['outputs', 'uploads', 'jobs', 'reference']) {
            fs.mkdirSync(path.join(wsDest, wsDir.name, sub), { recursive: true });
          }
        }
      }
    }
  }

  // 复制参考音频（内置音色）
  const refSrc = path.join(ttsSrc, 'reference_audio');
  const refDest = path.join(ttsDest, 'reference_audio');
  fs.mkdirSync(refDest, { recursive: true });
  if (fs.existsSync(refSrc)) {
    const refFiles = fs.readdirSync(refSrc).filter(f => /\.(wav|mp3|flac|ogg)$/i.test(f));
    for (const f of refFiles) {
      fs.copyFileSync(path.join(refSrc, f), path.join(refDest, f));
    }
    console.log(`   ✓ 参考音频: ${refFiles.length} 个文件`);
  }

  // 复制音色音频文件
  const voicesSrc = path.join(ttsSrc, 'voices');
  if (fs.existsSync(voicesSrc)) {
    copyDirectory(voicesSrc, path.join(ttsDest, 'voices'));
  }

}
console.log('✅ 数据目录已创建 (含 TTS 预设工作区 + 参考音频 + 音色库)');

// 8. 复制 scripts/ 目录（启动脚本 + gpuinfo.exe 等二进制工具）
console.log('📄 复制 scripts/ ...');
const scriptsDir = path.join(PROJECT_ROOT, 'scripts');
const releaseScriptsDir = path.join(RELEASE_DIR, 'scripts');
fs.mkdirSync(releaseScriptsDir, { recursive: true });

// gpuinfo.exe — GPU 信息查询工具
const gpuinfoSrc = path.join(scriptsDir, 'gpuinfo.exe');
if (fs.existsSync(gpuinfoSrc)) {
  fs.copyFileSync(gpuinfoSrc, path.join(releaseScriptsDir, 'gpuinfo.exe'));
  console.log('   ✓ gpuinfo.exe');
} else {
  console.warn('⚠️  scripts/gpuinfo.exe 不存在，跳过');
}

// NovaMax.bat / Stop-NovaMax.bat
for (const script of ['NovaMax.bat', 'Stop-NovaMax.bat']) {
  const src = path.join(scriptsDir, script);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(RELEASE_DIR, script));
    console.log(`   ✓ ${script}`);
  } else {
    console.warn(`⚠️  scripts/${script} 不存在，跳过`);
  }
}


// start_novamax.py — 从 scripts/ 复制
const startPySrc = path.join(scriptsDir, 'start_novamax.py');
if (fs.existsSync(startPySrc)) {
  fs.copyFileSync(startPySrc, path.join(RELEASE_DIR, 'start_novamax.py'));
  console.log(`   ✓ start_novamax.py`);
} else {
  console.warn('⚠️  scripts/start_novamax.py 不存在，跳过');
}
console.log('✅ 启动脚本已复制');


// 9. 复制用户文档（替换构建日期占位符）
console.log('📄 复制用户文档...');
const readmeSrc = path.join(scriptsDir, 'README.md');
if (fs.existsSync(readmeSrc)) {
  let readme = fs.readFileSync(readmeSrc, 'utf-8');
  readme = readme.replace('{{BUILD_DATE}}', new Date().toISOString().split('T')[0]);
  fs.writeFileSync(path.join(RELEASE_DIR, 'README.md'), readme);
  console.log('   ✓ README.md');
} else {
  console.warn('⚠️  scripts/README.md 不存在，跳过');
}
console.log('✅ 用户文档已复制');

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
console.log(`\n💡 打包内容：node + python313 + ci脚本（其余引擎按需下载）`);

console.log('\n✅ 测试运行: cd release && NovaMax.bat');
console.log('');

// 11. 压缩打包
console.log('\n📦 正在压缩打包...');
const archiveName = ARCHIVE_NAME;
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

  // 先创建目标目录（即使源目录为空也创建）
  fs.mkdirSync(dest, { recursive: true });

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