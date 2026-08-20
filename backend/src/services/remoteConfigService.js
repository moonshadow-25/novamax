import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { DATA_DIR, PROJECT_ROOT } from '../config/constants.js';
import { writeJSON } from '../utils/fileHelper.js';
import configManager from './configManager.js';
import modelManager from './modelManager.js';
import engineManager from './engineManager.js';
import {
  BUILD_VARIANT,
  REMOTE_SERVER_URL_STABLE,
  REMOTE_SERVER_URL_BETA,
  REMOTE_MODELS_PATH,
  REMOTE_ENGINES_PATH,
} from '../config/appConfig.js';
import eventBus from './eventBus.js';

// 用户可自定义字段（同版本 sync 时保留）
const USER_FIELDS = [
  'selected_quantization', 'user_parameter_mapping',
  'downloaded_files', 'downloaded_quantizations',
  'local_path',
  'engine_path', 'asr_config', 'whisper_config', 'path'
];

// 远程控制字段（版本升级时从远端覆盖）
const REMOTE_FIELDS = [
  'name', 'description', 'modelscope_id', 'quantizations',
  'required_models', 'workflow', 'parameter_mapping', 'default_parameters',
  'mmproj_options', 'selected_mmproj', 'dflash_options', 'selected_dflash', 'capabilities',
  'models', 'config', 'backend', 'model_type',
  'engine_id', 'engine_version'
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


const CHANNEL_URLS = {
  stable: REMOTE_SERVER_URL_STABLE,
  beta:   REMOTE_SERVER_URL_BETA,
};

function getServerUrl() {
  const channel = getChannel();
  return CHANNEL_URLS[channel] || REMOTE_SERVER_URL_STABLE;
}

function getChannel() {
  const config = configManager.get();
  // 正式版默认 stable，测试版默认 beta
  const defaultChannel = BUILD_VARIANT === 'beta' ? 'beta' : 'stable';
  return config?.update_settings?.channel || defaultChannel;
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
 * 拉取并合并远程模型列表（LLM + ComfyUI + TTS + Whisper）
 * 返回 { added, updated }
 */
async function syncModels() {
  const serverUrl = getServerUrl();
  const modelsPath = REMOTE_MODELS_PATH;
  const url = `${serverUrl}${modelsPath}`;

  let remoteData;
  try {
    const res = await axios.get(url, { timeout: 5000 });
    remoteData = res.data;
  } catch (err) {
    console.warn(`[remoteConfig] 拉取远程模型配置失败: ${err.message}，尝试读取本地 models.json`);
    let localModelsPath = path.join(DATA_DIR, 'models.json');
    if (!fs.existsSync(localModelsPath)) {
      localModelsPath = path.join(PROJECT_ROOT, 'models.json');
    }
    if (fs.existsSync(localModelsPath)) {
      try {
        remoteData = JSON.parse(fs.readFileSync(localModelsPath, 'utf-8'));
        console.log('[remoteConfig] 已从本地 models.json 加载模型配置');
      } catch (e) {
        console.warn(`[remoteConfig] 读取本地 models.json 失败: ${e.message}`);
        return { added: 0, updated: 0 };
      }
    } else {
      return { added: 0, updated: 0 };
    }
  }

  const remoteModels = remoteData?.models || {};
  let added = 0;
  let updated = 0;

  try {
    for (const type of ['llm', 'comfyui', 'tts', 'asr', 'ocr']) {
      const list = remoteModels[type] || (type === 'asr' ? remoteModels['whisper'] : null) || [];
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
            localOverwrite.modelscope_refreshed = false; // 官方版本升级，清除手动刷新标记
            await modelManager.update(id, localOverwrite);
            updated++;
          } else {
            // 同版本：只刷新非用户字段
            // 如果用户已通过 ModelScope 手动刷新过，跳过 quantizations/mmproj_options/files
            // 避免用 models.json 的旧 SHA256 覆盖刚从 ModelScope 拉取的最新数据
            const skipFileFields = !!existing.modelscope_refreshed;
            const refresh = {};
            REMOTE_FIELDS.forEach(f => {
              if (skipFileFields && (f === 'quantizations' || f === 'mmproj_options' || f === 'dflash_options')) return;
              if (remoteFields[f] !== undefined) refresh[f] = remoteFields[f];
            });
            const localRefresh = mapRemoteToLocal(refresh);
            if (skipFileFields) delete localRefresh.files;

            // 保留用户本地字段（包括 ASR 的本地配置）
            USER_FIELDS.forEach(f => {
              if (existing[f] !== undefined) localRefresh[f] = existing[f];
            });

            await modelManager.update(id, localRefresh);
          }
        }
      }
    }

    // 同步后重新计算推荐量化版本，确保新增/更新的模型有 selected_quantization
    if (added > 0 || updated > 0) {
      await modelManager._recalcRecommendations();
    }
  } catch (err) {
    console.warn(`[remoteConfig] 模型合并失败: ${err.message}`);
  }

  console.log(`[remoteConfig] 模型同步完成: 新增 ${added}, 更新 ${updated}`);
  return { added, updated };
}

