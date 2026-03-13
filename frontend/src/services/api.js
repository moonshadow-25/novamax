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
  setActiveFile: (id, filename) => api.post(`/models/${id}/set-active-file`, { filename }),
  deleteQuantization: (id, filename) => api.delete(`/models/${id}/quantization`, { data: { filename } })
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
  pause: (id, quantizationName) => api.post(`/download/pause/${id}`, { quantizationName }),
  resume: (id, quantizationName) => api.post(`/download/resume/${id}`, { quantizationName }),
  cancel: (id, quantizationName) => api.delete(`/download/${id}`, { data: { quantizationName } }),
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
  analyzeWorkflow: (workflow, name) => api.post('/comfyui/analyze-workflow', { workflow, name }),
  uploadWorkflow: (formData) => api.post('/comfyui/upload-workflow', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  confirmWorkflow: (data) => api.post('/comfyui/confirm-workflow', data),
  searchModel: (modelId, data) => api.post(`/comfyui/${modelId}/search-model`, data),
  downloadModel: (modelId, data) => api.post(`/comfyui/${modelId}/download-model`, data),
  downloadAllModels: (modelId) => api.post(`/comfyui/${modelId}/download-all-models`),
  getModelsStatus: (modelId) => api.get(`/comfyui/${modelId}/models-status`),
  getDownloadStatus: (taskId) => api.get(`/comfyui/download-status/${taskId}`),
  pauseDownload: (taskId) => api.post(`/comfyui/download-pause/${taskId}`),
  resumeDownload: (taskId) => api.post(`/comfyui/download-resume/${taskId}`),
  cancelDownload: (taskId) => api.post(`/comfyui/download-cancel/${taskId}`),
  start: (modelId) => api.post(`/comfyui/${modelId}/start`),
  stop: (modelId) => api.post(`/comfyui/${modelId}/stop`),
  getStatus: (modelId) => api.get(`/comfyui/${modelId}/status`),
  checkConnection: (modelId) => api.get(`/comfyui/${modelId}/check`),
  uploadImage: (modelId, formData) => api.post(`/comfyui/${modelId}/upload-image`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  run: (modelId, params) => api.post(`/comfyui/${modelId}/run`, params),
  updateConfig: (modelId, config) => modelService.update(modelId, { comfyui_config: config }),
  getWorkflowNodes: (modelId) => api.get(`/comfyui/${modelId}/workflow-nodes`),
  updateUserMapping: (modelId, user_parameter_mapping) => api.put(`/comfyui/${modelId}/user-mapping`, { user_parameter_mapping })
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
  setTheme: (theme) => api.put('/config/theme', { theme }),
  getFavorites: () => api.get('/config/favorites'),
  setFavorites: (favorites) => api.put('/config/favorites', { favorites })
};

export default api;
