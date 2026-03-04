import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function testWebScraping() {
  try {
    const url = 'https://www.modelscope.cn/models?name=shoujiekeji';
    console.log('Fetching:', url);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log('✓ Page fetched successfully');
    console.log('Content length:', response.data.length);

    // 保存 HTML 以便检查
    fs.writeFileSync('debug-page.html', response.data);
    console.log('✓ Saved HTML to debug-page.html');

    const $ = cheerio.load(response.data);

    // 查找 __NEXT_DATA__
    const nextDataScript = $('script#__NEXT_DATA__');
    if (nextDataScript.length > 0) {
      console.log('\n✓ Found __NEXT_DATA__ script');
      const jsonData = JSON.parse(nextDataScript.html());

      // 保存 JSON 数据
      fs.writeFileSync('debug-data.json', JSON.stringify(jsonData, null, 2));
      console.log('✓ Saved data to debug-data.json');

      // 尝试找到模型数据
      console.log('\nSearching for models in data structure...');
      const pageProps = jsonData?.props?.pageProps;

      console.log('Available keys in pageProps:', Object.keys(pageProps || {}));

      if (pageProps) {
        // 递归查找包含模型的字段
        function findModels(obj, path = '') {
          if (!obj || typeof obj !== 'object') return;

          for (const key in obj) {
            const value = obj[key];
            const currentPath = path ? `${path}.${key}` : key;

            if (Array.isArray(value) && value.length > 0) {
              const first = value[0];
              if (first && (first.Name || first.name || first.id)) {
                console.log(`\nFound potential models array at: ${currentPath}`);
                console.log(`Array length: ${value.length}`);
                console.log('First item:', JSON.stringify(first, null, 2).substring(0, 300));
              }
            } else if (typeof value === 'object') {
              findModels(value, currentPath);
            }
          }
        }

        findModels(pageProps);
      }
    } else {
      console.log('\n✗ No __NEXT_DATA__ script found');
      console.log('Available script tags:');
      $('script').each((i, elem) => {
        const id = $(elem).attr('id');
        const src = $(elem).attr('src');
        if (id || src) {
          console.log(`  - ${id || 'no-id'} ${src || 'inline'}`);
        }
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testWebScraping();
