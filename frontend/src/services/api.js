import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000
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
  refreshRemote: (id) => api.post(`/models/${id}/refresh-remote`),
  deleteConfig: (id) => api.delete(`/models/${id}/config`),
  addCustomModel: (data) => api.post('/models/custom', data),
  addAsrModels: (data) => api.post('/models/asr-custom', data),
  addWhisperModels: (data) => api.post('/models/whisper-custom', data),  // @deprecated 兼容旧调用
  addCloudApiModel: (data) => api.post('/models/cloudapi', data),
  testCloudApiModel: (data) => api.post('/models/cloudapi/test', data),
  generateDescription: (id) => api.post(`/models/${id}/generate-description`)
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
  speech: (data) => api.post('/tts/speech', data, { timeout: 0, responseType: 'blob' }),
  getVoices: () => api.get('/tts/voices'),
  createVoice: (formData) => api.post('/tts/voices', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getVoiceAudioUrl: (voiceId) => `/api/tts/voices/${voiceId}/audio`,
  deleteVoice: (voiceId) => api.delete(`/tts/voices/${voiceId}`),
  getHistory: (workspaceId) => api.get('/tts/history', { params: workspaceId ? { workspace_id: workspaceId } : {} }),
  getHistoryAudioUrl: (itemId) => `/api/tts/history/${itemId}/audio`,
  deleteHistoryItem: (itemId) => api.delete(`/tts/history/${itemId}`),
  clearHistory: () => api.delete('/tts/history'),
  health: () => api.get('/tts/health'),
  getEngineContracts: () => api.get('/tts-studio/engine-contracts'),
  getFilesStatus: (modelId) => api.get(`/tts/models/${modelId}/files-status`),
  downloadFile: (modelId, filename) => api.post(`/tts/models/${modelId}/download`, { filename }),
  getDownloadStatus: (taskId) => api.get(`/tts/download-status/${taskId}`),
  pauseDownload: (taskId) => api.post(`/tts/download-pause/${taskId}`),
  resumeDownload: (taskId) => api.post(`/tts/download-resume/${taskId}`),
  cancelDownload: (taskId) => api.post(`/tts/download-cancel/${taskId}`)
};

/** @deprecated 旧版 whisper 服务，使用 asrModelsService 替代 */
export const whisperService = {
  transcribe: (file, language) => {
    const fd = new FormData();
    fd.append('file', file);
    if (language) fd.append('language', language);
    return api.post('/whisper/transcribe', fd, { timeout: 7200000 });
  },
  translate: (file, language) => {
    const fd = new FormData();
    fd.append('file', file);
    if (language) fd.append('language', language);
    return api.post('/whisper/translate', fd, { timeout: 7200000 });
  },
  health: () => api.get('/whisper/health'),
  getFilesStatus: (modelId) => api.get(`/whisper/models/${modelId}/files-status`),
  downloadFile: (modelId, filename) => api.post(`/whisper/models/${modelId}/download`, { filename }),
  getDownloadStatus: (taskId) => api.get(`/whisper/download-status/${taskId}`),
  pauseDownload: (taskId) => api.post(`/whisper/download-pause/${taskId}`),
  resumeDownload: (taskId) => api.post(`/whisper/download-resume/${taskId}`),
  cancelDownload: (taskId) => api.post(`/whisper/download-cancel/${taskId}`)
};

export const asrModelsService = {
  getFilesStatus: (modelId) => api.get(`/asr-models/models/${modelId}/files-status`),
  downloadFile: (modelId, filename) => api.post(`/asr-models/models/${modelId}/download`, { filename }),
  getDownloadStatus: (taskId) => api.get(`/asr-models/download-status/${taskId}`),
  pauseDownload: (taskId) => api.post(`/asr-models/download-pause/${taskId}`),
  resumeDownload: (taskId) => api.post(`/asr-models/download-resume/${taskId}`),
  cancelDownload: (taskId) => api.post(`/asr-models/download-cancel/${taskId}`)
};

