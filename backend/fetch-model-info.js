import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function fetchModelInfo() {
  try {
    const modelId = 'shoujiekeji/Qwen3.5-35B-A3B-GGUF';
    const url = `https://www.modelscope.cn/models/${modelId}/files`;

    console.log('Fetching:', url);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const result = {
      modelId,
      files: [],
      description: '',
      metadata: {}
    };

    // 保存原始 HTML 用于调试
    fs.writeFileSync('page-source.html', response.data);
    console.log('✓ 已保存原始 HTML 到 page-source.html');

    // 尝试从 __NEXT_DATA__ 提取数据
    const nextDataScripts = $('script#__NEXT_DATA__');
    console.log(`找到 ${nextDataScripts.length} 个 __NEXT_DATA__ 脚本`);

    $('script#__NEXT_DATA__').each((i, elem) => {
      try {
        const jsonData = JSON.parse($(elem).html());

        // 保存完整的 NEXT_DATA 用于调试
        fs.writeFileSync('next-data.json', JSON.stringify(jsonData, null, 2));
        console.log('✓ 已保存 NEXT_DATA 到 next-data.json');

        const pageProps = jsonData?.props?.pageProps;

        if (pageProps) {
          console.log('Found pageProps keys:', Object.keys(pageProps));

          // 尝试多种可能的路径
          const possiblePaths = [
            pageProps.tree,
            pageProps.files,
            pageProps.initialData?.tree,
            pageProps.initialData?.files,
            pageProps.model?.files,
            pageProps.filesTree
          ];

          for (const path of possiblePaths) {
            if (path && Array.isArray(path)) {
              result.files = path;
              console.log(`✓ 在某个路径找到了 ${path.length} 个文件`);
              break;
            }
          }

          // 提取模型信息
          if (pageProps?.modelDetail) {
            result.description = pageProps.modelDetail.Description || pageProps.modelDetail.description || '';
            result.metadata = pageProps.modelDetail;
          } else if (pageProps?.model) {
            result.description = pageProps.model.Description || pageProps.model.description || '';
            result.metadata = pageProps.model;
          }
        }

      } catch (e) {
        console.error('Error parsing NEXT_DATA:', e.message);
      }
    });

    // 过滤出 .gguf 文件
    result.ggufFiles = result.files.filter(f =>
      (f.Name || f.name || f.path || '').toLowerCase().endsWith('.gguf')
    ).map(f => ({
      name: f.Name || f.name || f.path,
      size: f.Size || f.size,
      path: f.Path || f.path
    }));

    // 保存结果
    fs.writeFileSync('model-info.json', JSON.stringify(result, null, 2));
    console.log('\n✓ 成功获取模型信息');
    console.log(`  找到 ${result.files.length} 个文件`);
    console.log(`  其中 ${result.ggufFiles.length} 个 GGUF 文件`);
    console.log('  结果已保存到 model-info.json');

    // 打印 GGUF 文件列表
    if (result.ggufFiles.length > 0) {
      console.log('\nGGUF 文件列表:');
      result.ggufFiles.forEach(f => {
        const sizeMB = f.size ? (f.size / 1024 / 1024).toFixed(2) + ' MB' : 'unknown';
        console.log(`  - ${f.name} (${sizeMB})`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fetchModelInfo();
