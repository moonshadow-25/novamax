import axios from 'axios';

const MODELSCOPE_TOKEN = 'ms-39cb51cd-80a2-4dfc-8e1f-e820a8dcbe98';

async function testAPI() {
  // 测试不同的 API 端点
  const endpoints = [
    'https://www.modelscope.cn/api/v1/models?Owner=shoujiekeji&PageSize=10',
    'https://modelscope.cn/api/v1/models?Owner=shoujiekeji&PageSize=10',
    'https://www.modelscope.cn/api/v1/models?owner=shoujiekeji&page_size=10',
    'https://www.modelscope.cn/api/v1/users/shoujiekeji/models',
  ];

  for (const url of endpoints) {
    console.log(`\nTesting: ${url}`);
    console.log('='.repeat(80));

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${MODELSCOPE_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      });

      console.log('✓ Success!');
      console.log('Status:', response.status);
      console.log('Data:', JSON.stringify(response.data, null, 2).substring(0, 500));
      break; // 找到可用的端点就停止
    } catch (error) {
      console.log('✗ Failed');
      console.log('Status:', error.response?.status);
      console.log('Status Text:', error.response?.statusText);
      console.log('Error:', error.message);
      if (error.response?.data) {
        console.log('Response:', JSON.stringify(error.response.data, null, 2).substring(0, 300));
      }
    }
  }

  // 尝试直接访问模型页面
  console.log('\n\nTrying to fetch model page HTML...');
  console.log('='.repeat(80));
  try {
    const response = await axios.get('https://www.modelscope.cn/models?owner=shoujiekeji', {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    console.log('✓ Page accessible, status:', response.status);
    console.log('Content length:', response.data.length);
  } catch (error) {
    console.log('✗ Failed to access page:', error.message);
  }
}

testAPI();
