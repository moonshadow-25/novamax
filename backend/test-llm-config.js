/**
 * 测试 LLM 运行配置生成
 */
import { generateLLMCommand, checkLlamaServerAvailable } from './src/services/llmRunner.js';
import modelManager from './src/services/modelManager.js';

async function test() {
  // 初始化
  await modelManager.init();

  // 获取模型
  const model = modelManager.getById('shoujiekeji_Qwen3.5-35B-A3B-GGUF');
  if (!model) {
    console.error('模型不存在');
    return;
  }

  console.log('模型信息:');
  console.log(`  名称: ${model.name}`);
  console.log(`  类型: ${model.type}`);
  console.log(`  已下载: ${model.downloaded}`);

  // 生成启动命令
  const { command, args, config } = generateLLMCommand(model, 8100);

  console.log('\n启动配置:');
  console.log(`  模型路径: ${config.modelPath}`);
  if (config.mmprojPath) {
    console.log(`  多模态文件: ${config.mmprojPath}`);
  }
  console.log(`  上下文长度: ${config.contextLength}`);
  console.log(`  GPU 层数: ${config.gpuLayers}`);
  console.log(`  线程数: ${config.threads}`);
  console.log(`  并行数: ${config.parallel}`);

  console.log('\n启动命令:');
  console.log(`  ${command} ${args.join(' ')}`);

  // 检查 llama-server 是否可用
  console.log('\n检查 llama-server 可用性:');
  const available = await checkLlamaServerAvailable();
  console.log(`  llama-server: ${available ? '✓ 可用' : '✗ 不可用'}`);

  if (!available) {
    console.log('\n提示: 请确保已安装 llama.cpp 并将 llama-server 添加到 PATH');
    console.log('  下载地址: https://github.com/ggml-org/llama.cpp/releases');
  }
}

test().catch(console.error);
