/**
 * 测试参数管理系统
 */
import parameterService from './src/services/parameterService.js';
import modelManager from './src/services/modelManager.js';

async function test() {
  console.log('=== 参数管理系统测试 ===\n');

  // 初始化
  await modelManager.init();

  const modelId = 'shoujiekeji_Qwen3.5-35B-A3B-GGUF';
  const model = modelManager.getById(modelId);

  if (!model) {
    console.error('模型不存在');
    return;
  }

  // 1. 获取默认参数
  console.log('1. 默认参数:');
  const defaultParams = parameterService.getEffectiveParameters(model);
  console.log(`   来源: ${defaultParams._source}`);
  console.log(`   版本: ${defaultParams._version}`);
  console.log(`   GPU层数: ${defaultParams.gpu_layers}`);
  console.log(`   上下文: ${defaultParams.context_length}`);
  console.log('');

  // 2. 保存用户参数
  console.log('2. 保存用户自定义参数...');
  await parameterService.saveUserParameters(modelId, {
    gpu_layers: 50,
    context_length: 16384,
    temperature: 0.8,
    custom_param: 'test_value'
  });

  const userParams = parameterService.getEffectiveParameters(modelManager.getById(modelId));
  console.log(`   来源: ${userParams._source}`);
  console.log(`   GPU层数: ${userParams.gpu_layers} (修改)`);
  console.log(`   上下文: ${userParams.context_length} (修改)`);
  console.log(`   温度: ${userParams.temperature} (修改)`);
  console.log(`   自定义: custom_param = ${userParams.custom_param}`);
  console.log('');

  // 3. 添加自定义参数
  console.log('3. 添加自定义参数...');
  await parameterService.addCustomParameter(modelId, 'my_custom_flag', true);
  await parameterService.addCustomParameter(modelId, 'max_tokens', 2048);

  const withCustom = parameterService.getEffectiveParameters(modelManager.getById(modelId));
  console.log(`   my_custom_flag: ${withCustom.my_custom_flag}`);
  console.log(`   max_tokens: ${withCustom.max_tokens}`);
  console.log('');

  // 4. 测试版本控制
  console.log('4. 测试版本控制...');
  console.log('   当前默认版本: 1.0.0');
  console.log('   用户参数版本: 1.0.0');

  // 模拟版本更新
  const currentModel = modelManager.getById(modelId);
  currentModel.parameters.version = '2.0.0';
  currentModel.parameters.new_param = 999;

  const afterVersionUpdate = parameterService.getEffectiveParameters(currentModel);
  console.log(`   检测到版本更新: ${afterVersionUpdate._version}`);
  console.log(`   来源: ${afterVersionUpdate._source}`);
  console.log(`   提示: ${afterVersionUpdate._note || '无'}`);
  console.log('');

  // 5. 重置为默认
  console.log('5. 重置为默认参数...');
  await parameterService.resetToDefault(modelId);

  const resetParams = parameterService.getEffectiveParameters(modelManager.getById(modelId));
  console.log(`   来源: ${resetParams._source}`);
  console.log(`   GPU层数: ${resetParams.gpu_layers} (恢复默认)`);
  console.log(`   custom_param: ${resetParams.custom_param || '已删除'}`);
  console.log('');

  // 6. 参数元数据
  console.log('6. 参数元数据:');
  const metadata = parameterService.getParameterMetadata();
  console.log(`   共 ${Object.keys(metadata).length} 个标准参数`);
  console.log('   示例:');
  console.log(`   - gpu_layers: ${metadata.gpu_layers.label} (${metadata.gpu_layers.description})`);
  console.log(`   - temperature: ${metadata.temperature.label} (${metadata.temperature.description})`);

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
