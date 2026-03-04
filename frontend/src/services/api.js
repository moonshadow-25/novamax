import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

api.interceptors.response.use(
  response => response.data,
  error => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

export const modelService = {
  getAll: () => api.get('/models'),
  getById: (id) => api.get(`/models/${id}`),
  getByType: (type) => api.get(`/models/type/${type}`),
  create: (data) => api.post('/models', data),
  update: (id, data) => api.put(`/models/${id}`, data),
  delete: (id) => api.delete(`/models/${id}`),
  deleteFiles: (id) => api.delete(`/models/${id}/files`),
  search: (query) => api.get(`/models/search?q=${query}`),
  getDownloadedQuantizations: (id) => api.get(`/models/${id}/downloaded-quantizations`),
  scanDownloadedFiles: (id) => api.get(`/models/${id}/scan-files`),
  setActiveFile: (id, filename) => api.post(`/models/${id}/set-active-file`, { filename })
};

export const modelscopeService = {
  getModels: (type) => api.get(`/modelscope/models/${type}`),
  search: (query, type) => api.get(`/modelscope/search?q=${query}&type=${type || ''}`),
  getDetail: (id) => api.get(`/modelscope/detail/${id}`),

  // 新功能：解析 ModelScope URL
  parseUrl: (url, type) => api.post('/modelscope/parse-url', { url, type }),

  // 新功能：搜索 ModelScope 模型
  searchModels: (query) => api.post('/modelscope/search', { query }),

  // 新功能：确认并保存模型
  confirmModel: (config) => api.post('/modelscope/confirm', { config })
};

export const downloadService = {
  start: (modelId, quantizationName = null) => api.post('/download/start', { modelId, quantizationName }),
  pause: (id) => api.post(`/download/pause/${id}`),
  resume: (id) => api.post(`/download/resume/${id}`),
  cancel: (id) => api.delete(`/download/${id}`),
  getStatus: (id) => api.get(`/download/status/${id}`),
  getAll: () => api.get('/download/list')
};

export const backendService = {
  start: (modelId, mode = 'router') => api.post(`/backend/start/${modelId}?mode=${mode}`),
  startRouter: (type) => api.post(`/backend/start-router/${type}`),
  stop: (modelId) => api.post(`/backend/stop/${modelId}`),
  getStatus: (modelId) => api.get(`/backend/status/${modelId}`),
  getLogs: (modelId) => api.get(`/backend/logs/${modelId}`)
};

export const llmService = {
  chat: (modelId, data) => api.post(`/llm/${modelId}/chat`, data),
  complete: (modelId, data) => api.post(`/llm/${modelId}/complete`, data),
  getInfo: (modelId) => api.get(`/llm/${modelId}/info`)
};

export const comfyuiService = {
  generate: (modelId, data) => api.post(`/comfyui/${modelId}/generate`, data),
  getProgress: (modelId, taskId) => api.get(`/comfyui/${modelId}/progress/${taskId}`),
  getResult: (modelId, taskId) => api.get(`/comfyui/${modelId}/result/${taskId}`),
  analyzeWorkflow: (modelId, workflow) => api.post(`/comfyui/${modelId}/analyze-workflow`, { workflow }),
  uploadWorkflow: (modelId, formData) => api.post(`/comfyui/${modelId}/upload-workflow`, formData)
};

export const ttsService = {
  generate: (modelId, data) => api.post(`/tts/${modelId}/generate`, data),
  getVoices: (modelId) => api.get(`/tts/${modelId}/voices`)
};

export const whisperService = {
  transcribe: (modelId, formData) => api.post(`/whisper/${modelId}/transcribe`, formData),
  translate: (modelId, formData) => api.post(`/whisper/${modelId}/translate`, formData)
};

export const configService = {
  get: () => api.get('/config'),
  update: (data) => api.put('/config', data),
  getTheme: () => api.get('/config/theme'),
  setTheme: (theme) => api.put('/config/theme', { theme })
};

export default api;
