// 测试 ModelScope 下载功能
import downloadService from './src/services/downloadService.js';
import modelManager from './src/services/modelManager.js';

async function test() {
  console.log('初始化 modelManager...');
  await modelManager.init();

  // 创建一个测试模型
  console.log('创建测试模型...');
  const testModel = await modelManager.create('llm', {
    name: 'Qwen2.5-0.5B-Instruct',
    modelscope_id: 'Qwen/Qwen2.5-0.5B-Instruct',
    description: '测试模型 - Qwen 0.5B',
    size: 500 * 1024 * 1024 // 约 500MB
  });

  console.log('测试模型已创建:', testModel);

  // 开始下载
  console.log('\n开始下载...');
  try {
    const downloadState = await downloadService.startDownload(testModel.id);
    console.log('下载任务已启动:', downloadState);

    // 监听进度
    downloadService.on('progress', (data) => {
      console.log(`下载进度: ${data.progress.toFixed(2)}%`);
    });

    downloadService.on('error', (data) => {
      console.error('下载错误:', data.error);
    });

  } catch (error) {
    console.error('下载失败:', error);
  }
}

test().catch(console.error);
