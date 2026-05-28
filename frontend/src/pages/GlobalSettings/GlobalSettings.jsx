import React, { useState, useEffect, useRef } from 'react';
import { Layout, Menu, Card, Form, Input, Switch, Select, Button, Space, message, List, Tag, Progress, Drawer, Popconfirm, Typography, Alert, Table, Checkbox, Tooltip, Spin, Empty, Modal, Skeleton, theme, Badge, Tabs, Collapse } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, CheckCircleOutlined, SettingOutlined, AppstoreOutlined, SyncOutlined, DeleteOutlined, HistoryOutlined, ExportOutlined, CopyOutlined, DashboardOutlined, DatabaseOutlined, CloseCircleOutlined, ReloadOutlined, FolderOpenOutlined, SwapOutlined, LinkOutlined, FileTextOutlined, HddOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { configService, updateService, engineService, modelService, systemService, backendService, comfyuiService, ttsStudioService } from '../../services/api';
import { resolveVersionOrder, getLatestInstalledVersion as getLatestInstalledVersionByAvailable } from '../../services/engineVersionOrder';
import { normalizeEngineType } from '../../utils/engineType';
import './GlobalSettings.css';
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
  const { t } = useTranslation('globalSettings');
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
  const [engineRuntimeSelections, setEngineRuntimeSelections] = useState({}); // { 'engineId::variantId': 'runtimeId' }

  // 从 engines.app 派生下载状态，天然支持刷新恢复
  const appDownloadState = engines['app']?.download_state || null;
  const downloading = appDownloadState?.status === 'downloading';
  const unpacking = appDownloadState?.status === 'unpacking';
  const downloadProgress = appDownloadState?.progress || 0;

  // 导出配置相关状态
  const [exportModels, setExportModels] = useState([]);
  const [exportFileVersion, setExportFileVersion] = useState('1.0');
  const [exportUpdatedAt, setExportUpdatedAt] = useState('');
  const [exportTypes, setExportTypes] = useState(['llm', 'comfyui', 'whisper', 'tts']);
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
  const [logLoading, setLogLoading] = useState(false);
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const logAutoScrollRef = useRef(true);
  const logContainerRef = useRef(null);
  const logTimerRef = useRef(null);
  const [logTab, setLogTab] = useState('system');
  const [ttsLogEntries, setTtsLogEntries] = useState([]);
  const [ttsLogLevel, setTtsLogLevel] = useState('all');
  const [ttsLogLoading, setTtsLogLoading] = useState(false);
  const [ttsLogAutoScroll, setTtsLogAutoScroll] = useState(true);
  const ttsLogAutoScrollRef = useRef(true);
  const ttsLogContainerRef = useRef(null);

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

  // 日志定时刷新（setTimeout 递归，避免请求堆积；仅拉取当前激活 Tab）
  useEffect(() => {
    if (selectedMenu !== 'logs') {
      clearTimeout(logTimerRef.current);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      if (logTab === 'system') {
        await loadLogs();
      } else {
        await loadTtsLogs();
      }
      if (!cancelled) logTimerRef.current = setTimeout(poll, 2000);
    };

    if (logTab === 'system') loadLogs(); else loadTtsLogs();
    logTimerRef.current = setTimeout(poll, 2000);

    return () => { cancelled = true; clearTimeout(logTimerRef.current); };
  }, [selectedMenu, logTab, logLevel, ttsLogLevel]);

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
      message.error(t('messages.downloadFailed', { error: appDownloadState.error || t('common.unknownError') }));
    }
  }, [appDownloadState?.status]);

  const [restartTimedOut, setRestartTimedOut] = useState(false);

  // restarting 变为 true 时启动倒计时 + 轮询
  useEffect(() => {
    if (!restarting) {
      setRestartTimedOut(false);
      return;
    }
    const MAX_WAIT = 60; // 最大等待 60 秒
    let countdown = 5;
    let elapsed = 0;
    setRestartCountdown(countdown);
    setRestartTimedOut(false);
    const countTimer = setInterval(() => {
      countdown--;
      setRestartCountdown(Math.max(0, countdown));
      if (countdown <= 0) clearInterval(countTimer);
    }, 1000);
    const poll = setInterval(async () => {
      elapsed += 2;
      if (elapsed >= MAX_WAIT) {
        clearInterval(poll);
        clearInterval(countTimer);
        setRestartTimedOut(true);
        return;
      }
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
      message.error(t('messages.loadSettingsFailed'));
      console.error('Failed to load settings:', error);
    }
  };

  const resolveTtsVariantRow = (engine, variantId) => {
    if (!engine || engine.id !== 'tts' || !variantId || !Array.isArray(engine.variants)) return null;
    const variant = engine.variants.find(v => String(v.id || '').toLowerCase() === String(variantId).toLowerCase());
    if (!variant) return null;

    const variantNorm = normalizeEngineType(variant.id);
    const variantInstalled = (engine.installed_versions || []).filter(v => normalizeEngineType(v.version).includes(variantNorm));
    const variantBroken = (engine.broken_versions || []).filter(v => normalizeEngineType(v.version).includes(variantNorm));
    const variantDownloadStates = (engine.download_states || []).filter(s => normalizeEngineType(s.targetQuantization || '').includes(variantNorm));

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
      message.error(t('messages.loadEnginesFailed'));
      console.error('Failed to load engines:', error);
    }
  };

  const loadExportModels = async () => {
    try {
      const result = await modelService.getAll();
      const models = (result.models || []).filter(m => ['llm', 'comfyui', 'whisper', 'tts'].includes(m.type));
      setExportModels(models);
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00';
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
      message.error(t('messages.loadCacheInfoFailed'));
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
      message.success(t('messages.cacheCleared'));
      await loadCacheInfo();
    } catch (e) {
      message.error(t('messages.clearCacheFailed'));
    } finally {
      setCacheClearing(null);
    }
  };

  const loadLogs = async () => {
    try {
      setLogLoading(true);
      const data = await systemService.getLogs(500, logLevel);
      setLogEntries(data.logs || []);
      if (logAutoScrollRef.current && logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    } catch (e) {
      // 静默
    } finally {
      setLogLoading(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      await systemService.clearLogs();
      setLogEntries([]);
      message.success(t('messages.logsCleared'));
    } catch (e) {
      message.error(t('messages.clearLogsFailed'));
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

  const loadTtsLogs = async () => {
    try {
      setTtsLogLoading(true);
      const data = await systemService.getTtsLogs(500, ttsLogLevel);
      setTtsLogEntries(data.logs || []);
      if (ttsLogAutoScrollRef.current && ttsLogContainerRef.current) {
        ttsLogContainerRef.current.scrollTop = ttsLogContainerRef.current.scrollHeight;
      }
    } catch {
      // 静默
    } finally {
      setTtsLogLoading(false);
    }
  };

  const handleClearTtsLogs = async () => {
    try {
      await systemService.clearTtsLogs();
      setTtsLogEntries([]);
      message.success('TTS 日志已清空');
    } catch { message.error('清空失败'); }
  };

  const handleDownloadTtsLogs = () => {
    const text = ttsLogEntries.map(e =>
      `${new Date(e.timestamp).toLocaleString('zh-CN', { hour12: false })} [${e.level.toUpperCase()}] ${e.message}`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novamax-tts-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenFolder = async (dirPath) => {
    try {
      await systemService.openFolder(dirPath);
    } catch (e) {
      message.error(t('messages.openFailedWithReason', { reason: e.response?.data?.error || e.message }));
    }
  };

  const handleMigrate = async () => {
    if (!migratePath.trim()) {
      message.warning(t('migrate.inputTargetPath'));
      return;
    }
    setMigrating(true);
    setMigrateProgress(null);
    try {
      const res = await systemService.migrateStorage(migrateModal.type, migratePath.trim(), migrateBackup);
      const jobId = res.jobId;
      await pollJobStatus(jobId, t('migrate.operationName'), (job) => setMigrateProgress({
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
      message.error(e.response?.data?.error || e.message || t('migrate.failed'));
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
      await pollJobStatus(res.jobId, t('restore.operationName'), (job) => setRestoreProgress({
        progress: job.progress || 0,
        copiedBytes: job.copiedBytes || 0,
        totalBytes: job.totalBytes || 0,
        speed: job.speed || 0,
        sameDrive: job.sameDrive || false
      }));
      loadStorage();
    } catch (e) {
      message.error(e.response?.data?.error || e.message || t('restore.failed'));
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
          message.success(job.message || `${opName}${t('common.successSuffix')}`);
          resolve();
        } else if (job.status === 'failed') {
          clearInterval(interval);
          reject(new Error(job.message || `${opName}${t('common.failedSuffix')}`));
        }
        // status === 'running' 继续等待
      } catch (e) {
        clearInterval(interval);
        reject(new Error(t('common.queryStatusFailed', { name: opName })));
      }
    }, 2000);
  });

  const handleStopProcess = async (proc) => {
    setStoppingId(proc.id);
    try {
      if (proc.category === 'system') {
        message.warning(t('runtime.cannotStopMainService'));
        return;
      }
      if (proc.id.startsWith('tts-engine-')) {
        // TTS 引擎：调用 stopEngine
        const engineType = proc.id.replace('tts-engine-', '');
        await ttsStudioService.stopEngine(engineType);
      } else if (proc.category === 'router') {
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
      message.success(t('runtime.stoppedProcess', { name: proc.name }));
      loadSystemInfo();
    } catch (e) {
      message.error(t('runtime.stopFailed', { reason: e.response?.data?.error || e.message }));
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
    if (d > 0) return t('runtime.uptimeDayHour', { days: d, hours: h });
    if (h > 0) return t('runtime.uptimeHourMinute', { hours: h, minutes: m });
    return t('runtime.uptimeMinute', { minutes: m });
  };

  const formatDuration = (startTime) => {
    if (!startTime) return '-';
    const sec = Math.floor((Date.now() - startTime) / 1000);
    if (sec < 60) return t('runtime.durationSecond', { seconds: sec });
    if (sec < 3600) return t('runtime.durationMinuteSecond', { minutes: Math.floor(sec / 60), seconds: sec % 60 });
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return t('runtime.durationHourMinute', { hours: h, minutes: m });
  };

  const resolveEngineVersions = (engine) => {
    if (!engine) return [];
    if (Array.isArray(engine.versions) && engine.versions.length > 0) return engine.versions;
    if (Array.isArray(engine.variants)) {
      return engine.variants.flatMap(variant =>
        (variant.versions || []).map(v => ({
          ...v,
          variant_id: variant.id,
          variant_name: variant.name
        }))
      );
    }
    return [];
  };

  const getLatestInstalledVersion = (engine) => {
    if (!engine) return null;
    const availableVersions = resolveEngineVersions(engine);
    return getLatestInstalledVersionByAvailable(availableVersions, engine.installed_versions || []);
  };

  const getOrderedInstalledVersions = (engine) => {
    if (!engine) return [];
    const availableVersions = resolveEngineVersions(engine);
    const availableVersionMap = new Map(
      availableVersions.map(version => [String(version?.version || ''), version])
    );
    const installedAndBroken = [
      ...(engine.installed_versions || []).map(v => ({ ...v, broken: false })),
      ...(engine.broken_versions || []).map(v => ({ ...v, broken: true }))
    ].map(version => {
      const matchedAvailable = availableVersionMap.get(String(version?.version || ''));
      return matchedAvailable
        ? {
            ...version,
            variant_id: version.variant_id || matchedAvailable.variant_id,
            variant_name: version.variant_name || matchedAvailable.variant_name
          }
        : version;
    });

    return resolveVersionOrder(availableVersions, installedAndBroken).orderedInstalledVersions;
  };

  const getVersionVariantGroups = (engine, versions = []) => {
    if (!engine || !Array.isArray(engine.variants) || engine.variants.length === 0) return null;

    const variantMap = new Map(
      engine.variants.map(variant => [
        String(variant.id || '').toLowerCase(),
        {
          key: variant.id,
          id: variant.id,
          name: variant.name || variant.id,
          versions: []
        }
      ])
    );

    const groups = [];
    const fallbackGroup = {
      key: '__ungrouped__',
      id: '__ungrouped__',
      name: t('engines.other'),
      versions: []
    };

    for (const version of versions) {
      const variantId = String(version?.variant_id || '').toLowerCase();
      const directGroup = variantId ? variantMap.get(variantId) : null;
      if (directGroup) {
        directGroup.versions.push(version);
        continue;
      }

      const matchedGroup = engine.variants.find(variant => {
        const markers = [
          String(variant.id || '').toLowerCase(),
          String(variant.name || '').toLowerCase()
        ].filter(Boolean);
        const versionText = String(version?.version || '').toLowerCase();
        const variantText = String(version?.variant_name || '').toLowerCase();
        return markers.some(marker => versionText.includes(marker) || variantText.includes(marker));
      });

      if (matchedGroup) {
        variantMap.get(String(matchedGroup.id || '').toLowerCase())?.versions.push(version);
      } else {
        fallbackGroup.versions.push(version);
      }
    }

    for (const variant of engine.variants) {
      const group = variantMap.get(String(variant.id || '').toLowerCase());
      if (group?.versions.length) groups.push(group);
    }

    if (fallbackGroup.versions.length) groups.push(fallbackGroup);
    return groups.length > 0 ? groups : null;
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
        const variantNorm2 = normalizeEngineType(variant.id);
        const variantInstalled = (engine.installed_versions || []).filter(v => normalizeEngineType(v.version).includes(variantNorm2));
        const variantBroken = (engine.broken_versions || []).filter(v => normalizeEngineType(v.version).includes(variantNorm2));
        const variantDownloadStates = (engine.download_states || []).filter(s => normalizeEngineType(s.targetQuantization || '').includes(variantNorm2));

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
    const whisper = filtered.filter(m => m.type === 'whisper');
    const tts = filtered.filter(m => m.type === 'tts');

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
      const activeDownloadedPreset = (m.downloaded_files || []).find(f => f.is_active)?.matched_preset || null;
      const effectiveSelectedQuantization = m.selected_quantization || activeDownloadedPreset;
      if (effectiveSelectedQuantization) out.selected_quantization = effectiveSelectedQuantization;
      return out;
    };

    const result = {
      version: exportFileVersion || '1.0',
      updated_at: exportUpdatedAt,
      models: {}
    };
    if (exportTypes.includes('llm')) result.models.llm = llm.map(toExportModel);
    if (exportTypes.includes('comfyui')) result.models.comfyui = comfyui.map(toExportModel);
    if (exportTypes.includes('whisper')) result.models.whisper = whisper.map(toExportModel);
    if (exportTypes.includes('tts')) result.models.tts = tts.map(toExportModel);

    const json = JSON.stringify(result, null, 2);
    setExportJson(json);
    return json;
  };

  const handleCopyExport = () => {
    const json = exportJson || buildExportJson();
    navigator.clipboard.writeText(json).then(() => message.success(t('export.copied')));
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
        message.info(t('update.newVersionFoundWithColon', { version: result.latestVersion }));
      } else {
        message.success(t('update.latestVersionShort', { version: result.currentVersion }));
      }
    } catch (error) {
      message.error(t('messages.checkUpdateFailed'));
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
      message.error(t('messages.downloadStartFailedWithReason', { reason: err?.response?.data?.error || err.message }));
    }
  };

  const handleDownloadEngine = async (engineId, version = null, runtimeId = null) => {
    try {
      const engine = engines[engineId];
      const resolvedVersions = resolveEngineVersions(engine);
      const targetVersion = version || resolvedVersions[0]?.version;
      await engineService.download(engineId, targetVersion, runtimeId);
      // 立即开启强制轮询，防止 download_state 尚未就绪时漏掉状态
      setForcePolling(true);
      // 立即刷新一次，确保主列表拿到 download_state 并启动轮询
      await loadEngines();
    } catch (error) {
      message.error(t('messages.downloadStartFailed'));
      console.error('Failed to start download:', error);
    }
  };

  const handleUninstall = async (engineId, version) => {
    try {
      await engineService.uninstall(engineId, version);
      message.success(t('engines.uninstalled', { version }));
      try {
        await loadEngines();
      } catch (refreshError) {
        message.warning(t('engines.uninstalledButRefreshFailed'));
        console.error('Failed to refresh engine list after uninstall:', refreshError);
      }
    } catch (error) {
      message.error(error?.response?.data?.error || error?.message || t('engines.uninstallFailed'));
      console.error('Failed to uninstall:', error);
    }
  };

  const handleReinstall = async (engineId, version) => {
    try {
      const result = await engineService.reinstall(engineId, version);
      message.info(t('engines.reinstalling', { version }));
      // 复用下载进度轮询逻辑
      pollReinstallProgress(result.tasks);
    } catch (error) {
      message.error(t('engines.reinstallFailed'));
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
            message.error(t('engines.reinstallFailed'));
          } else {
            message.success(t('engines.reinstallCompleted'));
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
    <>
    <div className="gs-section-head">
      <span className="gs-section-title">{t('sections.engines')}</span>
      <Button icon={<SyncOutlined />} onClick={loadEngines}>{t('common.refresh')}</Button>
    </div>
    <div className="gs-section-body">
    <Card className="gs-section-card">
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

          const isTts = (engine.id === 'tts' || engine.engine_api_id === 'tts');
          const latestVariantId = latestVersion?.variant_id;
          const latestVariant = latestVariantId && Array.isArray(engine.variants)
            ? engine.variants.find(v => v.id === latestVariantId)
            : null;
          const variantRuntimes = latestVariant?.runtimes || [];
          const runtimeKey = `${engine.engine_api_id || engine.id}::${latestVariantId || 'default'}`;
          const selectedRuntime = engineRuntimeSelections[runtimeKey] || variantRuntimes[0]?.id;

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
                ) : (
                  <Space>
                    {!isDownloading && isTts && variantRuntimes.length > 0 && (
                      <Select
                        size="small"
                        value={selectedRuntime}
                        onChange={val => setEngineRuntimeSelections(prev => ({ ...prev, [runtimeKey]: val }))}
                        style={{ width: 180 }}
                        placeholder="运行时环境"
                      >
                        {variantRuntimes.map(rt => (
                          <Option key={rt.id} value={rt.id}>{rt.name}</Option>
                        ))}
                      </Select>
                    )}
                    {engine.installed ? (
                      hasNewerVersion ? (
                        <Button
                          type="primary"
                          icon={<SyncOutlined />}
                          onClick={() => handleDownloadEngine(engine.engine_api_id || engine.id, latestVersion?.version, selectedRuntime)}
                        >
                          更新
                        </Button>
                      ) : (
                        <Space>
                          <Tag icon={<CheckCircleOutlined />} color="success">{t('engines.installed')}</Tag>
                          <Badge dot={hasNewerVersion} color="orange" offset={[-4, 4]}>
                            <Button
                              icon={<HistoryOutlined />}
                              onClick={() => openVersionDrawer(engine)}
                            >
                              {t('engines.manageVersions')}
                            </Button>
                          </Badge>
                        </Space>
                      )
                    ) : (
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownloadEngine(engine.engine_api_id || engine.id, latestVersion?.version, selectedRuntime)}
                      >
                        {t('engines.download')}
                      </Button>
                    )}
                  </Space>
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
                        {t('engines.latestVersion')}: {latestVersion.version} ({formatBytes(latestVersion.size)})
                      </div>
                    )}
                    {engine.dependencies?.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                        {t('engines.dependencies')}: {engine.dependencies.join(', ')}
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
                              {ds.status === 'downloading' && t('engines.downloadingWithSpeed', { speed: ds.speed > 0 ? ` ${formatBytes(ds.speed)}/s` : '' })}
                              {ds.status === 'unpacking' && t('engines.unpacking')}
                              {ds.status === 'installing' && t('engines.installing')}
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
    </div>
    </>
  );

  const renderExportContent = () => {
    const visibleModels = exportModels.filter(m => exportTypes.includes(m.type));

    const columns = [
      {
        title: t('export.modelName'),
        dataIndex: 'name',
        ellipsis: true,
        render: (name, record) => (
          <Tooltip title={record.id}>
            <span>{name}</span>
          </Tooltip>
        )
      },
      {
        title: t('export.type'),
        dataIndex: 'type',
        width: 90,
        render: t => <Tag color={t === 'llm' ? 'blue' : 'purple'}>{t.toUpperCase()}</Tag>
      },
      {
        title: t('export.version'),
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
      <>
      <div className="gs-section-head">
        <span className="gs-section-title">{t('sections.export')}</span>
      </div>
      <div className="gs-section-body">
      <Card className="gs-section-card" style={{ maxWidth: 900 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">

          {/* 基本信息 */}
          <Card size="small" title={t('export.exportInfo')}>
            <Space wrap>
              <Form layout="inline">
                <Form.Item label={t('export.fileVersion')}>
                  <Input
                    value={exportFileVersion}
                    onChange={e => { setExportFileVersion(e.target.value); setExportJson(''); }}
                    style={{ width: 100 }}
                    placeholder="1.0"
                  />
                </Form.Item>
                <Form.Item label={t('export.updatedAt')}>
                  <Input
                    value={exportUpdatedAt}
                    onChange={e => { setExportUpdatedAt(e.target.value); setExportJson(''); }}
                    style={{ width: 200 }}
                  />
                </Form.Item>
                <Form.Item label={t('export.scope')}>
                  <Checkbox.Group
                    value={exportTypes}
                    onChange={v => { setExportTypes(v); setExportJson(''); }}
                    options={[
                      { label: 'LLM', value: 'llm' },
                      { label: 'ComfyUI', value: 'comfyui' },
                      { label: 'Whisper', value: 'whisper' },
                      { label: 'TTS', value: 'tts' }
                    ]}
                  />
                </Form.Item>
              </Form>
            </Space>
          </Card>

          {/* 模型版本号表格 */}
          <Card size="small" title={t('export.modelList', { count: visibleModels.length })}>
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
              {t('export.generatePreview')}
            </Button>
            {exportJson && (
              <>
                <Button icon={<CopyOutlined />} onClick={handleCopyExport}>{t('common.copy')}</Button>
                <Button icon={<DownloadOutlined />} onClick={handleDownloadExport}>{t('export.downloadModelsJson')}</Button>
              </>
            )}
          </Space>

          {/* JSON 预览 */}
          {exportJson && (
            <Card size="small" title={t('export.preview')}>
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
      </div>
      </>
    );
  };

  const renderUpdateContent = () => (
    <>
    <div className="gs-section-head">
      <span className="gs-section-title">{t('sections.update')}</span>
    </div>
    <div className="gs-section-body">
    <Card className="gs-section-card">
      <Form form={form} layout="vertical">
        <Form.Item>
          <Space>
            <span>{t('update.autoUpdate')}</span>
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
            label={t('update.channel')}
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
              <Option value="stable">{t('update.stable')}</Option>
              <Option value="beta">{t('update.beta')}</Option>
            </Select>
          </Form.Item>
          <Button onClick={handleCheckUpdate} loading={checking}>
            {t('update.check')}
          </Button>
        </div>
      </Form>

      {updateInfo && (
        <div style={{ marginTop: 16 }}>
          {updateInfo.hasUpdate ? (
            <Alert
              type="info"
              showIcon
              message={t('update.newVersionFound', { version: updateInfo.latestVersion })}
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  {updateInfo.releaseNotes && <div>{updateInfo.releaseNotes}</div>}
                  {downloading && (
                    <Progress percent={downloadProgress} status="active" />
                  )}
                  {!downloading && (
                    <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadUpdate}>
                      {t('update.downloadUpdate')}
                    </Button>
                  )}
                </Space>
              }
            />
          ) : (
            <Alert type="success" showIcon message={t('update.latestVersion', { version: updateInfo.currentVersion })} />
          )}
        </div>
      )}
    </Card>
    </div>
    </>
  );

  const renderCacheContent = () => (
    <>
    <div className="gs-section-head">
      <span className="gs-section-title">{t('sections.cache')}</span>
    </div>
    <div className="gs-section-body">
    <Card className="gs-section-card">
      {cacheLoading && !cacheInfo ? (
        <Skeleton active />
      ) : cacheInfo ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <HddOutlined style={{ fontSize: 20, color: '#888' }} />
            <span style={{ fontSize: 15 }}>
              {t('cache.usage')}<Text strong>{formatBytes(cacheInfo.totalSize)}</Text>
            </span>
            <Button icon={<ReloadOutlined />} onClick={loadCacheInfo} loading={cacheLoading} size="small">
              {t('common.refresh')}
            </Button>
            <Popconfirm
              title={t('cache.clearAllConfirm')}
              onConfirm={() => handleClearCache(null)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Button
                icon={<DeleteOutlined />}
                danger
                size="small"
                loading={cacheClearing === 'all'}
                disabled={cacheLoading || cacheInfo.totalSize === 0}
              >
                {t('cache.clear')}
              </Button>
            </Popconfirm>
          </div>
        </Space>
      ) : (
        <Empty description={t('cache.loadFailed')} />
      )}
    </Card>
    </div>
    </>
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
        title: t('runtime.processList'), dataIndex: 'name', key: 'name',
        ellipsis: true, width: 200,
        render: (name, record) => (
          <Space>
            <Text strong>{name}</Text>
            {record.category === 'router' && record.modelNames?.length > 0 && (
              <Tooltip title={t('runtime.loadedModels', { models: record.modelNames.join(', ') })}>
                <Tag style={{ cursor: 'help' }}>{t('runtime.modelCount', { count: record.modelNames.length })}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
      {
        title: t('runtime.type'), dataIndex: 'type', key: 'type', width: 90,
        render: (type) => <Tag color={typeColorMap[type] || 'default'}>{type.toUpperCase()}</Tag>
      },
      {
        title: 'PID', dataIndex: 'pid', key: 'pid', width: 70,
        render: (pid) => <Text type="secondary">{pid || '-'}</Text>
      },
      {
        title: t('runtime.port'), dataIndex: 'port', key: 'port', width: 70,
        render: (port) => <Tag color="cyan">:{port}</Tag>
      },
      {
        title: t('runtime.memory'), dataIndex: 'memory', key: 'memory', width: 100,
        sorter: (a, b) => (a.memory || 0) - (b.memory || 0),
        render: (mem) => formatBytes(mem)
      },
      {
        title: '显存', dataIndex: 'vram', key: 'vram', width: 100,
        sorter: (a, b) => (a.vram || 0) - (b.vram || 0),
        render: (vram, record) => {
          if (!vram || vram <= 0) return <Text type="secondary">-</Text>;
          if (record.vram_detail) {
            const d = record.vram_detail;
            return (
              <Tooltip title={
                <div>
                  <div>专用显存: {d.vram_used_mb} / {d.vram_total_mb} MB</div>
                  <div>共享显存: {d.shared_used_mb} / {d.shared_total_mb} MB</div>
                </div>
              }>
                <span style={{ cursor: 'help', borderBottom: '1px dashed #888' }}>{formatBytes(vram)}</span>
              </Tooltip>
            );
          }
          return formatBytes(vram);
        }
      },
      {
        title: t('runtime.duration'), dataIndex: 'startTime', key: 'startTime', width: 100,
        render: (t) => formatDuration(t)
      },
      {
        title: t('runtime.action'), key: 'action', width: 80, align: 'center',
        render: (_, record) => (
          record.category === 'system' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{t('runtime.mainService')}</Text>
          ) : (
            <Popconfirm
              title={t('runtime.stopConfirm')}
              description={t('runtime.stopConfirmDesc', { name: record.name })}
              onConfirm={() => handleStopProcess(record)}
              okText={t('runtime.stop')} cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<CloseCircleOutlined />}
                loading={stoppingId === record.id}>{t('runtime.stop')}</Button>
            </Popconfirm>
          )
        )
      }
    ];

    return (
      <>
      <div className="gs-section-head">
        <span className="gs-section-title">{t('sections.runtime')}</span>
      </div>
      <div className="gs-section-body">
      <Card className="gs-section-card">
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
                    {hw.gpus.map((gpu, i) => {
                      const hasShared = (gpu.shared_total || 0) > 0;
                      const displayUsed = hasShared ? (gpu.total_used ?? (gpu.used + gpu.shared_used)) : gpu.used;
                      const displayTotal = hasShared ? (gpu.total_avail ?? (gpu.total + gpu.shared_total)) : gpu.total;
                      const displayPct = displayTotal > 0 ? Math.round((displayUsed / displayTotal) * 100) : 0;
                      return (
                        <div key={i} style={i > 0 ? { marginTop: 8 } : {}}>
                          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gpu.name}</div>
                          {gpu.amdSoftwareVersion ? (
                            <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>
                              AMD Software: {gpu.amdSoftwareVersion}
                            </div>
                          ) : null}
                          {gpu.used != null ? (
                            <>
                              {hasShared ? (
                                <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>
                                  专用: {formatBytes(gpu.used)} / {formatBytes(gpu.total)}
                                  {' · '}共享: {formatBytes(gpu.shared_used)} / {formatBytes(gpu.shared_total)}
                                </div>
                              ) : (
                                <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', marginBottom: 4 }}>{formatBytes(gpu.used)} / {formatBytes(gpu.total)}</div>
                              )}
                              <Progress percent={displayPct} size="small"
                                strokeColor={displayPct > 80 ? '#ff4d4f' : '#722ed1'}
                                format={(p) => `${p}%`} />
                            </>
                          ) : (
                            <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)' }}>容量: {formatBytes(gpu.total)}</div>
                          )}
                        </div>
                      );
                    })}
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
                  <Text strong>{t('runtime.processList')}</Text>
                  <Tag color={processes.length > 0 ? 'green' : 'default'}>{t('runtime.processCount', { count: processes.length })}</Tag>
                </Space>
                <Button type="text" size="small" icon={<ReloadOutlined spin={systemLoading} />}
                  onClick={loadSystemInfo}>{t('common.refresh')}</Button>
              </div>
              <Table columns={processColumns} dataSource={processes} rowKey="id"
                size="small" pagination={false} scroll={{ y: 340 }}
                locale={{ emptyText: <Empty description={t('runtime.noRunningProcess')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
            </div>
          </>
        )}
      </Card>
      </div>
      </>
    );
  };

  const renderStorageContent = () => {
    const storageItems = storage?.items || [];
    const totalSize = storageItems.reduce((sum, s) => sum + (s.size || 0), 0);

    return (
      <>
      <div className="gs-section-head">
        <span className="gs-section-title">{t('sections.storage')}</span>
      </div>
      <div className="gs-section-body">
      <Card className="gs-section-card">
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary">{t('storage.description')}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('storage.totalUsage', { size: formatBytes(totalSize) })}</Text>
        </div>
        {storageItems.length === 0 ? (
          <Empty description={t('common.loading')} />
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
                          <Tag color="blue" icon={<LinkOutlined />}>{t('storage.migrated')}</Tag>
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
                          {t('storage.restore')}
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
                    onClick={() => handleOpenFolder(item.path)}>{t('common.open')}</Button>
                  <Button size="small" icon={<SwapOutlined />} disabled={!item.exists}
                    onClick={() => { setMigrateModal({ open: true, type: item.type, label: item.label, size: item.size, driveFreeSpace: item.driveFreeSpace, srcPath: item.path }); setMigratePath(''); setMigrateBackup(false); }}>{t('migrate.operationName')}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>
      </>
    );
  };

  const renderLogViewer = (entries, containerRef, level, setLevel, autoScroll, setAutoScroll, autoScrollRef, onReload, onDownload, onClear, loading) => {
    const levelColors = { info: '#1890ff', warn: '#faad14', error: '#ff4d4f' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{ flexShrink: 0, paddingBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Space>
            <Select value={logLevel} onChange={setLogLevel} size="small" style={{ width: 100 }}>
              <Option value="all">{t('logs.all')}</Option>
              <Option value="info">INFO</Option>
              <Option value="warn">WARN</Option>
              <Option value="error">ERROR</Option>
            </Select>
            <Checkbox checked={logAutoScroll} onChange={e => { setLogAutoScroll(e.target.checked); logAutoScrollRef.current = e.target.checked; }}>
              {t('logs.autoScroll')}
            </Checkbox>
          </Space>
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadLogs} loading={logLoading}>{t('common.refresh')}</Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={handleDownloadLogs} disabled={logEntries.length === 0}>{t('common.download')}</Button>
            <Popconfirm title={t('logs.clearConfirm')} onConfirm={handleClearLogs} okText={t('logs.clear')} cancelText={t('common.cancel')}>
              <Button size="small" danger icon={<DeleteOutlined />}>{t('logs.clear')}</Button>
            </Popconfirm>
          </Space>
        </div>
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            background: '#1e1e1e',
            borderRadius: 6,
            padding: '12px 16px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.6
          }}
        >
          {loading && logEntries.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center', paddingTop: 40 }}>加载中...</div>
          ) : logEntries.length === 0 ? (
            <div style={{ color: '#666', textAlign: 'center', paddingTop: 40 }}>{t('logs.empty')}</div>
          ) : (
            entries.map((entry, i) => (
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
      </div>
    );
  };

  const renderLogsContent = () => (
    <>
      <div className="gs-section-head">
        <span className="gs-section-title">系统日志</span>
        <Button size="small" icon={<FolderOpenOutlined />} onClick={async () => {
          try { await backendService.openLogsFolder(); } catch { message.error('打开失败'); }
        }}>日志文件夹</Button>
      </div>
      <div className="gs-section-body">
        <Card className="gs-section-card" styles={{ body: { height: '100%', padding: 16, display: 'flex', flexDirection: 'column' } }}>
          <Tabs
            activeKey={logTab}
            onChange={setLogTab}
            size="small"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            items={[
              {
                key: 'system',
                label: '系统日志',
                children: (
                  <div className="log-tab-content">
                    {renderLogViewer(logEntries, logContainerRef, logLevel, setLogLevel, logAutoScroll, setLogAutoScroll, logAutoScrollRef, loadLogs, handleDownloadLogs, handleClearLogs, logLoading)}
                  </div>
                ),
              },
              {
                key: 'tts',
                label: 'TTS 日志',
                children: (
                  <div className="log-tab-content">
                    {renderLogViewer(ttsLogEntries, ttsLogContainerRef, ttsLogLevel, setTtsLogLevel, ttsLogAutoScroll, setTtsLogAutoScroll, ttsLogAutoScrollRef, loadTtsLogs, handleDownloadTtsLogs, handleClearTtsLogs, ttsLogLoading)}
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </>
  );

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

  const renderVersionDrawer = () => {
    const installedVersions = getOrderedInstalledVersions(selectedEngine);
    const availableVersions = resolveEngineVersions(selectedEngine);
    const installedVariantGroups = getVersionVariantGroups(selectedEngine, installedVersions);
    const availableVariantGroups = getVersionVariantGroups(selectedEngine, availableVersions);
    const latestInstalledVersion = getLatestInstalledVersion(selectedEngine);
    const allDownloadStates = selectedEngine?.download_states || (selectedEngine?.download_state ? [selectedEngine.download_state] : []);

    const renderInstalledVersionItem = (version) => (
      <List.Item
        actions={[
          version.broken ? (
            <Tag color="error">{t('engines.incompleteInstall')}</Tag>
          ) : version.version === latestInstalledVersion ? (
            <Tag color="green">{t('engines.latestTag')}</Tag>
          ) : null,
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={() => handleReinstall(selectedEngine.engine_api_id || selectedEngine.id, version.version)}
          >
            {t('engines.reinstall')}
          </Button>,
          <Popconfirm
            title={t('engines.uninstallConfirm')}
            description={t('engines.uninstallConfirmDesc', { version: version.version })}
            onConfirm={() => handleUninstall(selectedEngine.engine_api_id || selectedEngine.id, version.version)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>{t('engines.uninstall')}</Button>
          </Popconfirm>
        ].filter(Boolean)}
      >
        <List.Item.Meta
          title={
            <Space>
              <Text strong>{version.version}</Text>
              {version.variant_name && <Tag>{version.variant_name}</Tag>}
            </Space>
          }
          description={
            <Space direction="vertical" size={0}>
              {version.installed_at && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('engines.installedAt', { time: new Date(version.installed_at).toLocaleString('zh-CN') })}
                </Text>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('engines.path', { path: version.path })}
              </Text>
            </Space>
          }
        />
      </List.Item>
    );

    const renderAvailableVersionItem = (version) => {
      const isInstalled = selectedEngine.installed_versions?.some(
        v => v.version === version.version
      );
      const ds = allDownloadStates.find(s => s.targetQuantization === version.version);
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
              <Tag color="success">{t('engines.installed')}</Tag>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => {
                  handleDownloadEngine(selectedEngine.engine_api_id || selectedEngine.id, version.version);
                }}
              >
                {t('engines.download')}
              </Button>
            )
          ]}
        >
          <List.Item.Meta
            title={
              <Space>
                <Text strong>{version.version}</Text>
                {version.variant_name && <Tag>{version.variant_name}</Tag>}
              </Space>
            }
            description={
              isThisDownloading ? (
                <div style={{ fontSize: 12, color: '#888' }}>
                  {ds.status === 'downloading' && t('engines.downloadingWithSpeed', { speed: ds.speed > 0 ? ` · ${formatBytes(ds.speed)}/s` : '' })}
                  {ds.status === 'unpacking' && t('engines.unpacking')}
                  {ds.status === 'installing' && t('engines.installing')}
                </div>
              ) : t('engines.size', { size: formatBytes(version.size) })
            }
          />
        </List.Item>
      );
    };

    const renderGroupedVersionList = (groups, renderItem, emptyText) => {
      if (!groups) {
        return null;
      }

      return (
        <Collapse
          defaultActiveKey={[]}
          items={groups.map(group => ({
            key: group.key,
            label: (
              <Space>
                <Text strong>{group.name}</Text>
                <Tag>{group.versions.length}</Tag>
              </Space>
            ),
            children: (
              <List
                dataSource={group.versions}
                locale={{ emptyText }}
                renderItem={renderItem}
              />
            )
          }))}
        />
      );
    };

    return (
      <Drawer
        title={`${selectedEngine?.name} - ${t('engines.versionManagement')}`}
        placement="right"
        width={600}
        open={versionDrawerVisible}
        onClose={() => setVersionDrawerVisible(false)}
      >
        {selectedEngine && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Card size="small" title={t('engines.installedVersions')}>
              <Alert
                message={t('engines.versionNotes')}
                description={t('engines.versionNotesDesc')}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {installedVariantGroups ? renderGroupedVersionList(installedVariantGroups, renderInstalledVersionItem, t('engines.noInstalledVersions')) : (
                <List
                  dataSource={installedVersions}
                  locale={{ emptyText: t('engines.noInstalledVersions') }}
                  renderItem={renderInstalledVersionItem}
                />
              )}
            </Card>

            <Card size="small" title={t('engines.availableVersions')}>
              {availableVariantGroups ? renderGroupedVersionList(availableVariantGroups, renderAvailableVersionItem, t('engines.noAvailableVersions')) : (
                <List
                  dataSource={availableVersions}
                  renderItem={renderAvailableVersionItem}
                />
              )}
            </Card>
          </Space>
        )}
      </Drawer>
    );
  };

  return (
    <Layout className="gs-layout">
      {(restarting || unpacking) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16
        }}>
          <Spin size="large" />
          <span style={{ color: '#fff', fontSize: 16 }}>
            {restartTimedOut
              ? t('update.restartTimedOut')
              : restarting
                ? t('update.restartInSeconds', { seconds: restartCountdown })
                : t('update.unpackingAndRestarting')}
          </span>
          {restartTimedOut && (
            <span style={{ color: '#aaa', fontSize: 13 }}>
              {t('update.manualRestartHint')}
            </span>
          )}
        </div>
      )}
      <Header className="gs-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ marginRight: 16 }}
        >
          {t('back')}
        </Button>
        <h2 style={{ margin: 0 }}>{t('title')}</h2>
      </Header>

      <Layout className="gs-body">
        <Sider width={200} className="gs-sider">
          <Menu
            mode="inline"
            selectedKeys={[selectedMenu]}
            onClick={({ key }) => setSelectedMenu(key)}
            style={{ height: '100%', borderRight: 0 }}
            items={[
              { key: 'runtime', icon: <DashboardOutlined />, label: t('menu.runtime') },
              { key: 'logs',    icon: <FileTextOutlined />,  label: t('menu.logs') },
              { key: 'storage', icon: <DatabaseOutlined />, label: t('menu.storage') },
              { key: 'engines', icon: <AppstoreOutlined />, label: t('menu.engines') },
              { key: 'cache',   icon: <HddOutlined />,      label: t('menu.cache') },
              { key: 'export',  icon: <ExportOutlined />,   label: t('menu.export') },
              { key: 'update',  icon: <SyncOutlined />,     label: t('menu.update') }
            ]}
          />
        </Sider>

        <Content className="gs-content">
          {renderContent()}
        </Content>
      </Layout>

      {renderVersionDrawer()}

      {/* 迁移确认弹窗 */}
      <Modal
        title={t('migrate.title', { label: migrateModal.label })}
        open={migrateModal.open}
        onCancel={() => !migrating && setMigrateModal({ open: false, type: null, label: '' })}
        onOk={handleMigrate}
        okText={t('migrate.start')}
        cancelText={t('common.cancel')}
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
            {t('migrate.intro')}
          </Text>
        </div>
        {migrating && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4 }}>
            <Text style={{ color: '#d46b08', fontSize: 13 }}>
              {t('migrate.progressHint')}
            </Text>
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <Text strong>{t('migrate.targetPath')}</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder={t('migrate.placeholder')}
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
                message.error(t('migrate.pickFolderFailed'));
              } finally {
                setPickingFolder(false);
              }
            }}>
            {t('common.browse')}
          </Button>
        </div>
        {migratePath.trim() && !/^[a-zA-Z]:[\\\/]/.test(migratePath.trim()) && (
          <div style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 12, color: '#ff4d4f' }}>
              {t('migrate.invalidPath')}
            </Text>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Text type="warning" style={{ fontSize: 12 }}>
            {t('migrate.warning')}
          </Text>
        </div>
        <div style={{ marginTop: 12 }}>
          <Checkbox
            checked={migrateBackup}
            onChange={e => setMigrateBackup(e.target.checked)}
            disabled={migrating}
          >
            {t('migrate.backupBefore')}
          </Checkbox>
          {migrateBackup && (() => {
            const notEnough = migrateModal.driveFreeSpace != null && migrateModal.size > migrateModal.driveFreeSpace;
            return (
              <div style={{ marginTop: 4 }}>
                {notEnough ? (
                  <Text style={{ fontSize: 12, color: '#ff4d4f' }}>
                    {t('migrate.backupNoSpace', {
                      required: (migrateModal.size / 1024 ** 3).toFixed(2),
                      available: (migrateModal.driveFreeSpace / 1024 ** 3).toFixed(2)
                    })}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 12, color: '#888' }}>
                    {t('migrate.backupPath', { path: migrateModal.srcPath })}
                  </Text>
                )}
              </div>
            );
          })()}
        </div>
        {migrating && (
          <div style={{ marginTop: 16 }}>
            {migrateProgress?.sameDrive ? (
              <div style={{ color: '#1677ff', fontSize: 13 }}>{t('migrate.sameDrive')}</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                  {migrateProgress?.phase === 'backup' ? t('migrate.backuping') : t('migrate.migrating')}
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
                      : t('common.preparing')}
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
        title={restoreModal.step === 'confirm' ? t('restore.confirmTitle', { label: restoreModal.label }) : t('restore.progressTitle', { label: restoreModal.label })}
        open={restoreModal.open}
        onCancel={restoreModal.step === 'confirm' ? () => setRestoreModal({ open: false, type: null, label: '', step: 'confirm', junctionTarget: '' }) : undefined}
        closable={restoreModal.step === 'confirm'}
        maskClosable={restoreModal.step === 'confirm'}
        footer={restoreModal.step === 'confirm' ? [
          <Button key="cancel" onClick={() => setRestoreModal({ open: false, type: null, label: '', step: 'confirm', junctionTarget: '' })}>{t('common.cancel')}</Button>,
          <Button key="ok" danger type="primary" onClick={handleRestore}>{t('restore.confirmButton')}</Button>
        ] : null}
      >
        {restoreModal.step === 'confirm' ? (
          <div style={{ padding: '8px 0' }}>
            <Text>{t('restore.confirmDesc', { label: restoreModal.label.replace(/\s+/g, ' ').trim() })}</Text>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>{t('restore.pathHint', { path: restoreModal.junctionTarget })}</Text>
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px 0 16px' }}>
            {restoreProgress?.sameDrive ? (
              <div style={{ color: '#1677ff', fontSize: 13 }}>{t('restore.sameDrive')}</div>
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
                      : t('common.preparing')}
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
              {t('restore.progressHint')}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default GlobalSettings;
