import React, { useState, useEffect, useRef } from 'react';
import { Layout, Menu, Card, Form, Input, Switch, Select, Button, Space, message, List, Tag, Progress, Drawer, Popconfirm, Typography, Alert, Table, Checkbox, Tooltip, Spin, Empty, Modal, Skeleton, theme, Badge } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, CheckCircleOutlined, SettingOutlined, AppstoreOutlined, SyncOutlined, DeleteOutlined, HistoryOutlined, ExportOutlined, CopyOutlined, DashboardOutlined, DatabaseOutlined, CloseCircleOutlined, ReloadOutlined, FolderOpenOutlined, SwapOutlined, LinkOutlined, FileTextOutlined, HddOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { configService, updateService, engineService, modelService, systemService, backendService, comfyuiService } from '../../services/api';
const { Header, Content, Sider } = Layout;
const { Option } = Select;
const { Text } = Typography;

/**
 * 全局设置页面
 * 包含：引擎管理、端口配置、更新设置
 */
const GlobalSettings = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [checking, setChecking] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState(() => {
    const menu = new URLSearchParams(location.search).get('menu');
    return menu || 'runtime';
  });

  // 更新相关状态
  const [updateInfo, setUpdateInfo] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [restartCountdown, setRestartCountdown] = useState(5);
  const [autoUpdate, setAutoUpdate] = useState(false);

  // 引擎相关状态
  const [engines, setEngines] = useState({});
  const [versionDrawerVisible, setVersionDrawerVisible] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState(null);
  const [forcePolling, setForcePolling] = useState(false);

  // 从 engines.app 派生下载状态，天然支持刷新恢复
  const appDownloadState = engines['app']?.download_state || null;
  const downloading = appDownloadState?.status === 'downloading';
  const unpacking = appDownloadState?.status === 'unpacking';
  const downloadProgress = appDownloadState?.progress || 0;

  // 导出配置相关状态
  const [exportModels, setExportModels] = useState([]);
  const [exportFileVersion, setExportFileVersion] = useState('1.0');
  const [exportUpdatedAt, setExportUpdatedAt] = useState('');
  const [exportTypes, setExportTypes] = useState(['llm', 'comfyui']);
  const [exportVersionMap, setExportVersionMap] = useState({});
  const [exportJson, setExportJson] = useState('');

  // 运行状态相关
  const [systemInfo, setSystemInfo] = useState(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [stoppingId, setStoppingId] = useState(null);
  const systemTimerRef = useRef(null);

  // 模型存储相关
  const [storage, setStorage] = useState(null);
  const [migrateModal, setMigrateModal] = useState({ open: false, type: null, label: '', size: 0, driveFreeSpace: null, srcPath: '' });
  const [migratePath, setMigratePath] = useState('');
  const [migrateBackup, setMigrateBackup] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState(null); // { progress, copiedBytes, totalBytes, speed }
  const [pickingFolder, setPickingFolder] = useState(false);
  const [restoringType, setRestoringType] = useState(null);
  // step: 'confirm' | 'progress'
  const [restoreModal, setRestoreModal] = useState({ open: false, type: null, label: '', step: 'confirm', junctionTarget: '' });
  const [restoreProgress, setRestoreProgress] = useState(null); // { progress, copiedBytes, totalBytes, speed, sameDrive }

  // 日志相关
  const [logEntries, setLogEntries] = useState([]);
  const [logLevel, setLogLevel] = useState('all');
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const logAutoScrollRef = useRef(true);
  const logContainerRef = useRef(null);
  const logTimerRef = useRef(null);

  // 缓存管理相关
  const [cacheInfo, setCacheInfo] = useState(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(null); // null | 'all' | key

  useEffect(() => {
    loadSettings();
    loadEngines();
    loadExportModels();

    // SSE 监听下载进度
    const es = new EventSource('/api/events');
    es.addEventListener('download-progress', (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        if (data.engineId === 'app' && data.status === 'restarting') {
          setRestarting(true);
        }
      } catch {}
      loadEngines();
    });
    // SSE 断开时，若 app 正在下载/重启中，进入重启等待
    es.onerror = () => {
      setEngines(prev => {
        const appState = prev['app']?.download_state;
        if (appState && ['downloading', 'unpacking', 'restarting'].includes(appState.status)) {
          setRestarting(true);
        }
        return prev;
      });
    };

    return () => es.close();
  }, []);

  // 运行状态定时刷新
  useEffect(() => {
    if (selectedMenu !== 'runtime') {
      if (systemTimerRef.current) clearInterval(systemTimerRef.current);
      return;
    }
    loadSystemInfo();
    systemTimerRef.current = setInterval(loadSystemInfo, 3000);
    return () => {
      if (systemTimerRef.current) clearInterval(systemTimerRef.current);
    };
  }, [selectedMenu]);

  // 切换到存储标签时加载
  useEffect(() => {
    if (selectedMenu === 'storage') loadStorage();
  }, [selectedMenu]);

  // 切换到缓存管理标签时加载
  useEffect(() => {
    if (selectedMenu === 'cache') loadCacheInfo();
  }, [selectedMenu]);

  // 切换到更新标签时自动检查
  useEffect(() => {
    if (selectedMenu === 'update') handleCheckUpdate();
  }, [selectedMenu]);

  // 日志定时刷新
  useEffect(() => {
    if (selectedMenu !== 'logs') {
      if (logTimerRef.current) clearInterval(logTimerRef.current);
      return;
    }
    loadLogs();
    logTimerRef.current = setInterval(loadLogs, 2000);
    return () => {
      if (logTimerRef.current) clearInterval(logTimerRef.current);
    };
  }, [selectedMenu, logLevel]);

  // 有下载进行中时，每 2 秒轮询一次，防止 SSE 事件丢失
  useEffect(() => {
    const hasActiveDownload = Object.values(engines).some(
      e => e.download_state && ['downloading', 'unpacking', 'installing'].includes(e.download_state.status)
    );
    // 一旦检测到真实的 download_state，清除强制轮询标志
    if (hasActiveDownload && forcePolling) setForcePolling(false);
    if (!hasActiveDownload && !forcePolling) return;

    const timer = setInterval(() => loadEngines(), 2000);
    return () => clearInterval(timer);
  }, [engines, forcePolling]);

  // 监听 app 下载状态变化
  useEffect(() => {
    if (appDownloadState?.status === 'restarting') {
      setRestarting(true);
    } else if (appDownloadState?.status === 'failed') {
      message.error(`下载失败: ${appDownloadState.error || '未知错误'}`);
    }
  }, [appDownloadState?.status]);

  // restarting 变为 true 时启动倒计时 + 轮询
  useEffect(() => {
    if (!restarting) return;
    let countdown = 5;
    setRestartCountdown(countdown);
    const countTimer = setInterval(() => {
      countdown--;
      setRestartCountdown(Math.max(0, countdown));
      if (countdown <= 0) clearInterval(countTimer);
    }, 1000);
    const poll = setInterval(async () => {
      try {
        await fetch('/api/health');
        clearInterval(poll);
        clearInterval(countTimer);
        window.location.href = '/';
      } catch {}
    }, 2000);
    return () => { clearInterval(poll); clearInterval(countTimer); };
  }, [restarting]);

  const loadSettings = async () => {
    try {
      const updateResult = await configService.getUpdateSettings();
      const s = updateResult.updateSettings || {};
      const autoCheckVal = s.auto_check ?? false;
      setAutoUpdate(autoCheckVal);
      form.setFieldsValue({
        channel: s.channel || 'stable',
        server_url: s.server_url || ''
      });
    } catch (error) {
      message.error('加载设置失败');
      console.error('Failed to load settings:', error);
    }
  };

  const resolveTtsVariantRow = (engine, variantId) => {
    if (!engine || engine.id !== 'tts' || !variantId || !Array.isArray(engine.variants)) return null;
    const variant = engine.variants.find(v => String(v.id || '').toLowerCase() === String(variantId).toLowerCase());
    if (!variant) return null;

    const matchKey = String(variant.id || '').toLowerCase().replace('indextts', 'index-tts');
    const variantInstalled = (engine.installed_versions || []).filter(v => String(v.version || '').toLowerCase().includes(matchKey));
    const variantBroken = (engine.broken_versions || []).filter(v => String(v.version || '').toLowerCase().includes(matchKey));
    const variantDownloadStates = (engine.download_states || []).filter(s => String(s.targetQuantization || '').toLowerCase().includes(matchKey));

    return {
      ...engine,
      id: `tts:${variant.id}`,
      engine_api_id: 'tts',
      name: `TTS / ${variant.name}`,
      description: `${engine.description}（${variant.name}）`,
      variants: [variant],
      installed: variantInstalled.length > 0,
      installed_versions: variantInstalled,
      broken_versions: variantBroken,
      default_version: variantInstalled[0]?.version || null,
      download_states: variantDownloadStates,
      download_state: variantDownloadStates[0] || null
    };
  };

  const loadEngines = async () => {
    try {
      const result = await engineService.getAll();
      setEngines(result);
      setSelectedEngine(prev => {
        if (!prev) return null;
        if (String(prev.id || '').startsWith('tts:')) {
          const variantId = String(prev.id).split(':')[1];
          return resolveTtsVariantRow(result.tts, variantId) || prev;
        }
        const latest = result[prev.engine_api_id || prev.id];
        return latest ? { ...prev, ...latest } : prev;
      });
    } catch (error) {
      message.error('加载引擎列表失败');
      console.error('Failed to load engines:', error);
    }
  };

  const loadExportModels = async () => {
    try {
      const result = await modelService.getAll();
      const models = (result.models || []).filter(m => m.type === 'llm' || m.type === 'comfyui');
      setExportModels(models);
      const now = new Date().toISOString().slice(0, 19) + 'Z';
      setExportUpdatedAt(now);
      const vmap = {};
      models.forEach(m => { vmap[m.id] = '1.0'; });
      setExportVersionMap(vmap);
    } catch (e) {
      console.error('Failed to load models for export:', e);
    }
  };

  const loadSystemInfo = async () => {
    try {
      setSystemLoading(true);
      const data = await systemService.getInfo();
      setSystemInfo(data);
    } catch (e) {
      console.error('Failed to load system info:', e);
    } finally {
      setSystemLoading(false);
    }
  };

  const loadStorage = async () => {
    try {
      const data = await systemService.getStorage();
      setStorage(data);
    } catch (e) {
      console.error('Failed to load storage:', e);
    }
  };

  const loadCacheInfo = async () => {
    try {
      setCacheLoading(true);
      const data = await systemService.getCacheInfo();
      setCacheInfo(data);
    } catch (e) {
      message.error('加载缓存信息失败');
    } finally {
      setCacheLoading(false);
    }
  };

  const clearBrowserSiteData = async () => {
    const tasks = [];

    tasks.push(Promise.resolve().then(() => {
      localStorage.clear();
      sessionStorage.clear();
    }));

    tasks.push(Promise.resolve().then(() => {
      const hostname = window.location.hostname;
      const domainParts = hostname.split('.').filter(Boolean);
      const domainCandidates = [''];
      for (let i = 0; i < domainParts.length - 1; i++) {
        domainCandidates.push(`.${domainParts.slice(i).join('.')}`);
      }

      const pathCandidates = ['/'];
      const pathnameParts = window.location.pathname.split('/').filter(Boolean);
      let currentPath = '';
      for (const part of pathnameParts) {
        currentPath += `/${part}`;
        pathCandidates.push(currentPath);
      }

      document.cookie.split(';').forEach((entry) => {
        const key = entry.split('=')[0]?.trim();
        if (!key) return;
        for (const path of pathCandidates) {
          document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
          for (const domain of domainCandidates) {
            document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; domain=${domain}`;
          }
        }
      });
    }));

    tasks.push((async () => {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(name => caches.delete(name)));
      }
    })());

    tasks.push((async () => {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister()));
      }
    })());

    tasks.push((async () => {
      if (indexedDB?.databases) {
        const dbs = await indexedDB.databases();
        await Promise.all((dbs || []).map(db => db?.name ? new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        }) : Promise.resolve()));
      }
    })());

    await Promise.allSettled(tasks);
  };

  const handleClearCache = async (keys) => {
    const clearKey = keys ? keys[0] : 'all';
    try {
      setCacheClearing(clearKey);
      await systemService.clearCache(keys || null);
      await clearBrowserSiteData();
      message.success('本地缓存和浏览器站点数据已清除');
      await loadCacheInfo();
    } catch (e) {
      message.error('清除缓存失败');
    } finally {
      setCacheClearing(null);
    }
  };

  const loadLogs = async () => {
    try {
      const data = await systemService.getLogs(500, logLevel);
      setLogEntries(data.logs || []);
      if (logAutoScrollRef.current && logContainerRef.current) {
        setTimeout(() => {
          const el = logContainerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        }, 50);
      }
    } catch (e) {
      // 静默
    }
  };

  const handleClearLogs = async () => {
    try {
      await systemService.clearLogs();
      setLogEntries([]);
      message.success('日志已清空');
    } catch (e) {
      message.error('清空失败');
    }
  };

  const handleDownloadLogs = () => {
    const text = logEntries.map(e =>
      `${new Date(e.timestamp).toLocaleString('zh-CN', { hour12: false })} [${e.level.toUpperCase()}] ${e.message}`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novamax-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenFolder = async (dirPath) => {
    try {
      await systemService.openFolder(dirPath);
    } catch (e) {
      message.error('打开失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleMigrate = async () => {
    if (!migratePath.trim()) {
      message.warning('请输入目标路径');
      return;
    }
    setMigrating(true);
    setMigrateProgress(null);
    try {
      const res = await systemService.migrateStorage(migrateModal.type, migratePath.trim(), migrateBackup);
      const jobId = res.jobId;
      await pollJobStatus(jobId, '迁移', (job) => setMigrateProgress({
        progress: job.progress || 0,
        copiedBytes: job.copiedBytes || 0,
        totalBytes: job.totalBytes || 0,
        speed: job.speed || 0,
        phase: job.phase || 'migrate',
        sameDrive: job.sameDrive || false
      }));
      setMigrateModal({ open: false, type: null, label: '' });
      setMigratePath('');
      setMigrateBackup(false);
      loadStorage();
    } catch (e) {
      message.error(e.response?.data?.error || e.message || '迁移失败');
    } finally {
      setMigrating(false);
      setMigrateProgress(null);
    }
  };

  const handleRestore = async () => {
    const { type, label } = restoreModal;
    setRestoringType(type);
    setRestoreProgress(null);
    setRestoreModal(prev => ({ ...prev, step: 'progress' }));
    try {
      const res = await systemService.restoreStorage(type);
      await pollJobStatus(res.jobId, '还原', (job) => setRestoreProgress({
        progress: job.progress || 0,
        copiedBytes: job.copiedBytes || 0,
        totalBytes: job.totalBytes || 0,
        speed: job.speed || 0,
        sameDrive: job.sameDrive || false
      }));
      loadStorage();
    } catch (e) {
      message.error(e.response?.data?.error || e.message || '还原失败');
    } finally {
      setRestoringType(null);
      setRestoreModal({ open: false, type: null, label: '', step: 'confirm', junctionTarget: '' });
      setRestoreProgress(null);
    }
  };

  /** 轮询后台任务直到完成，成功时 resolve，失败时 reject */
  const pollJobStatus = (jobId, opName, onProgress) => new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const job = await systemService.getJobStatus(jobId);
        if (onProgress) onProgress(job);
        if (job.status === 'success') {
          clearInterval(interval);
          message.success(job.message || `${opName}成功`);
          resolve();
        } else if (job.status === 'failed') {
          clearInterval(interval);
          reject(new Error(job.message || `${opName}失败`));
        }
        // status === 'running' 继续等待
      } catch (e) {
        clearInterval(interval);
        reject(new Error(`查询${opName}状态失败`));
      }
    }, 2000);
  });

  const handleStopProcess = async (proc) => {
    setStoppingId(proc.id);
    try {
      if (proc.category === 'system') {
        message.warning('无法停止 NovaMax 主服务');
        return;
      }
      if (proc.category === 'router') {
        for (const modelId of (proc.modelIds || [])) {
          await backendService.stop(modelId);
        }
      } else if (proc.type === 'comfyui') {
        // ComfyUI 实例 id 格式: comfyui-{instanceId}
        const instanceId = proc.id.replace(/^comfyui-/, '');
        await comfyuiService.stopInstance(instanceId);
      } else {
        await backendService.stop(proc.id);
      }
      message.success(`已停止 ${proc.name}`);
      loadSystemInfo();
    } catch (e) {
      message.error(`停止失败: ${e.response?.data?.error || e.message}`);
    } finally {
      setStoppingId(null);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '-';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}天 ${h}小时`;
    if (h > 0) return `${h}小时 ${m}分钟`;
    return `${m}分钟`;
  };

  const formatDuration = (startTime) => {
    if (!startTime) return '-';
    const sec = Math.floor((Date.now() - startTime) / 1000);
    if (sec < 60) return `${sec}秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}时${m}分`;
  };

  const resolveEngineVersions = (engine) => {
    if (!engine) return [];
    if (Array.isArray(engine.versions) && engine.versions.length > 0) return engine.versions;
    if (Array.isArray(engine.variants)) {
      return engine.variants.flatMap(variant =>
        (variant.versions || []).map(v => ({ ...v, variant_name: variant.name }))
      );
    }
    return [];
  };

  const resolveEngineRows = () => {
    const rows = [];
    for (const engine of Object.values(engines).filter(e => e.category !== 'app')) {
      if (engine.id !== 'tts' || !Array.isArray(engine.variants) || engine.variants.length === 0) {
        rows.push(engine);
        continue;
      }

      for (const variant of engine.variants) {
        const variantVersions = Array.isArray(variant.versions) ? variant.versions : [];
        const variantInstalled = (engine.installed_versions || []).filter(v => String(v.version || '').toLowerCase().includes(String(variant.id || '').toLowerCase().replace('indextts', 'index-tts')));
        const variantBroken = (engine.broken_versions || []).filter(v => String(v.version || '').toLowerCase().includes(String(variant.id || '').toLowerCase().replace('indextts', 'index-tts')));
        const variantDownloadStates = (engine.download_states || []).filter(s => String(s.targetQuantization || '').toLowerCase().includes(String(variant.id || '').toLowerCase().replace('indextts', 'index-tts')));

        rows.push({
          ...engine,
          id: `tts:${variant.id}`,
          engine_api_id: 'tts',
          name: `TTS / ${variant.name}`,
          description: `${engine.description}（${variant.name}）`,
          variants: [variant],
          installed: variantInstalled.length > 0,
          installed_versions: variantInstalled,
          broken_versions: variantBroken,
          default_version: variantInstalled[0]?.version || null,
          download_states: variantDownloadStates,
          download_state: variantDownloadStates[0] || null
        });
      }
    }
    return rows;
  };

  const REMOTE_FIELDS = ['name', 'description', 'modelscope_id', 'quantizations',
    'required_models', 'workflow', 'parameter_mapping', 'mmproj_options', 'files', 'capabilities'];

  const buildExportJson = () => {
    const filtered = exportModels.filter(m => exportTypes.includes(m.type));
    const llm = filtered.filter(m => m.type === 'llm');
    const comfyui = filtered.filter(m => m.type === 'comfyui');

    const toExportModel = (m) => {
      const out = { id: m.id, version: exportVersionMap[m.id] || '1.0' };
      REMOTE_FIELDS.forEach(f => { if (m[f] !== undefined) out[f] = m[f]; });
      // 用户实际配置的参数 → 远端 default_parameters（合并默认参数 + 用户自定义参数）
      const params = m.user_parameters
        ? { ...(m.parameters || {}), ...m.user_parameters }
        : m.parameters;
      if (params !== undefined) out.default_parameters = params;
      // 用户自定义参数映射
      if (m.user_parameter_mapping !== undefined) out.user_parameters = m.user_parameter_mapping;
      return out;
    };

    const result = {
      version: exportFileVersion || '1.0',
      updated_at: exportUpdatedAt,
      models: {}
    };
    if (exportTypes.includes('llm')) result.models.llm = llm.map(toExportModel);
    if (exportTypes.includes('comfyui')) result.models.comfyui = comfyui.map(toExportModel);

    const json = JSON.stringify(result, null, 2);
    setExportJson(json);
    return json;
  };

  const handleCopyExport = () => {
    const json = exportJson || buildExportJson();
    navigator.clipboard.writeText(json).then(() => message.success('已复制到剪贴板'));
  };

  const handleDownloadExport = () => {
    const json = exportJson || buildExportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'models.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCheckUpdate = async () => {
    try {
      setChecking(true);
      const result = await updateService.check();
      if (result.error) {
        message.error(result.error);
        setUpdateInfo(null);
        return;
      }
      setUpdateInfo(result);
      if (result.hasUpdate) {
        message.info(`发现新版本: ${result.latestVersion}`);
      } else {
        message.success(`已是最新版本 (${result.currentVersion})`);
      }
    } catch (error) {
      message.error('检查更新失败');
      setUpdateInfo(null);
      console.error('Failed to check update:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!updateInfo?.engineId || !updateInfo?.version) return;
    try {
      await engineService.download(updateInfo.engineId, updateInfo.version);
    } catch (err) {
      message.error(`启动下载失败: ${err?.response?.data?.error || err.message}`);
    }
  };

  const handleDownloadEngine = async (engineId, version = null) => {
    try {
      const engine = engines[engineId];
      const resolvedVersions = resolveEngineVersions(engine);
      const targetVersion = version || resolvedVersions[0]?.version;
      await engineService.download(engineId, targetVersion);
      // 立即开启强制轮询，防止 download_state 尚未就绪时漏掉状态
      setForcePolling(true);
      // 立即刷新一次，确保主列表拿到 download_state 并启动轮询
      await loadEngines();
    } catch (error) {
      message.error('启动下载失败');
      console.error('Failed to start download:', error);
    }
  };

  const handleUninstall = async (engineId, version) => {
    try {
      await engineService.uninstall(engineId, version);
      message.success(`已卸载 ${version}`);
      try {
        await loadEngines();
      } catch (refreshError) {
        message.warning('卸载完成，但刷新状态失败，请手动刷新');
        console.error('Failed to refresh engine list after uninstall:', refreshError);
      }
    } catch (error) {
      message.error(error?.response?.data?.error || error?.message || '卸载失败');
      console.error('Failed to uninstall:', error);
    }
  };

  const handleReinstall = async (engineId, version) => {
    try {
      const result = await engineService.reinstall(engineId, version);
      message.info(`正在重新安装 ${version}...`);
      // 复用下载进度轮询逻辑
      pollReinstallProgress(result.tasks);
    } catch (error) {
      message.error('重新安装失败');
      console.error('Failed to reinstall:', error);
    }
  };

  const pollReinstallProgress = (tasks) => {
    const interval = setInterval(async () => {
      try {
        const statuses = await Promise.all(
          tasks.map(t => engineService.getDownloadStatus(t.taskId))
        );
        const done = statuses.every(s => s.status === 'completed' || s.status === 'failed');
        if (done) {
          clearInterval(interval);
          const anyFailed = statuses.some(s => s.status === 'failed');
          if (anyFailed) {
            message.error('重新安装失败');
          } else {
            message.success('重新安装完成');
          }
          await loadEngines();
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 1500);
  };

  const openVersionDrawer = (engine) => {
    setSelectedEngine(engine);
    setVersionDrawerVisible(true);
  };

  const renderEnginesContent = () => (
    <Card title="引擎管理" extra={<Button icon={<SyncOutlined />} onClick={loadEngines}>刷新</Button>}>
      <List
        // 过滤掉 category 为 app 由运行状态页面统一管理
        dataSource={resolveEngineRows()}
        renderItem={engine => {
          const downloadStates = engine.download_states || (engine.download_state ? [engine.download_state] : []);
          const activeStates = downloadStates.filter(s => ['downloading', 'unpacking', 'installing'].includes(s.status));
          const isDownloading = activeStates.length > 0;
          const resolvedVersions = resolveEngineVersions(engine);
          const latestVersion = resolvedVersions[0];
          const hasNewerVersion = engine.installed && latestVersion &&
            !engine.installed_versions?.some(v => v.version === latestVersion.version);

          return (
            <List.Item
              actions={[
                isDownloading ? (
                  activeStates.length === 1 ? (
                    <Progress
                      type="circle"
                      percent={activeStates[0].progress || 0}
                      width={40}
                      status="active"
                    />
                  ) : (
                    <Badge count={activeStates.length} color="blue">
                      <Progress
                        type="circle"
                        percent={Math.round(activeStates.reduce((s, x) => s + (x.progress || 0), 0) / activeStates.length)}
                        width={40}
                        status="active"
                      />
                    </Badge>
                  )
                ) : engine.installed ? (
                  <Space>
                    <Tag icon={<CheckCircleOutlined />} color="success">已安装</Tag>
                    <Badge dot={hasNewerVersion} color="orange" offset={[-4, 4]}>
                      <Button
                        icon={<HistoryOutlined />}
                        onClick={() => openVersionDrawer(engine)}
                      >
                        管理版本{hasNewerVersion ? ' · 有新版本' : ''}
                      </Button>
                    </Badge>
                  </Space>
                ) : (
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownloadEngine(engine.engine_api_id || engine.id, latestVersion?.version)}
                  >
                    下载
                  </Button>
                )
              ]}
            >
              <List.Item.Meta
                title={<Space>
                  {engine.name}
                  {engine.default_version && <Tag color="blue">v{engine.default_version}</Tag>}
                </Space>}
                description={
                  <div>
                    <div>{engine.description}</div>
                    {latestVersion && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                        最新版本: {latestVersion.version} ({formatBytes(latestVersion.size)})
                      </div>
                    )}
                    {engine.dependencies?.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                        依赖: {engine.dependencies.join(', ')}
                      </div>
                    )}
                    {engine.installed_versions?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <Space size={4}>
                          {engine.installed_versions.map(v => (
                            <Tag key={v.version} color={v.is_default ? 'blue' : 'default'}>
                              {v.version}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {isDownloading && (
                      <div style={{ marginTop: 8 }}>
                        {activeStates.map(ds => (
                          <div key={ds.targetQuantization} style={{ marginBottom: 4 }}>
                            <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                              {ds.targetQuantization}
                              {ds.status === 'downloading' && ` — 下载中${ds.speed > 0 ? ` ${formatBytes(ds.speed)}/s` : ''}`}
                              {ds.status === 'unpacking' && ' — 解压中...'}
                              {ds.status === 'installing' && ' — 安装中...'}
                            </div>
                            <Progress
                              percent={ds.progress || 0}
                              size="small"
                              status="active"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );

  const renderExportContent = () => {
    const visibleModels = exportModels.filter(m => exportTypes.includes(m.type));

    const columns = [
      {
        title: '模型名称',
        dataIndex: 'name',
        ellipsis: true,
        render: (name, record) => (
          <Tooltip title={record.id}>
            <span>{name}</span>
          </Tooltip>
        )
      },
      {
        title: '类型',
        dataIndex: 'type',
        width: 90,
        render: t => <Tag color={t === 'llm' ? 'blue' : 'purple'}>{t.toUpperCase()}</Tag>
      },
      {
        title: '版本号',
        width: 120,
        render: (_, record) => (
          <Input
            size="small"
            value={exportVersionMap[record.id] || '1.0'}
            onChange={e => {
              setExportVersionMap(prev => ({ ...prev, [record.id]: e.target.value }));
              setExportJson('');
            }}
            style={{ width: 100 }}
          />
        )
      }
    ];

    return (
      <Card title="导出配置" style={{ maxWidth: 900 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">

          {/* 基本信息 */}
          <Card size="small" title="导出信息">
            <Space wrap>
              <Form layout="inline">
                <Form.Item label="文件版本">
                  <Input
                    value={exportFileVersion}
                    onChange={e => { setExportFileVersion(e.target.value); setExportJson(''); }}
                    style={{ width: 100 }}
                    placeholder="1.0"
                  />
                </Form.Item>
                <Form.Item label="更新时间">
                  <Input
                    value={exportUpdatedAt}
                    onChange={e => { setExportUpdatedAt(e.target.value); setExportJson(''); }}
                    style={{ width: 200 }}
                  />
                </Form.Item>
                <Form.Item label="导出范围">
                  <Checkbox.Group
                    value={exportTypes}
                    onChange={v => { setExportTypes(v); setExportJson(''); }}
                    options={[
                      { label: 'LLM', value: 'llm' },
                      { label: 'ComfyUI', value: 'comfyui' }
                    ]}
                  />
                </Form.Item>
              </Form>
            </Space>
          </Card>

          {/* 模型版本号表格 */}
          <Card size="small" title={`模型列表（${visibleModels.length} 个）`}>
            <Table
              dataSource={visibleModels}
              columns={columns}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ y: 300 }}
            />
          </Card>

          {/* 操作按钮 */}
          <Space>
            <Button type="primary" icon={<ExportOutlined />} onClick={buildExportJson}>
              生成预览
            </Button>
            {exportJson && (
              <>
                <Button icon={<CopyOutlined />} onClick={handleCopyExport}>复制</Button>
                <Button icon={<DownloadOutlined />} onClick={handleDownloadExport}>下载 models.json</Button>
              </>
            )}
          </Space>

          {/* JSON 预览 */}
          {exportJson && (
            <Card size="small" title="预览">
              <textarea
                readOnly
                value={exportJson}
                style={{
                  width: '100%',
                  height: 360,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                  padding: 8,
                  resize: 'vertical',
                  background: '#fafafa'
                }}
              />
            </Card>
          )}
        </Space>
      </Card>
    );
  };

  const renderUpdateContent = () => (
    <Card title="更新设置">
      <Form form={form} layout="vertical">
        <Form.Item>
          <Space>
            <span>自动更新</span>
            <Switch
              checked={autoUpdate}
              onChange={async (val) => {
                setAutoUpdate(val);
                await configService.setUpdateSettings({
                  auto_check: val,
                  channel: form.getFieldValue('channel') || 'stable',
                });
              }}
            />
          </Space>
        </Form.Item>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <Form.Item
            label="更新通道"
            name="channel"
            rules={[{ required: true }]}
            style={{ marginBottom: 0 }}
          >
            <Select
              style={{ width: 160 }}
              onChange={async (val) => {
                await configService.setUpdateSettings({
                  auto_check: autoUpdate,
                  channel: val,
                });
                handleCheckUpdate();
              }}
            >
              <Option value="stable">稳定版</Option>
              <Option value="beta">测试版</Option>
            </Select>
          </Form.Item>
          <Button onClick={handleCheckUpdate} loading={checking}>
            检查更新
          </Button>
        </div>
      </Form>

      {updateInfo && (
        <div style={{ marginTop: 16 }}>
          {updateInfo.hasUpdate ? (
            <Alert
              type="info"
              showIcon
              message={`发现新版本 ${updateInfo.latestVersion}`}
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  {updateInfo.releaseNotes && <div>{updateInfo.releaseNotes}</div>}
                  {downloading && (
                    <Progress percent={downloadProgress} status="active" />
                  )}
                  {!downloading && (
                    <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadUpdate}>
                      下载更新
                    </Button>
                  )}
                </Space>
              }
            />
          ) : (
            <Alert type="success" showIcon message={`当前已是最新版本 (${updateInfo.currentVersion})`} />
          )}
        </div>
      )}
    </Card>
  );

  const renderCacheContent = () => (
    <Card title="缓存管理">
      {cacheLoading && !cacheInfo ? (
        <Skeleton active />
      ) : cacheInfo ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <HddOutlined style={{ fontSize: 20, color: '#888' }} />
            <span style={{ fontSize: 15 }}>
              缓存占用：<Text strong>{formatBytes(cacheInfo.totalSize)}</Text>
            </span>
            <Button icon={<ReloadOutlined />} onClick={loadCacheInfo} loading={cacheLoading} size="small">
              刷新
            </Button>
            <Popconfirm
              title="确定要清除全部缓存吗？"
              onConfirm={() => handleClearCache(null)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                icon={<DeleteOutlined />}
                danger
                size="small"
                loading={cacheClearing === 'all'}
                disabled={cacheLoading || cacheInfo.totalSize === 0}
              >
                清除缓存
              </Button>
            </Popconfirm>
          </div>
        </Space>
      ) : (
        <Empty description="加载失败" />
      )}
    </Card>
  );

  const renderRuntimeContent = () => {
    const hw = systemInfo?.hardware;
    const processes = systemInfo?.processes || [];
    const typeColorMap = {
      llm: 'blue', comfyui: 'purple',
      tts: 'green', whisper: 'orange', system: 'default'
    };
    const processColumns = [
      {
        title: '名称', dataIndex: 'name', key: 'name',
        ellipsis: true, width: 200,
        render: (name, record) => (
          <Space>
            <Text strong>{name}</Text>
            {record.category === 'router' && record.modelNames?.length > 0 && (
              <Tooltip title={`已加载: ${record.modelNames.join(', ')}`}>
                <Tag style={{ cursor: 'help' }}>{record.modelNames.length} 模型</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
      {
        title: '类型', dataIndex: 'type', key: 'type', width: 90,
        render: (type) => <Tag color={typeColorMap[type] || 'default'}>{type.toUpperCase()}</Tag>
      },
      {
        title: 'PID', dataIndex: 'pid', key: 'pid', width: 70,
        render: (pid) => <Text type="secondary">{pid || '-'}</Text>
      },
      {
        title: '端口', dataIndex: 'port', key: 'port', width: 70,
        render: (port) => <Tag color="cyan">:{port}</Tag>
      },
      {
        title: '内存', dataIndex: 'memory', key: 'memory', width: 100,
        sorter: (a, b) => (a.memory || 0) - (b.memory || 0),
        render: (mem) => formatBytes(mem)
      },
      {
        title: '运行时长', dataIndex: 'startTime', key: 'startTime', width: 100,
        render: (t) => formatDuration(t)
      },
      {
        title: '操作', key: 'action', width: 80, align: 'center',
        render: (_, record) => (
          record.category === 'system' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>主服务</Text>
          ) : (
            <Popconfirm
              title="确认停止"
              description={`确定要停止 ${record.name} 吗？`}
              onConfirm={() => handleStopProcess(record)}
              okText="停止" cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<CloseCircleOutlined />}
                loading={stoppingId === record.id}>停止</Button>
            </Popconfirm>
          )
        )
      }
    ];

    return (
      <Card title="运行状态">
        {systemLoading && !systemInfo ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                  <Skeleton active paragraph={{ rows: 2 }} />
                </div>
              ))}
            </div>
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16 }}>
              <Skeleton active paragraph={{ rows: 4 }} />
            </div>
          </div>
        ) : (
          <>
            {hw && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
                {/* CPU */}
                <div style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>CPU</div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hw.cpu.model}</div>
                  <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 6 }}>{hw.cpu.cores} 核 · {hw.cpu.speed} MHz</div>
                  <Progress percent={hw.cpu.usagePercent ?? 0} size="small"
                    strokeColor={(hw.cpu.usagePercent ?? 0) > 80 ? '#ff4d4f' : '#1890ff'}
                    format={(p) => `${p}%`} />
                </div>
                {/* RAM */}
                <div style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>内存 (RAM)</div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{formatBytes(hw.memory.used)} / {formatBytes(hw.memory.total)}</div>
                  <Progress percent={hw.memory.usagePercent} size="small"
                    strokeColor={hw.memory.usagePercent > 80 ? '#ff4d4f' : '#1890ff'}
                    format={(p) => `${p}%`} />
                </div>
                {/* VRAM */}
                {hw.gpus && hw.gpus.length > 0 ? (
                  <div style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>显存 (VRAM)</div>
                    {hw.gpus.map((gpu, i) => (
                      <div key={i} style={i > 0 ? { marginTop: 8 } : {}}>
                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gpu.name}</div>
                        {gpu.used != null ? (
                          <>
                            <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>{formatBytes(gpu.used)} / {formatBytes(gpu.total)}</div>
                            <Progress percent={gpu.usagePercent ?? 0} size="small"
                              strokeColor={(gpu.usagePercent ?? 0) > 80 ? '#ff4d4f' : '#722ed1'}
                              format={(p) => `${p}%`} />
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)' }}>容量: {formatBytes(gpu.total)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>显存 (VRAM)</div>
                    <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.25)', marginTop: 8 }}>未检测到 GPU 信息</div>
                  </div>
                )}
                {/* 系统 */}
                <div style={{ padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>系统</div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{hw.hostname}</div>
                  <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)' }}>{hw.platform}/{hw.arch} · 运行 {formatUptime(hw.uptime)}</div>
                </div>
              </div>
            )}
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
                <Space>
                  <Text strong>进程列表</Text>
                  <Tag color={processes.length > 0 ? 'green' : 'default'}>{processes.length} 个进程</Tag>
                </Space>
                <Button type="text" size="small" icon={<ReloadOutlined spin={systemLoading} />}
                  onClick={loadSystemInfo}>刷新</Button>
              </div>
              <Table columns={processColumns} dataSource={processes} rowKey="id"
                size="small" pagination={false} scroll={{ y: 340 }}
                locale={{ emptyText: <Empty description="暂无运行中的进程" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
            </div>
          </>
        )}
      </Card>
    );
  };

  const renderStorageContent = () => {
    const storageItems = storage?.items || [];
    const totalSize = storageItems.reduce((sum, s) => sum + (s.size || 0), 0);

    return (
      <Card title="模型存储">
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">管理各类模型的存储目录，支持迁移到其他磁盘</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>总占用: {formatBytes(totalSize)}</Text>
        </div>
        {storageItems.length === 0 ? (
          <Empty description="加载中..." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {storageItems.map((item) => (
              <div key={item.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <Text strong>{item.label}</Text>
                    <Tag color={item.exists ? 'default' : 'error'} style={{ marginLeft: 8 }}>{formatBytes(item.size)}</Tag>
                    {item.isJunction && (
                      <>
                        <Tooltip title={`Junction → ${item.junctionTarget}`}>
                          <Tag color="blue" icon={<LinkOutlined />}>已迁移</Tag>
                        </Tooltip>
                        <Tag
                          color="orange"
                          style={{ cursor: restoringType ? 'not-allowed' : 'pointer' }}
                          icon={restoringType === item.type ? <SyncOutlined spin /> : undefined}
                          onClick={() => !restoringType && setRestoreModal({
                            open: true, type: item.type, label: item.label,
                            step: 'confirm', junctionTarget: item.junctionTarget
                          })}
                        >
                          还原
                        </Tag>
                      </>
                    )}
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: item.path }}>
                    {item.isJunction ? item.junctionTarget : item.path}
                  </Text>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', gap: 8, marginLeft: 16 }}>
                  <Button size="small" icon={<FolderOpenOutlined />} disabled={!item.exists}
                    onClick={() => handleOpenFolder(item.path)}>打开</Button>
                  <Button size="small" icon={<SwapOutlined />} disabled={!item.exists}
                    onClick={() => { setMigrateModal({ open: true, type: item.type, label: item.label, size: item.size, driveFreeSpace: item.driveFreeSpace, srcPath: item.path }); setMigratePath(''); setMigrateBackup(false); }}>迁移</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  };

  const renderLogsContent = () => {
    const levelColors = { info: '#1890ff', warn: '#faad14', error: '#ff4d4f' };
    return (
      <Card title="系统日志" extra={
        <Space>
          <Select value={logLevel} onChange={setLogLevel} size="small" style={{ width: 100 }}>
            <Option value="all">全部</Option>
            <Option value="info">INFO</Option>
            <Option value="warn">WARN</Option>
            <Option value="error">ERROR</Option>
          </Select>
          <Checkbox checked={logAutoScroll} onChange={e => { setLogAutoScroll(e.target.checked); logAutoScrollRef.current = e.target.checked; }}>
            自动滚动
          </Checkbox>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={async () => {
            try { await backendService.openLogsFolder(); } catch { message.error('打开失败'); }
          }}>日志文件夹</Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadLogs}>刷新</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleDownloadLogs} disabled={logEntries.length === 0}>下载</Button>
          <Popconfirm title="确认清空所有日志？" onConfirm={handleClearLogs} okText="清空" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>清空</Button>
          </Popconfirm>
        </Space>
      }>
        <div
          ref={logContainerRef}
          style={{
            height: 'calc(100vh - 220px)',
            overflow: 'auto',
            background: '#1e1e1e',
            borderRadius: 6,
            padding: '12px 16px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.6
          }}
        >
          {logEntries.length === 0 ? (
            <div style={{ color: '#666', textAlign: 'center', paddingTop: 40 }}>暂无日志</div>
          ) : (
            logEntries.map((entry, i) => (
              <div key={i} style={{ color: levelColors[entry.level] || '#d4d4d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <span style={{ color: '#888' }}>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                {' '}
                <span style={{ color: levelColors[entry.level], fontWeight: entry.level === 'error' ? 600 : 400 }}>
                  [{entry.level.toUpperCase()}]
                </span>
                {' '}{entry.message}
              </div>
            ))
          )}
        </div>
      </Card>
    );
  };

  const renderContent = () => {
    switch (selectedMenu) {
      case 'runtime': return renderRuntimeContent();
      case 'logs':    return renderLogsContent();
      case 'engines': return renderEnginesContent();
      case 'storage': return renderStorageContent();
      case 'cache':   return renderCacheContent();
      case 'export':  return renderExportContent();
      case 'update':  return renderUpdateContent();
      default:        return null;
    }
  };

  const renderVersionDrawer = () => (
    <Drawer
      title={`${selectedEngine?.name} - 版本管理`}
      placement="right"
      width={600}
      open={versionDrawerVisible}
      onClose={() => setVersionDrawerVisible(false)}
    >
      {selectedEngine && (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 已安装版本列表 */}
          <Card size="small" title="已安装版本">
            <Alert
              message="版本说明"
              description="默认使用版本号最高的版本。如需使用特定版本，请在模型设置中配置。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <List
              dataSource={[
                ...(selectedEngine.installed_versions || []).map(v => ({ ...v, broken: false })),
                ...(selectedEngine.broken_versions || []).map(v => ({ ...v, broken: true }))
              ]}
              locale={{ emptyText: '暂无已安装版本' }}
              renderItem={(version, index) => (
                <List.Item
                  actions={[
                    version.broken ? (
                      <Tag color="error">安装不完整</Tag>
                    ) : index === 0 ? (
                      <Tag color="green">最新版本</Tag>
                    ) : null,
                    <Button
                      size="small"
                      icon={<SyncOutlined />}
                      onClick={() => handleReinstall(selectedEngine.engine_api_id || selectedEngine.id, version.version)}
                    >
                      重装
                    </Button>,
                    <Popconfirm
                      title="确认卸载"
                      description={`确定要卸载版本 ${version.version} 吗？`}
                      onConfirm={() => handleUninstall(selectedEngine.engine_api_id || selectedEngine.id, version.version)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button danger size="small" icon={<DeleteOutlined />}>卸载</Button>
                    </Popconfirm>
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    title={<Text strong>{version.version}</Text>}
                    description={
                      <Space direction="vertical" size={0}>
                        {version.installed_at && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            安装时间: {new Date(version.installed_at).toLocaleString('zh-CN')}
                          </Text>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          路径: {version.path}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 下载新版本 */}
          <Card size="small" title="可用版本">
            <List
              dataSource={resolveEngineVersions(selectedEngine)}
              renderItem={version => {
                const isInstalled = selectedEngine.installed_versions?.some(
                  v => v.version === version.version
                );
                const allDs = selectedEngine.download_states || (selectedEngine.download_state ? [selectedEngine.download_state] : []);
                const ds = allDs.find(s => s.targetQuantization === version.version);
                const isThisDownloading = ds && ['downloading', 'unpacking', 'installing'].includes(ds.status);
                return (
                  <List.Item
                    actions={[
                      isThisDownloading ? (
                        <Progress
                          type="circle"
                          percent={ds.progress || 0}
                          width={36}
                          status="active"
                        />
                      ) : isInstalled ? (
                        <Tag color="success">已安装</Tag>
                      ) : (
                        <Button
                          type="primary"
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => {
                            handleDownloadEngine(selectedEngine.engine_api_id || selectedEngine.id, version.version);
                          }}
                        >
                          下载
                        </Button>
                      )
                    ]}
                  >
                    <List.Item.Meta
                      title={version.version}
                      description={
                        isThisDownloading ? (
                          <div style={{ fontSize: 12, color: '#888' }}>
                            {ds.status === 'downloading' && `下载中${ds.speed > 0 ? ` · ${formatBytes(ds.speed)}/s` : ''}`}
                            {ds.status === 'unpacking' && '解压中...'}
                            {ds.status === 'installing' && '安装中...'}
                          </div>
                        ) : `大小: ${formatBytes(version.size)}`
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Space>
      )}
    </Drawer>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {(restarting || unpacking) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16
        }}>
          <Spin size="large" />
          <span style={{ color: '#fff', fontSize: 16 }}>
            {restarting
              ? `更新完成，应用将在 ${restartCountdown} 秒后重启...`
              : '正在解压安装，即将重启...'}
          </span>
        </div>
      )}
      <Header style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid #f0f0f0'
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ marginRight: 16 }}
        >
          返回
        </Button>
        <h2 style={{ margin: 0 }}>全局设置</h2>
      </Header>

      <Layout>
        <Sider width={200} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedMenu]}
            onClick={({ key }) => setSelectedMenu(key)}
            style={{ height: '100%', borderRight: 0 }}
            items={[
              { key: 'runtime', icon: <DashboardOutlined />, label: '运行状态' },
              { key: 'logs',    icon: <FileTextOutlined />,  label: '系统日志' },
              { key: 'storage', icon: <DatabaseOutlined />, label: '模型存储' },
              { key: 'engines', icon: <AppstoreOutlined />, label: '引擎管理' },
              { key: 'cache',   icon: <HddOutlined />,      label: '缓存管理' },
              { key: 'export',  icon: <ExportOutlined />,   label: '导出配置' },
              { key: 'update',  icon: <SyncOutlined />,     label: '更新设置' }
            ]}
          />
        </Sider>

        <Content style={{ padding: 24, minHeight: 280 }}>
          {renderContent()}
        </Content>
      </Layout>

      {renderVersionDrawer()}

      {/* 迁移确认弹窗 */}
      <Modal
        title={`迁移 ${migrateModal.label}`}
        open={migrateModal.open}
        onCancel={() => !migrating && setMigrateModal({ open: false, type: null, label: '' })}
        onOk={handleMigrate}
        okText="开始迁移"
        cancelText="取消"
        confirmLoading={migrating}
        okButtonProps={{
          danger: true,
          disabled: (() => {
            const p = migratePath.trim();
            if (!p || !/^[a-zA-Z]:[\\\/]/.test(p)) return true;
            if (/[*?"<>|]/.test(p.slice(3))) return true;
            if (migrateBackup && migrateModal.driveFreeSpace != null && migrateModal.size > migrateModal.driveFreeSpace) return true;
            return false;
          })()
        }}
        cancelButtonProps={{ disabled: migrating }}
        closable={!migrating}
        maskClosable={!migrating}
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">
            将模型文件移动到新位置，并在原路径创建目录联接（mklink /J），程序无需修改即可正常使用。
          </Text>
        </div>
        {migrating && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4 }}>
            <Text style={{ color: '#d46b08', fontSize: 13 }}>
              正在迁移中，请耐心等待，文件较大时可能需要数分钟甚至更长时间，请勿关闭程序...
            </Text>
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <Text strong>目标路径:</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="例如: D:\novastudio\llm"
            value={migratePath}
            onChange={(e) => setMigratePath(e.target.value)}
            onPressEnter={handleMigrate}
            style={{ flex: 1 }}
            status={migratePath.trim() && !/^[a-zA-Z]:[\\\/]/.test(migratePath.trim()) ? 'error' : ''}
          />
          <Button icon={<FolderOpenOutlined />}
            loading={pickingFolder}
            disabled={migrating}
            onClick={async () => {
              setPickingFolder(true);
              try {
                const res = await systemService.pickFolder();
                if (!res.cancelled && res.path) {
                  setMigratePath(res.path);
                }
              } catch (e) {
                message.error('打开文件夹选择器失败');
              } finally {
                setPickingFolder(false);
              }
            }}>
            浏览
          </Button>
        </div>
        {migratePath.trim() && !/^[a-zA-Z]:[\\\/]/.test(migratePath.trim()) && (
          <div style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 12, color: '#ff4d4f' }}>
              请输入合法的 Windows 绝对路径，例如 D:\novastudio\llm
            </Text>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Text type="warning" style={{ fontSize: 12 }}>
            注意: 迁移过程中请勿关闭程序，大文件可能需要较长时间。目标路径必须为空目录或不存在的路径。
          </Text>
        </div>
        <div style={{ marginTop: 12 }}>
          <Checkbox
            checked={migrateBackup}
            onChange={e => setMigrateBackup(e.target.checked)}
            disabled={migrating}
          >
            迁移前备份原数据
          </Checkbox>
          {migrateBackup && (() => {
            const notEnough = migrateModal.driveFreeSpace != null && migrateModal.size > migrateModal.driveFreeSpace;
            return (
              <div style={{ marginTop: 4 }}>
                {notEnough ? (
                  <Text style={{ fontSize: 12, color: '#ff4d4f' }}>
                    源磁盘空间不足：备份需要 {(migrateModal.size / 1024 ** 3).toFixed(2)} GB，当前剩余 {(migrateModal.driveFreeSpace / 1024 ** 3).toFixed(2)} GB
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: '#888' }}>
                    备份将保存至：{migrateModal.srcPath}_bak_xxx（与源目录同级），迁移完成后可手动删除
                  </Text>
                )}
              </div>
            );
          })()}
        </div>
        {migrating && (
          <div style={{ marginTop: 16 }}>
            {migrateProgress?.sameDrive ? (
              <div style={{ color: '#1677ff', fontSize: 13 }}>正在重命名目录（同盘迁移，无需复制数据）...</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                  {migrateProgress?.phase === 'backup' ? '正在备份...' : '正在迁移...'}
                </div>
                <Progress
                  percent={migrateProgress?.progress || 0}
                  status={migrateProgress?.progress >= 100 ? 'success' : 'active'}
                  strokeColor={{ from: '#108ee9', to: '#87d068' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: '#888' }}>
                    {migrateProgress
                      ? `${(migrateProgress.copiedBytes / 1024 ** 3).toFixed(2)} GB / ${(migrateProgress.totalBytes / 1024 ** 3).toFixed(2)} GB`
                      : '正在准备...'}
                  </Text>
                  {migrateProgress?.speed > 0 && (
                    <Text style={{ fontSize: 12, color: '#888' }}>
                      {migrateProgress.speed >= 1024 ** 2
                        ? `${(migrateProgress.speed / 1024 ** 2).toFixed(1)} MB/s`
                        : `${(migrateProgress.speed / 1024).toFixed(0)} KB/s`}
                    </Text>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 还原弹窗（确认 + 进度两步合一，无 Popconfirm 冲突） */}
      <Modal
        title={restoreModal.step === 'confirm' ? `确认还原 ${restoreModal.label}` : `正在还原 ${restoreModal.label}`}
        open={restoreModal.open}
        onCancel={restoreModal.step === 'confirm' ? () => setRestoreModal({ open: false, type: null, label: '', step: 'confirm', junctionTarget: '' }) : undefined}
        closable={restoreModal.step === 'confirm'}
        maskClosable={restoreModal.step === 'confirm'}
        footer={restoreModal.step === 'confirm' ? [
          <Button key="cancel" onClick={() => setRestoreModal({ open: false, type: null, label: '', step: 'confirm', junctionTarget: '' })}>取消</Button>,
          <Button key="ok" danger type="primary" onClick={handleRestore}>确认还原</Button>
        ] : null}
      >
        {restoreModal.step === 'confirm' ? (
          <div style={{ padding: '8px 0' }}>
            <Text>确定要将 <Text strong>{restoreModal.label}</Text> 还原到原路径吗？</Text>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>文件将从 {restoreModal.junctionTarget} 移回原位置。</Text>
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px 0 16px' }}>
            {restoreProgress?.sameDrive ? (
              <div style={{ color: '#1677ff', fontSize: 13 }}>正在重命名目录（同盘还原，无需复制数据）...</div>
            ) : (
              <>
                <Progress
                  percent={restoreProgress?.progress || 0}
                  status={(restoreProgress?.progress || 0) >= 100 ? 'success' : 'active'}
                  strokeColor={{ from: '#108ee9', to: '#87d068' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ fontSize: 13, color: '#555' }}>
                    {restoreProgress
                      ? `${(restoreProgress.copiedBytes / 1024 ** 3).toFixed(2)} GB / ${(restoreProgress.totalBytes / 1024 ** 3).toFixed(2)} GB`
                      : '正在准备...'}
                  </Text>
                  {restoreProgress?.speed > 0 && (
                    <Text style={{ fontSize: 13, color: '#555' }}>
                      {restoreProgress.speed >= 1024 ** 2
                        ? `${(restoreProgress.speed / 1024 ** 2).toFixed(1)} MB/s`
                        : `${(restoreProgress.speed / 1024).toFixed(0)} KB/s`}
                    </Text>
                  )}
                </div>
              </>
            )}
            <div style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
              正在将文件移回原路径，请耐心等待，请勿关闭程序...
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default GlobalSettings;
