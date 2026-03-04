import axios from 'axios';

class ModelScopeService {
  constructor() {
    this.baseURL = 'https://www.modelscope.cn';
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  async getUserModels(username) {
    try {
      const url = `${this.baseURL}/models?name=${username}`;
      console.log('Fetching models from:', url);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const models = [];

      // 查找包含 __NEXT_DATA__ 的 script 标签（Next.js 应用通常会在这里存储数据）
      $('script#__NEXT_DATA__').each((i, elem) => {
        try {
          const jsonData = JSON.parse($(elem).html());
          console.log('Found NEXT_DATA:', JSON.stringify(jsonData).substring(0, 500));

          // 尝试从不同可能的路径提取模型数据
          const pageProps = jsonData?.props?.pageProps;
          if (pageProps?.models) {
            models.push(...pageProps.models);
          }
          if (pageProps?.initialData?.models) {
            models.push(...pageProps.initialData.models);
          }
        } catch (e) {
          console.error('Error parsing NEXT_DATA:', e.message);
        }
      });

      console.log(`Found ${models.length} models`);
      return { Data: models };
    } catch (error) {
      console.error('Error fetching user models:', error.message);
      throw error;
    }
  }

  async getModelFiles(modelId) {
    try {
      // 使用正确的 API 端点
      const url = `${this.baseURL}/api/v1/models/${modelId}/repo/files`;
      console.log('Fetching model files from:', url);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      // API 直接返回 JSON 格式
      if (response.data && response.data.Data && response.data.Data.Files) {
        console.log(`Found ${response.data.Data.Files.length} files`);
        return response.data;
      }

      // 兼容旧版本响应格式
      if (Array.isArray(response.data)) {
        console.log(`Found ${response.data.length} files`);
        return { Data: { Files: response.data } };
      }

      console.log('No files found in response');
      return { Data: { Files: [] } };
    } catch (error) {
      console.error('Error fetching model files:', error.message);
      throw error;
    }
  }

  getDownloadUrl(modelId, filePath) {
    // ModelScope 的实际下载链接格式
    return `${this.baseURL}/models/${modelId}/resolve/master/${filePath}`;
  }

  filterNovaAIModels(models) {
    return models.filter(model => {
      const name = model.Name || model.name || model.id || '';
      return name.startsWith('NovaAI');
    });
  }
}

export default new ModelScopeService();