/**
 * 拉取并更新远程引擎定义
 * 返回 { changed: boolean, engines: object|null }
 */
async function syncEngines() {
  const serverUrl = getServerUrl();
  const enginesPath = REMOTE_ENGINES_PATH;
  const url = `${serverUrl}${enginesPath}`;

  let remoteData;
  let fromLocal = false;
  try {
    const res = await axios.get(url, { timeout: 5000 });
    remoteData = res.data;
  } catch (err) {
    console.warn(`[remoteConfig] 拉取远程引擎配置失败: ${err.message}，使用本地 engines.json`);
    const localPath = path.join(DATA_DIR, 'engines.json');
    if (fs.existsSync(localPath)) {
      try {
        remoteData = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
        fromLocal = true;
      } catch (e) {
        console.warn(`[remoteConfig] 读取本地 engines.json 失败: ${e.message}`);
        return { changed: false, engines: null };
      }
    } else {
      return { changed: false, engines: null };
    }
  }

  if (!remoteData?.engines) {
    console.warn('[remoteConfig] 引擎配置格式无效');
    return { changed: false, engines: null };
  }

  // 检测变更：与当前内存中的引擎定义做内容比较
  const prev = engineManager.engines;
  let changed = !fromLocal && (!prev || JSON.stringify(prev) !== JSON.stringify(remoteData));

  if (fromLocal) {
    engineManager.reload(remoteData);
    console.log('[remoteConfig] 引擎配置已加载（本地缓存）');
  } else {
    const enginesFilePath = path.join(DATA_DIR, 'engines.json');
    await writeJSON(enginesFilePath, remoteData);
    engineManager.reload(remoteData);
    console.log('[remoteConfig] 引擎配置已更新（远程）');
  }

  // 引擎定义发生变化时广播事件，驱动前端刷新 banner
  if (changed) {
    eventBus.broadcast('engines-updated', {});
  }

  return { changed, engines: remoteData.engines || null };
}

/**
 * 同步引擎 + 模型（供手动触发的 /remote-config/sync 使用）
 * 返回 { models: { added, updated }, engines: { changed } }
 */
async function syncAll() {
  const [models, engines] = await Promise.all([syncModels(), syncEngines()]);
  return { models, engines };
}

/** 定时同步间隔（毫秒）：30 分钟 */
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
let _periodicTimer = null;

/**
 * 启动定时同步，周期性从远端拉取 models.json 与 engines.json。
 * 只在未启动时建立；返回一个清理函数。
 */
function startPeriodicSync(intervalMs = SYNC_INTERVAL_MS) {
  if (_periodicTimer) {
    return () => {};
  }

  const tick = async () => {
    // 两个同步彼此独立：单个失败不影响另一个，也不影响下一轮定时
    try {
      await syncModels();
    } catch (err) {
      console.warn('[remoteConfig] 定时同步 models 失败:', err.message);
    }
    try {
      await syncEngines();
    } catch (err) {
      console.warn('[remoteConfig] 定时同步 engines 失败:', err.message);
    }
  };

  _periodicTimer = setInterval(tick, intervalMs);
  if (_periodicTimer.unref) _periodicTimer.unref();
  console.log(`[remoteConfig] 已启动定时同步（每 ${Math.round(intervalMs / 60000)} 分钟）`);
  return () => {
    if (_periodicTimer) {
      clearInterval(_periodicTimer);
      _periodicTimer = null;
    }
  };
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
  if (!synced?.engines) {
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

export default { syncModels, syncEngines, syncAll, checkUpdate, startPeriodicSync };
