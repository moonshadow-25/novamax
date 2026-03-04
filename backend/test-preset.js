/**
 * 测试预设服务 - 生成 INI 配置文件
 */
import presetService from './src/services/presetService.js';
import modelManager from './src/services/modelManager.js';

async function test() {
  console.log('=== 测试预设服务 ===\n');

  // 初始化模型管理器
  await modelManager.init();

  console.log('1. 生成所有预设文件...');
  const results = await presetService.generateAllPresets();

  Object.entries(results).forEach(([type, result]) => {
    if (result.success) {
      console.log(`   ✓ ${type}: ${result.path}`);
    } else {
      console.log(`   ✗ ${type}: ${result.error}`);
    }
  });

  console.log('\n2. 检查 LLM 预设文件版本...');
  const llmVersion = presetService.getPresetVersion('llm');
  console.log(`   版本: ${llmVersion}`);

  console.log('\n3. 检查预设文件是否存在...');
  ['llm', 'tts', 'whisper', 'comfyui'].forEach(type => {
    const exists = presetService.presetExists(type);
    console.log(`   ${type}: ${exists ? '✓' : '✗'}`);
  });

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