// ==================== ASR ====================

export const asrService = {
  getCapabilities: (modelId) => api.get(`/asr/models/${modelId}/capabilities`),
  getEngineContracts: () => api.get('/asr/engine-contracts'),
};

export const asrStudioService = {
  // Files (shared)
  uploadFiles: (formData) => api.post('/asr-studio/files', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 }),
  getFiles: () => api.get('/asr-studio/files'),
  deleteFiles: (filenames) => api.delete('/asr-studio/files', { data: { filenames } }),
  updateFileStatus: (filename, status) => api.put('/asr-studio/files/status', { filename, status }),
  deleteCompletedFiles: () => api.delete('/asr-studio/files/completed'),
  getFilePlayUrl: (filename) => `/api/asr-studio/files/${encodeURIComponent(filename)}/play`,
  // History (shared)
  getHistory: (params) => api.get('/asr-studio/history', { params }),
  deleteHistoryItem: (id) => api.delete(`/asr-studio/history/${id}`),
  // Output dir (shared)
  getOutputDir: () => api.get('/asr-studio/output-dir'),
  setOutputDir: (dir) => api.put('/asr-studio/output-dir', { output_dir: dir }),
  openOutputDir: (dir) => api.post('/asr-studio/output-dir/open', { output_dir: dir }),
  // Engine
  startEngine: (modelId) => api.post(`/asr-studio/engines/${modelId}/start`),
  stopEngine: (modelId) => api.post(`/asr-studio/engines/${modelId}/stop`),
  getEngineStatus: () => api.get('/asr-studio/engines/status'),
  // Logs
  getLogs: (limit) => api.get(`/asr-studio/logs?limit=${limit || 500}`),
  clearLogs: () => api.delete('/asr-studio/logs'),
};

