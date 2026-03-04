import axios from 'axios';
import fs from 'fs';

async function getModelFiles() {
  const modelId = 'shoujiekeji/Qwen3.5-35B-A3B-GGUF';

  // 尝试 Git API 端点
  const gitEndpoints = [
    `https://www.modelscope.cn/api/v1/models/${modelId}/repo/files`,
    `https://www.modelscope.cn/api/v1/models/${modelId}/repo?Revision=master&Recursive=true`,
    `https://www.modelscope.cn/api/v1/models/${modelId}/repo?Revision=master`,
    `https://www.modelscope.cn/api/v1/datasets/${modelId}/repo?Revision=master&Recursive=true`,
    `https://modelscope.cn/api/v1/models/${modelId}/repo?Revision=master&Recursive=true`,
    `https://www.modelscope.cn/api/v1/models/${modelId}/oss/tree`,
  ];

  for (const url of gitEndpoints) {
    try {
      console.log(`\n测试: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        timeout: 10000,
        validateStatus: () => true
      });

      console.log(`状态: ${response.status}`);

      if (response.status === 200 && response.headers['content-type']?.includes('application/json')) {
        console.log('✓ 成功!');

        const filename = `git-api-${gitEndpoints.indexOf(url)}.json`;
        fs.writeFileSync(filename, JSON.stringify(response.data, null, 2));
        console.log(`保存到: ${filename}`);

        // 查找文件列表
        const data = response.data;
        if (data.Data?.Files) {
          console.log(`找到 ${data.Data.Files.length} 个文件`);
          const ggufFiles = data.Data.Files.filter(f =>
            f.Name?.toLowerCase().endsWith('.gguf') ||
            f.Path?.toLowerCase().endsWith('.gguf')
          );
          console.log(`其中 ${ggufFiles.length} 个 GGUF 文件:`);
          ggufFiles.forEach(f => {
            const size = f.Size ? `${(f.Size / 1024 / 1024 / 1024).toFixed(2)} GB` : 'unknown';
            console.log(`  - ${f.Name || f.Path} (${size})`);
          });

          // 找到了就退出
          return { success: true, files: data.Data.Files, ggufFiles };
        }
      }
    } catch (error) {
      console.log(`错误: ${error.message}`);
    }
  }

  return { success: false };
}

getModelFiles().then(result => {
  if (result.success) {
    console.log('\n\n✓ 成功获取文件列表！');
    fs.writeFileSync('model-files.json', JSON.stringify(result, null, 2));
  } else {
    console.log('\n\n✗ 未找到文件列表 API');
  }
}).catch(console.error);
