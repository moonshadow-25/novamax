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
  deleteQuantization: (id, filename) => api.delete(`/models/${id}/quantization`, { data: { filename } }),
  restoreDefaults: (id) => api.post(`/models/${id}/restore-defaults`),
  deleteConfig: (id) => api.delete(`/models/${id}/config`),
  addCustomModel: (data) => api.post('/models/custom', data)
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
  getLogs: (modelId) => api.get(`/backend/logs/${modelId}`),
  openLogsFolder: () => api.post('/backend/open-logs')
};

export const llmService = {
  chat: (modelId, data) => api.post(`/llm/${modelId}/chat`, data),
  complete: (modelId, data) => api.post(`/llm/${modelId}/complete`, data),
  getInfo: (modelId) => api.get(`/llm/${modelId}/info`)
};

export const comfyuiService = {
  // 实例管理
  getInstances: () => api.get('/comfyui/instances'),
  ensureInstance: () => api.post('/comfyui/instances/ensure'),
  createInstance: (config) => api.post('/comfyui/instances', config),
  updateInstance: (id, config) => api.put(`/comfyui/instances/${id}`, config),
  deleteInstance: (id) => api.delete(`/comfyui/instances/${id}`),
  startInstance: (id) => api.post(`/comfyui/instances/${id}/start`),
  stopInstance: (id) => api.post(`/comfyui/instances/${id}/stop`),
  getInstanceStatus: (id) => api.get(`/comfyui/instances/${id}/status`),
  openInstanceFolder: (id) => api.post(`/comfyui/instances/${id}/open-folder`),

  // 工作流执行（纯转发）
  checkConnection: (host, port) => api.post('/comfyui/check', { host, port }),
  uploadImage: (host, port, formData) => {
    formData.append('host', host);
    formData.append('port', port);
    return api.post('/comfyui/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  uploadAudio: (host, port, formData) => {
    formData.append('host', host);
    formData.append('port', port);
    return api.post('/comfyui/upload-audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  run: (modelId, host, port, params) => api.post(`/comfyui/${modelId}/run`, { host, port, ...params }),
  getProgress: (host, port, taskId) => api.get(`/comfyui/progress/${taskId}?host=${host}&port=${port}`),
  getResult: (host, port, taskId) => api.get(`/comfyui/result/${taskId}?host=${host}&port=${port}`),

  // 其他接口保持不变
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
  getWorkflowNodes: (modelId) => api.get(`/comfyui/${modelId}/workflow-nodes`),
  updateUserMapping: (modelId, user_parameter_mapping) => api.put(`/comfyui/${modelId}/user-mapping`, { user_parameter_mapping })
};

export const ttsService = {
  speech: (data) => api.post('/tts/speech', data, { timeout: 300000, responseType: 'blob' }),
  getVoices: () => api.get('/tts/voices'),
  createVoice: (formData) => api.post('/tts/voices', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  autoRegisterVoices: () => api.post('/tts/voices/auto-register'),
  getVoiceAudioUrl: (voiceId) => `/api/tts/voices/${voiceId}/audio`,
  deleteVoice: (voiceId) => api.delete(`/tts/voices/${voiceId}`),
  getHistory: () => api.get('/tts/history'),
  getHistoryAudioUrl: (itemId) => `/api/tts/history/${itemId}/audio`,
  deleteHistoryItem: (itemId) => api.delete(`/tts/history/${itemId}`),
  clearHistory: () => api.delete('/tts/history'),
  health: () => api.get('/tts/health')
};

export const whisperService = {
  transcribe: (file, language, vad = true) => {
    const fd = new FormData();
    fd.append('file', file);
    if (language) fd.append('language', language);
    fd.append('vad_filter', String(vad));
    return api.post('/whisper/transcribe', fd, { timeout: 300000 });
  },
  translate: (file, language) => {
    const fd = new FormData();
    fd.append('file', file);
    if (language) fd.append('language', language);
    return api.post('/whisper/translate', fd, { timeout: 300000 });
  },
  health: () => api.get('/whisper/health')
};

export const configService = {
  get: () => api.get('/config'),
  update: (data) => api.put('/config', data),
  getTheme: () => api.get('/config/theme'),
  setTheme: (theme) => api.put('/config/theme', { theme }),
  getFavorites: () => api.get('/config/favorites'),
  setFavorites: (favorites) => api.put('/config/favorites', { favorites }),
  getPorts: () => api.get('/config/ports'),
  setPorts: (ports) => api.put('/config/ports', { ports }),
  getUpdateSettings: () => api.get('/config/update-settings'),
  setUpdateSettings: (updateSettings) => api.put('/config/update-settings', { updateSettings })
};

export const engineService = {
  getAll: () => api.get('/engines'),
  getById: (id) => api.get(`/engines/${id}`),
  checkInstalled: (id) => api.get(`/engines/${id}/check`),
  getVersions: (id) => api.get(`/engines/${id}/versions`),
  validate: (id, version) => api.post(`/engines/${id}/validate`, { version }),
  download: (id, version) => api.post(`/engines/${id}/download`, { version }),
  getDownloadStatus: (taskId) => api.get(`/engines/download/${taskId}`),
  uninstall: (id, version) => api.delete(`/engines/${id}/versions/${version}`),
  reinstall: (id, version) => api.post(`/engines/${id}/versions/${version}/reinstall`)
};

export const updateService = {
  check: () => api.get('/update/check'),
  status: () => api.get('/update/status'),
  apply: () => api.post('/update/apply')
};

export const systemService = {
  getInfo: () => api.get('/system/info'),
  getStorage: () => api.get('/system/storage'),
  getLogs: (limit = 200, level = 'all') => api.get(`/system/logs?limit=${limit}&level=${level}`),
  clearLogs: () => api.delete('/system/logs'),
  openFolder: (dirPath) => api.post('/system/storage/open', { dirPath }),
  migrateStorage: (type, targetPath) => api.post('/system/storage/migrate', { type, targetPath }),
  restoreStorage: (type) => api.post('/system/storage/restore', { type }),
  pickFolder: () => api.post('/system/storage/pick-folder', {}, { timeout: 120000 })
};

export const remoteConfigService = {
  sync: () => api.post('/remote-config/sync'),
  status: () => api.get('/remote-config/status')
};

export const parameterService = {
  get: (modelId) => api.get(`/parameters/${modelId}`),
  save: (modelId, parameters) => api.put(`/parameters/${modelId}`, { parameters }),
  reset: (modelId) => api.post(`/parameters/${modelId}/reset`),
  addCustom: (modelId, key, value) => api.post(`/parameters/${modelId}/custom`, { key, value }),
  removeCustom: (modelId, key) => api.delete(`/parameters/${modelId}/custom/${key}`),
  getMetadata: () => api.get('/parameters/metadata/all')
};

export default api;
