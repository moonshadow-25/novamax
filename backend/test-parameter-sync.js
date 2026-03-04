/**
 * 测试参数保存和 INI 同步
 */
import parameterService from './src/services/parameterService.js';
import presetService from './src/services/presetService.js';
import modelManager from './src/services/modelManager.js';
import fs from 'fs';
import path from 'path';

async function test() {
  console.log('=== 测试参数同步修复 ===\n');

  await modelManager.init();

  const modelId = 'shoujiekeji_Qwen3.5-35B-A3B-GGUF';
  const model = modelManager.getById(modelId);

  if (!model) {
    console.error('模型不存在');
    return;
  }

  // 1. 查看当前参数
  console.log('1. 当前参数:');
  const currentParams = parameterService.getEffectiveParameters(model);
  console.log(`   来源: ${currentParams._source}`);
  console.log(`   GPU层数: ${currentParams.gpu_layers}`);
  console.log(`   上下文: ${currentParams.context_length}`);
  console.log('');

  // 2. 修改参数
  console.log('2. 修改参数（GPU层数: 50, 上下文: 32768）...');
  await parameterService.saveUserParameters(modelId, {
    gpu_layers: 50,
    context_length: 32768,
    temperature: 0.8
  });

  // 3. 重新生成 INI
  console.log('3. 重新生成 INI 文件...');
  await presetService.generatePresetFile('llm');

  // 4. 验证 INI 文件
  console.log('4. 验证 INI 文件内容:');
  const iniPath = path.join(process.cwd(), '../data/presets/llm.ini');
  const iniContent = fs.readFileSync(iniPath, 'utf-8');

  const gpuLayersMatch = iniContent.match(/gpu-layers\s*=\s*(\d+)/);
  const ctxSizeMatch = iniContent.match(/ctx-size\s*=\s*(\d+)/);
  const temperatureMatch = iniContent.match(/temperature\s*=\s*([\d.]+)/);

  console.log(`   INI 中 GPU层数: ${gpuLayersMatch ? gpuLayersMatch[1] : '未找到'}`);
  console.log(`   INI 中上下文: ${ctxSizeMatch ? ctxSizeMatch[1] : '未找到'}`);
  console.log(`   INI 中温度: ${temperatureMatch ? temperatureMatch[1] : '未找到'}`);
  console.log('');

  // 5. 验证读取
  console.log('5. 重新读取模型验证:');
  await modelManager.init(); // 重新加载
  const updatedModel = modelManager.getById(modelId);
  const updatedParams = parameterService.getEffectiveParameters(updatedModel);

  console.log(`   来源: ${updatedParams._source}`);
  console.log(`   GPU层数: ${updatedParams.gpu_layers}`);
  console.log(`   上下文: ${updatedParams.context_length}`);
  console.log(`   温度: ${updatedParams.temperature}`);
  console.log('');

  // 验证结果
  const success =
    updatedParams.gpu_layers === 50 &&
    updatedParams.context_length === 32768 &&
    updatedParams.temperature === 0.8 &&
    gpuLayersMatch[1] === '50' &&
    ctxSizeMatch[1] === '32768' &&
    temperatureMatch[1] === '0.8';

  if (success) {
    console.log('✅ 测试通过！参数保存和 INI 同步正常工作');
  } else {
    console.log('❌ 测试失败！参数同步有问题');
  }

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
