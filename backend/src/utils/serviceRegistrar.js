/**
 * serviceRegistrar.js
 *
 * 负责向 NovaAirouter 网关注册/注销本机 LLM 服务端点，并维持心跳。
 *
 * 工作流程：
 *   1. 调用 registerChatCompletionService(port) 或 registerEmbeddingsService(port)
 *      → 向网关 Admin API (POST /v1/endpoints) 注册端点
 *      → 获取 service_id 后启动定时心跳（每 5 秒一次）
 *   2. 服务运行期间持续发送心跳，防止网关将端点标记为不健康
 *   3. 服务停止时调用 stopServiceRegistration(port, isEmbedding)
 *      → 停止心跳定时器
 *      → 向网关发送 DELETE /v1/endpoints?service_id=xxx 主动注销
 *   4. 主进程退出时调用 deregisterAllServices()
 *      → 批量注销所有已注册端点（allSettled，单个失败不影响其他）
 *
 * 网关心跳规则（参考 REGISTRATION.md）：
 *   - 注册后 5 秒内必须发送第一次心跳，否则端点被标记为不健康
 *   - 超过 15 秒未收到心跳 → 标记为不健康
 *   - 再超过 15 秒（共 30 秒）→ 端点被自动删除
 *
 * 环境变量：
 *   SERVICE_ADMIN_PORT  网关 Admin 端口，默认 15049
 */

import axios from 'axios';

/** 网关 Admin API 地址 */
const ADMIN_PORT = parseInt(process.env.SERVICE_ADMIN_PORT || '15049', 10);
const ADMIN_URL = `http://127.0.0.1:${ADMIN_PORT}`;

/** 心跳间隔（ms），必须小于网关 15 秒超时阈值 */
const HEARTBEAT_INTERVAL = 5000;

/** 是否输出心跳成功日志（默认关闭，避免刷屏） */
const HEARTBEAT_LOG_ENABLED = String(process.env.SERVICE_HEARTBEAT_LOG || '').toLowerCase() === 'true';

/**
 * 已注册服务的本地缓存。
 * key: "<port>:<nodePath>"，value: serviceInfo 对象
 * @type {Map<string, {port: number, nodePath: string, servicePath: string, serviceId: string|null, heartbeatTimer: NodeJS.Timeout|null}>}
 */
const registeredServices = new Map();

/**
 * 向网关发送一次心跳，表示服务健康。
 */
