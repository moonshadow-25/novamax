/**
 * NovaAirouter 服务注册
 *
 * 在 NovaMax 启动时将 OpenAI 兼容 TTS 端点注册到分布式网关，
 * 并定期发送心跳保持健康状态。
 *
 * 配置：
 *   Admin API 端口: 15049
 *   业务路由端口:   15050
 *   NovaMax 端口:   3001
 */

import axios from 'axios';

const REGISTRAR_HOST = '127.0.0.1';
const REGISTRAR_PORT = 15049;
const BASE_URL = `http://${REGISTRAR_HOST}:${REGISTRAR_PORT}`;

const ENDPOINTS = [
  { service_path: '3001/v1/audio/speech', node_path: '/v1/audio/speech', max_concurrent: 2 },
  { service_path: '3001/v1/audio/models', node_path: '/v1/audio/models', max_concurrent: 100 },
  { service_path: '3001/v1/audio/voices', node_path: '/v1/audio/voices', max_concurrent: 100 },
];

const HEARTBEAT_INTERVAL = 5000;

class NovaAirouterRegistrar {
  constructor() {
    this.serviceId = null;
    this.heartbeatTimer = null;
  }

  async init() {
    try {
      await this._register();
      console.log(`[NovaAirouter] 已注册 ${ENDPOINTS.length} 个 TTS 端点 (并发限制: 2)`);
      this._startHeartbeat();
    } catch (e) {
      console.warn(`[NovaAirouter] 注册失败（网关可能未启动）: ${e.message}`);
    }
  }

  async _register() {
    const { data } = await axios.post(`${BASE_URL}/v1/endpoints`, ENDPOINTS, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });
    this.serviceId = data.service_id;
    return data;
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(async () => {
      try {
        await axios.post(`${BASE_URL}/v1/heartbeat`, {
          service_id: this.serviceId,
          healthy: true,
        }, { timeout: 3000 });
      } catch (e) {
        // 心跳静默失败，网关会在 30s 后自动清理
      }
    }, HEARTBEAT_INTERVAL);
    // 允许 Node 退出（不阻止进程关闭）
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  async dispose() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.serviceId) {
      try {
        await axios.delete(`${BASE_URL}/v1/endpoints`, {
          params: { service_id: this.serviceId },
          timeout: 5000,
        });
        console.log('[NovaAirouter] 已取消注册 TTS 端点');
      } catch (e) {
        // 静默失败
      }
    }
  }
}

export default new NovaAirouterRegistrar();
