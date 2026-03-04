import axios from 'axios';
import fs from 'fs';

async function testModelScopeAPIs() {
  const modelId = 'shoujiekeji/Qwen3.5-35B-A3B-GGUF';

  // 可能的 API 端点
  const endpoints = [
    `https://www.modelscope.cn/api/v1/models/${modelId}`,
    `https://www.modelscope.cn/api/v1/models/${modelId}/repo/tree`,
    `https://www.modelscope.cn/api/v1/models/${modelId}/files`,
    `https://www.modelscope.cn/api/v1/datasets/${modelId}/repo/tree`,
    `https://modelscope.cn/api/v1/models/${modelId}`,
    `https://modelscope.cn/api/v1/models/${modelId}/repo`,
    `https://modelscope.cn/api/v1/models/${modelId}/tree/master`,
    `https://www.modelscope.cn/api/v1/models/${modelId}/revisions/master/files`,
    // 类似 Hugging Face 的端点
    `https://www.modelscope.cn/api/models/${modelId}`,
    `https://www.modelscope.cn/api/models/${modelId}/tree/master`,
  ];

  const results = [];

  for (const url of endpoints) {
    try {
      console.log(`\n测试: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
        validateStatus: () => true // 接受所有状态码
      });

      console.log(`  状态: ${response.status}`);

      if (response.status === 200) {
        console.log(`  ✓ 成功!`);
        results.push({
          url,
          status: response.status,
          data: response.data
        });

        // 保存成功的响应
        const filename = `api-response-${endpoints.indexOf(url)}.json`;
        fs.writeFileSync(filename, JSON.stringify(response.data, null, 2));
        console.log(`  保存到: ${filename}`);

        // 如果找到文件列表，打印出来
        if (Array.isArray(response.data)) {
          console.log(`  找到数组，长度: ${response.data.length}`);
        } else if (response.data.files) {
          console.log(`  找到 files 字段`);
        } else if (response.data.tree) {
          console.log(`  找到 tree 字段`);
        }
      } else {
        console.log(`  状态码: ${response.status}`);
      }
    } catch (error) {
      console.log(`  ✗ 错误: ${error.message}`);
    }
  }

  // 保存所有结果
  fs.writeFileSync('api-test-results.json', JSON.stringify(results, null, 2));
  console.log(`\n\n总计测试了 ${endpoints.length} 个端点`);
  console.log(`成功: ${results.length} 个`);

  if (results.length > 0) {
    console.log('\n成功的端点:');
    results.forEach(r => console.log(`  - ${r.url}`));
  }
}

testModelScopeAPIs().catch(console.error);