export const openaiAsrService = {
  transcribe: (file, options = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (options.model) fd.append('model', options.model);
    if (options.language) fd.append('language', options.language);
    if (options.response_format) fd.append('response_format', options.response_format);
    if (options.temperature != null) fd.append('temperature', String(options.temperature));
    if (options.prompt) fd.append('prompt', options.prompt);
    if (options.stream) fd.append('stream', 'true');
    if (options.vad_filter != null) fd.append('vad_filter', String(options.vad_filter));

    if (options.stream) {
      // 直接 fetch 获取 ReadableStream
      return fetch('/v1/audio/transcriptions', {
        method: 'POST',
        body: fd,
        headers: { 'Accept': 'text/event-stream' },
        signal: AbortSignal.timeout?.(7200000),
      });
    }

    return api.post('/v1/audio/transcriptions', fd, {
      timeout: 7200000,
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listModels: () => api.get('/v1/audio/models'),
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
  download: (id, version, runtimeId) => api.post(`/engines/${id}/download`, { version, runtime: runtimeId }),
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
  getTtsLogs: (limit = 500, level = 'all') => api.get(`/system/logs/tts?limit=${limit}&level=${level}`),
  clearLogs: () => api.delete('/system/logs'),
  clearTtsLogs: () => api.delete('/system/logs/tts'),
  getAsrLogs: (limit = 500) => api.get(`/asr-studio/logs?limit=${limit}`),
  clearAsrLogs: () => api.delete('/asr-studio/logs'),
  openFolder: (dirPath) => api.post('/system/storage/open', { dirPath }),
  migrateStorage: (type, targetPath, backup = false) => api.post('/system/storage/migrate', { type, targetPath, backup }),
  restoreStorage: (type) => api.post('/system/storage/restore', { type }),
  getJobStatus: (jobId) => api.get(`/system/storage/job-status/${jobId}`),
  pickFolder: () => api.post('/system/storage/pick-folder', {}, { timeout: 120000 }),
  pickFile: (filter = '*.*') => api.post('/system/storage/pick-file', { filter }, { timeout: 120000 }),
  getCacheInfo: () => api.get('/system/cache'),
  clearCache: (keys) => api.delete('/system/cache', { data: keys ? { keys } : {} })
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

export const multiConnectService = {
  getStatus: () => api.get('/multiconnect/status'),
  checkUSB4: () => api.get('/multiconnect/check-usb4'),
  enable: (port, ip, mask = '255.255.0.0') => api.post('/multiconnect/enable', { port, ip, mask }),
  disable: () => api.post('/multiconnect/disable'),
  getUSBNetworkStatus: () => api.get('/system/usb-network-status'),
  configureUSBNetwork: (ip, mask) => api.post('/system/configure-usb-network', { ip, mask }),
  validateRpcDevice: (device) => api.post('/system/validate-rpc-device', { device })
};

export const ttsStudioService = {
  getReferenceAudios: (params) => api.get('/tts-studio/reference-audios', { params }),
  uploadReferenceAudio: (formData) => api.post('/tts-studio/reference-audios', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getReferenceAudio: (id) => api.get(`/tts-studio/reference-audios/${id}`),
  deleteReferenceAudio: (id) => api.delete(`/tts-studio/reference-audios/${id}`),
  renameReferenceAudio: (id, name) => api.put(`/tts-studio/reference-audios/${id}/rename`, { name }),
  getWorkspaces: () => api.get('/tts-studio/workspaces'),
  createWorkspace: (formData) => api.post('/tts-studio/workspaces', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getWorkspace: (id) => api.get(`/tts-studio/workspaces/${id}`),
  deleteWorkspace: (id) => api.delete(`/tts-studio/workspaces/${id}`),
  cloneWorkspace: (id, data) => api.post(`/tts-studio/workspaces/${id}/clone`, data),
  updateOutputDir: (id, outputDir) => api.put(`/tts-studio/workspaces/${id}/output-dir`, { output_dir: outputDir }),
  getWorkspaceFiles: (id) => api.get(`/tts-studio/workspaces/${id}/files`),
  getFileContent: (id, filename) => api.get(`/tts-studio/workspaces/${id}/files/${encodeURIComponent(filename)}/content`),
  getWorkspaceParams: (id) => api.get(`/tts-studio/workspaces/${id}/params`),
  updateWorkspaceParams: (id, params) => api.put(`/tts-studio/workspaces/${id}/params`, { params }),
  openOutputDir: (id, outputDir) => api.post(`/tts-studio/workspaces/${id}/open-output-dir`, { output_dir: outputDir }),
  openFileInPlayer: (filePath) => api.post('/tts-studio/open-file', { file_path: filePath }),
  uploadWorkspaceFiles: (id, formData) => api.post(`/tts-studio/workspaces/${id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteWorkspaceFiles: (id, filenames) => api.delete(`/tts-studio/workspaces/${id}/files`, { data: { filenames } }),
  updateFileStatus: (id, filename, status) => api.put(`/tts-studio/workspaces/${id}/files/status`, { filename, status }),
  deleteCompletedFiles: (id) => api.delete(`/tts-studio/workspaces/${id}/files/completed`),
  getEngineContracts: () => api.get('/tts-studio/engine-contracts'),
  getEngineRuntimeConfig: (engineType) => api.get('/tts-studio/engine-runtime-config', { params: { engine_type: engineType } }),
  setEngineRuntimeConfig: (engineType, key, value) => api.put('/tts-studio/engine-runtime-config', { engine_type: engineType, key, value }),
  getEngineMemory: (engineType) => api.get('/tts-studio/engine-memory', { params: { engine_type: engineType } }),
  getTtsConfig: () => api.get('/tts-studio/config'),
  setTtsConfig: (config) => api.put('/tts-studio/config', config),
  startEngine: (engineType) => api.post(`/tts-studio/engines/${encodeURIComponent(engineType)}/start`),
  stopEngine: (engineType) => api.post(`/tts-studio/engines/${encodeURIComponent(engineType)}/stop`),
};

export default api;
