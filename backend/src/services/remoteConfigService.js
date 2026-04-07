import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { DATA_DIR, PROJECT_ROOT } from '../config/constants.js';
import { writeJSON } from '../utils/fileHelper.js';
import configManager from './configManager.js';
import modelManager from './modelManager.js';
import engineManager from './engineManager.js';

// 用户可自定义字段（同版本 sync 时保留）
const USER_FIELDS = [
  'selected_quantization', 'user_parameter_mapping',
  'downloaded_files', 'downloaded_quantizations',
  'local_path'
];

// 远程控制字段（版本升级时从远端覆盖）
const REMOTE_FIELDS = [
  'name', 'description', 'modelscope_id', 'quantizations',
  'required_models', 'workflow', 'parameter_mapping', 'default_parameters',
  'mmproj_options', 'capabilities'
];

/**
 * 把远端字段映射到本地存储字段
 * 远端用 default_parameters，本地存 parameters
 */
function mapRemoteToLocal(remoteFields) {
  const local = { ...remoteFields };
  if (local.default_parameters !== undefined) {
    local.parameters = local.default_parameters;
    delete local.default_parameters;
  }
  return local;
}


function getServerUrl() {
  const channel = getChannel(); // stable | beta | dev
  const channelKey = `REMOTE_SERVER_URL_${channel.toUpperCase()}`;
  return process.env[channelKey] || process.env.REMOTE_SERVER_URL_STABLE || 'https://www.firstarpc.com/download/novamax/';
}

function getChannel() {
  const config = configManager.get();
  return config?.update_settings?.channel || 'stable';
}

/**
 * 比较版本号，返回 1 / 0 / -1
 */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

/**
 * 拉取并合并远程模型列表（LLM + ComfyUI）
 * 返回 { added, updated }
 */
async function syncModels() {
  const serverUrl = getServerUrl();
  const modelsPath = process.env.REMOTE_MODELS_PATH || 'models.json';
  const url = `${serverUrl}${modelsPath}`;

  let remoteData;
  try {
    const res = await axios.get(url, { timeout: 10000 });
    remoteData = res.data;
  } catch (err) {
    console.warn(`[remoteConfig] 拉取远程模型配置失败: ${err.message}`);
    return { added: 0, updated: 0 };
  }

  const remoteModels = remoteData?.models || {};
  let added = 0;
  let updated = 0;

  for (const type of ['llm', 'comfyui']) {
    const list = remoteModels[type] || [];
    for (const remoteModel of list) {
      const { id, version: remoteVersion, ...remoteFields } = remoteModel;
      if (!id) continue;

      const existing = modelManager.getAll().find(m => m.id === id);

      if (!existing) {
        // 新增
        await modelManager.create(type, {
          id,
          ...mapRemoteToLocal(remoteFields),
          source: 'remote',
          remote_version: remoteVersion,
          remote_snapshot: remoteFields
        });
        added++;
      } else if (existing.source === 'local') {
        // 用户手动添加，跳过
        continue;
      } else {
        // source === 'remote'
        const cmp = compareVersions(remoteVersion, existing.remote_version);
        if (cmp > 0) {
          // 版本升级：强制覆盖所有远程控制字段
          const overwrite = {};
          REMOTE_FIELDS.forEach(f => {
            if (remoteFields[f] !== undefined) overwrite[f] = remoteFields[f];
          });
          const localOverwrite = mapRemoteToLocal(overwrite);
          localOverwrite.remote_version = remoteVersion;
          localOverwrite.remote_snapshot = remoteFields;
          await modelManager.update(id, localOverwrite);
          updated++;
        } else {
          // 同版本：只刷新非用户字段
          const refresh = {};
          REMOTE_FIELDS.forEach(f => {
            if (remoteFields[f] !== undefined) refresh[f] = remoteFields[f];
          });
          await modelManager.update(id, mapRemoteToLocal(refresh));
        }
      }
    }
  }

  // 同步后重新计算推荐量化版本，确保新增/更新的模型有 selected_quantization
  if (added > 0 || updated > 0) {
    await modelManager._recalcRecommendations();
  }

  console.log(`[remoteConfig] 模型同步完成: 新增 ${added}, 更新 ${updated}`);
  return { added, updated };
}

/**
 * 拉取并更新远程引擎定义
 */
async function syncEngines() {
  const serverUrl = getServerUrl();
  const enginesPath = process.env.REMOTE_ENGINES_PATH || 'engines.json';
  const url = `${serverUrl}${enginesPath}`;

  let remoteData;
  try {
    const res = await axios.get(url, { timeout: 10000 });
    remoteData = res.data;
  } catch (err) {
    console.warn(`[remoteConfig] 拉取远程引擎配置失败: ${err.message}`);
    return false;
  }

  if (!remoteData?.engines) {
    console.warn('[remoteConfig] 远程引擎配置格式无效');
    return false;
  }

  const enginesFilePath = path.join(DATA_DIR, 'engines.json');
  await writeJSON(enginesFilePath, remoteData);
  engineManager.reload(remoteData);
  console.log('[remoteConfig] 引擎配置已更新');
  return true;
}

/**
 * 检查软件更新
 * 返回 { hasUpdate, currentVersion, latestVersion, releaseNotes, engineId, version }
 */
async function checkUpdate() {
  // 读取当前版本
  let currentVersion = '0.0.0';
  try {
    const pkgPath = path.join(PROJECT_ROOT, 'backend', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    currentVersion = pkg.version || '0.0.0';
  } catch (e) {
    console.warn('[remoteConfig] 无法读取 package.json 版本');
  }

  // 确保引擎配置最新，失败则直接返回错误
  const synced = await syncEngines();
  if (!synced) {
    return { hasUpdate: false, currentVersion, error: '无法连接更新服务器' };
  }

  const appEngine = engineManager.getEngine('app');
  if (!appEngine?.versions?.length) {
    return { hasUpdate: false, currentVersion };
  }

  const latest = appEngine.versions[0];
  const latestVersion = latest.version;
  const minVersion = latest.min_version || '0.0.0';

  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    && compareVersions(currentVersion, minVersion) >= 0;

  // 更新最后检查时间
  const config = configManager.get();
  await configManager.set('update_settings', {
    ...config.update_settings,
    last_check: new Date().toISOString()
  });

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseNotes: latest.release_notes || '',
    engineId: 'app',
    version: latestVersion
  };
}

export default { syncModels, syncEngines, checkUpdate };
