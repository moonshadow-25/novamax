/** 统一引擎状态映射：与后端 tts-studio.js ENGINE_STATUS_MAP 对齐 */
export const ENGINE_STATUS_MAP = {
  running:  { label: '引擎运行中', color: '#52c41a' },
  busy:     { label: '引擎生成中', color: '#fa8c16' },
  starting: { label: '引擎启动中', color: '#1890ff' },
  idle:     { label: '引擎空闲',   color: '#d9d9d9' },
  error:    { label: '引擎异常',   color: '#ff4d4f' },
};