async function sendHeartbeat(serviceId) {
  if (!serviceId) {
    throw new Error('Missing service_id for heartbeat');
  }
  await axios.post(`${ADMIN_URL}/v1/heartbeat`, {
    service_id: serviceId,
    healthy: true
  }, {
    timeout: 5000,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 启动心跳定时器，每隔 HEARTBEAT_INTERVAL 毫秒发送一次心跳。
 * 注意：setInterval 首次触发在延迟后执行，因此注册成功后必须保证
 * HEARTBEAT_INTERVAL 不超过网关健康检查阈值（15 秒），否则服务可能
 * 会因未及时上报健康而被标记为不健康。
 * @param {string} serviceId
 * @returns {NodeJS.Timeout} 定时器句柄，用于后续 clearInterval
 */
function startHeartbeat(serviceId) {
  const timer = setInterval(async () => {
    try {
      await sendHeartbeat(serviceId);
      if (HEARTBEAT_LOG_ENABLED) {
        // eslint-disable-next-line no-console
        console.log(`[service-registrar] Heartbeat sent for ${serviceId}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[service-registrar] Heartbeat failed for ${serviceId}: ${error.message}`);
    }
  }, HEARTBEAT_INTERVAL);

  return timer;
}

/**
 * 注册 LLM 服务端点（Chat Completion 或 Embeddings）。
 * 若同一 port+类型已注册，直接返回缓存的 serviceInfo，不重复注册。
 * 注册成功后自动启动心跳。
 *
 * @param {number} port          LLM 服务监听的本地端口
 * @param {boolean} isEmbedding  true → 注册 /v1/embeddings，false → 注册 /v1/chat/completions
 * @returns {Promise<object|null>} serviceInfo，失败时返回 null（不抛出，避免中断主流程）
 */
/**
 * 批量注册一组端点，共享一个 service_id。
 * @param {number} port
 * @param {Array<{nodePath: string, maxConcurrent: number}>} endpoints
 * @param {string} cacheKey - 本地缓存 key 前缀（如 "chat" 或 "embedding"）
 * @returns {Promise<object|null>}
 */
async function registerEndpoints(port, endpoints, cacheKey) {
  const key = `${port}:${cacheKey}`;

  if (registeredServices.has(key)) {
    return registeredServices.get(key);
  }

  const payload = endpoints.map(ep => ({
    service_path: `${port}${ep.nodePath}`,
    node_path: ep.nodePath,
    max_concurrent: ep.maxConcurrent
  }));

  try {
    const response = await axios.post(`${ADMIN_URL}/v1/endpoints`, payload, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    });

    const serviceId = response.data?.service_id;
    if (!serviceId) {
      throw new Error('Admin registration returned no service_id');
    }

    const serviceInfo = { port, endpoints, serviceId, heartbeatTimer: null };
    serviceInfo.heartbeatTimer = startHeartbeat(serviceId);
    registeredServices.set(key, serviceInfo);

    const paths = endpoints.map(e => e.nodePath).join(', ');
    console.log(`[service-registrar] Registered [${paths}] on port ${port} (concurrent: ${endpoints.map(e => e.maxConcurrent).join(',')}), service_id=${serviceId}`);
    return serviceInfo;
  } catch (error) {
    console.warn(`[service-registrar] Failed to register endpoints on port ${port}: ${error.message}`);
    return null;
  }
}

/** 注册 Chat Completion 端点（/v1/chat/completions + /v1/models + /v1/messages） */
export function registerChatCompletionService(port, maxConcurrent = 1) {
  return registerEndpoints(port, [
    { nodePath: '/v1/chat/completions', maxConcurrent },
    { nodePath: '/v1/models', maxConcurrent: 100 },
    { nodePath: '/v1/messages', maxConcurrent },
  ], 'chat');
}

/** 注册 Embeddings 端点（/v1/embeddings + /v1/models） */
export function registerEmbeddingsService(port, maxConcurrent = 1) {
  return registerEndpoints(port, [
    { nodePath: '/v1/embeddings', maxConcurrent },
    { nodePath: '/v1/models', maxConcurrent: 100 },
  ], 'embedding');
}

/** 返回当前所有已注册服务的快照列表 */
export function getRegisteredServices() {
  return Array.from(registeredServices.values());
}

/**
 * 确保指定端口+类型已注册；若本地缓存缺失则自动补注册。
 */
export async function ensureServiceRegistration(port, isEmbedding = false) {
  const cacheKey = isEmbedding ? 'embedding' : 'chat';
  const key = `${port}:${cacheKey}`;
  if (registeredServices.has(key)) {
    return registeredServices.get(key);
  }
  if (isEmbedding) {
    return registerEmbeddingsService(port);
  }
  return registerChatCompletionService(port);
}

/**
 * 向网关发送 DELETE 请求，主动注销指定 service_id 下的所有端点。
 */
async function deregisterEndpoint(serviceId) {
  await axios.delete(`${ADMIN_URL}/v1/endpoints?service_id=${encodeURIComponent(serviceId)}`, {
    timeout: 5000
  });
}

/**
 * 停止指定端口+类型的服务注册。
 */
export async function stopServiceRegistration(port, isEmbedding = false) {
  const cacheKey = isEmbedding ? 'embedding' : 'chat';
  const key = `${port}:${cacheKey}`;
  const info = registeredServices.get(key);
  if (!info) return false;
  if (info.heartbeatTimer) clearInterval(info.heartbeatTimer);
  registeredServices.delete(key);
  if (info.serviceId) {
    try {
      await deregisterEndpoint(info.serviceId);
      console.log(`[service-registrar] Deregistered service_id=${info.serviceId}`);
    } catch (error) {
      console.warn(`[service-registrar] Deregister failed for service_id=${info.serviceId}: ${error.message}`);
    }
  }
  return true;
}

/**
 * 批量注销所有已注册服务，用于主进程退出时的清理。
 */
export async function deregisterAllServices() {
  const services = Array.from(registeredServices.values());
  await Promise.allSettled(
    services.map(async (info) => {
      if (info.heartbeatTimer) clearInterval(info.heartbeatTimer);
      if (info.serviceId) {
        try {
          await deregisterEndpoint(info.serviceId);
          console.log(`[service-registrar] Deregistered service_id=${info.serviceId}`);
        } catch (error) {
          console.warn(`[service-registrar] Deregister failed for service_id=${info.serviceId}: ${error.message}`);
        }
      }
    })
  );
  registeredServices.clear();
}
