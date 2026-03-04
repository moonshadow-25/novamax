/**
 * 数据迁移脚本：从 downloaded_quantizations 迁移到 downloaded_files
 *
 * 使用方法：
 * node backend/src/migrations/migrate-quantizations.js
 */

import modelManager from '../services/modelManager.js';

async function migrateToFileBasedSystem() {
  console.log('='.repeat(60));
  console.log('开始迁移：从 downloaded_quantizations 到 downloaded_files');
  console.log('='.repeat(60));

  try {
    // 初始化模型管理器
    await modelManager.init();

    const models = modelManager.getAll();
    console.log(`\n找到 ${models.length} 个模型`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const model of models) {
      console.log(`\n处理模型: ${model.name} (${model.id})`);

      // 如果已经有 downloaded_files，跳过
      if (model.downloaded_files && model.downloaded_files.length > 0) {
        console.log('  ⊙ 已有 downloaded_files，跳过');
        skippedCount++;
        continue;
      }

      // 扫描实际文件
      const scannedFiles = await modelManager.scanDownloadedFiles(model.id);

      if (scannedFiles.length === 0) {
        console.log('  ⊙ 没有下载的文件，跳过');
        skippedCount++;
        continue;
      }

      console.log(`  找到 ${scannedFiles.length} 个文件`);

      // 如果有激活的预设，激活对应的文件
      if (model.selected_quantization) {
        const file = scannedFiles.find(f => f.matched_preset === model.selected_quantization);
        if (file) {
          file.is_active = true;
          console.log(`  ✓ 激活文件: ${file.filename} (匹配预设: ${model.selected_quantization})`);
        }
      }

      // 如果没有激活的文件，激活第一个
      if (!scannedFiles.some(f => f.is_active) && scannedFiles.length > 0) {
        scannedFiles[0].is_active = true;
        console.log(`  ✓ 激活第一个文件: ${scannedFiles[0].filename}`);
      }

      // 更新模型配置
      await modelManager.update(model.id, {
        downloaded_files: scannedFiles,
        // 保留旧字段以便回滚
        _old_downloaded_quantizations: model.downloaded_quantizations,
        _old_selected_quantization: model.selected_quantization
      });

      console.log('  ✓ 迁移成功');
      migratedCount++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('迁移完成！');
    console.log(`  成功迁移: ${migratedCount} 个模型`);
    console.log(`  跳过: ${skippedCount} 个模型`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本，执行迁移
const isMainModule = import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule || process.argv[1].includes('migrate-quantizations')) {
  migrateToFileBasedSystem()
    .then(() => {
      console.log('\n✓ 迁移脚本执行完成');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ 迁移脚本执行失败:', error);
      process.exit(1);
    });
}

export default migrateToFileBasedSystem;
