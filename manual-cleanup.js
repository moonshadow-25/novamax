const fs = require('fs');
const path = require('path');

// 模型类型列表
const modelTypes = ['llm', 'comfyui', 'tts', 'whisper'];

console.log('========================================');
console.log('手动清理下载状态');
console.log('========================================\n');

let totalCleaned = 0;

// 遍历每个模型类型的数据文件
modelTypes.forEach(type => {
  const filePath = path.join(__dirname, 'backend', 'data', 'models', `${type}.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ ${type}.json 不存在，跳过`);
    return;
  }

  try {
    // 读取数据
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!data.models || data.models.length === 0) {
      console.log(`✓ ${type}.json 没有模型数据`);
      return;
    }

    let cleaned = 0;

    // 清理每个模型的下载状态
    data.models.forEach(model => {
      if (model.download_status === 'downloading' || model.download_status === 'paused') {
        console.log(`  清理: ${model.name || model.id} (${model.download_status})`);
        model.download_status = null;
        model.download_progress = 0;
        model.download_error = null;
        cleaned++;
      }
    });

    if (cleaned > 0) {
      // 写回文件
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`✓ ${type}.json 已清理 ${cleaned} 个模型\n`);
      totalCleaned += cleaned;
    } else {
      console.log(`✓ ${type}.json 没有需要清理的下载状态\n`);
    }

  } catch (error) {
    console.error(`✗ 处理 ${type}.json 失败:`, error.message);
  }
});

console.log('========================================');
console.log(`清理完成！共清理了 ${totalCleaned} 个下载状态`);
console.log('========================================\n');

if (totalCleaned > 0) {
  console.log('请重启后端服务，然后刷新前端页面');
} else {
  console.log('没有发现需要清理的下载状态');
  console.log('如果前端仍显示下载中，请检查：');
  console.log('  1. 后端是否正在运行');
  console.log('  2. 前端是否已刷新（Ctrl+F5 强制刷新）');
  console.log('  3. 浏览器缓存是否已清除');
}
