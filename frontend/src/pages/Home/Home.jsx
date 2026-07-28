import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Layout, Tabs, Input, Button, Space, Typography, message, Segmented, Badge, Collapse, Alert, Card, Tag } from 'antd';
import { SearchOutlined, BulbOutlined, BulbFilled, ThunderboltOutlined, DownloadOutlined, SettingOutlined, PlusOutlined, GiftOutlined, CloseOutlined, ToolOutlined, WifiOutlined, SoundOutlined, ScanOutlined } from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setLocale } from '../../i18n';
import { useTheme } from '../../contexts/ThemeContext';
import { normalizeEngineType } from '../../utils/engineType';
import { modelService, backendService, configService, downloadService, comfyuiService, remoteConfigService, updateService, engineService, multiConnectService, moduleService } from '../../services/api';
import ModelCard from '../../components/ModelCard/ModelCard';
import AddModelModal from '../../components/AddModelModal/AddModelModal';
import DownloadCenter from '../../components/DownloadCenter/DownloadCenter';
import ComfyUIInstanceCard from '../../components/ComfyUIInstanceCard/ComfyUIInstanceCard';
import ComfyUIInstanceSettings from '../../components/ComfyUIInstanceSettings/ComfyUIInstanceSettings';
import MultiConnectModal from '../../components/MultiConnectModal/MultiConnectModal';
import TTSStudio from '../TTS/TTSStudio';
import './Home.css';

const { Header, Content } = Layout;
const { Title } = Typography;

// 兜底模块列表（API 请求失败时使用）
const FALLBACK_MODULES = [
  { id: 'llm', name: 'LLM', order: 1 },
  { id: 'comfyui', name: 'ComfyUI', order: 2 },
  { id: 'tts', name: 'TTS', order: 3 },
  { id: 'asr', name: 'ASR', order: 4 },
  { id: 'ocr', name: 'OCR', order: 5 }
];

const DEFAULT_FILTER_OPTIONS = (t, favorites, downloadedModels, customModels, cloudApiModels) => [
  { label: t('home:all'), value: 'all' },
  { label: t('home:favorites', { count: favorites.length > 0 ? favorites.length : '' }).trim(), value: 'favorited' },
  { label: t('home:downloaded', { count: downloadedModels.length > 0 ? downloadedModels.length : '' }).trim(), value: 'downloaded' },
  { label: t('home:custom', { count: customModels.length > 0 ? customModels.length : '' }).trim(), value: 'custom' },
  { label: t('home:cloudApi', { count: cloudApiModels.length > 0 ? cloudApiModels.length : '' }).trim(), value: 'cloudapi' },
];

const COMFYUI_FILTER_OPTIONS = (t) => [
  { value: 'all',        label: t('home:all') },
  { value: 'text2img',   label: t('home:textToImage') },
  { value: 'img2img',    label: t('home:imageToImage') },
  { value: 'text2video', label: t('home:textToVideo') },
  { value: 'img2video',  label: t('home:imageToVideo') },
];

// 其他类型暂时使用空选项，后续可以根据需要调整
const TTS_FILTER_OPTIONS = () => [];
const ASR_FILTER_OPTIONS = () => [];
const OCR_FILTER_OPTIONS = () => [];

function Home() {
  const { t, i18n } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 从 sessionStorage 恢复上次的模块列表，避免页面切换时的残影
  const [availableModules, setAvailableModules] = useState(() => {
    try {
      const cached = sessionStorage.getItem('novamax_modules');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return FALLBACK_MODULES;
  });
  const enabledModuleIds = useMemo(() => new Set(availableModules.filter(m => m.enabled !== false).map(m => m.id)), [availableModules]);

  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    return ['llm', 'comfyui', 'tts', 'asr', 'ocr'].includes(tab) ? tab : 'llm';
  });
  const [filterTabs, setFilterTabs] = useState({ llm: 'all', comfyui: 'all', tts: 'all', asr: 'all', ocr: 'all' });
  const filterTab = filterTabs[activeTab] || 'all';
  const setFilterTab = (val) => setFilterTabs(prev => ({ ...prev, [activeTab]: val }));
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [routerLoading, setRouterLoading] = useState(false);
  const [downloadCenterVisible, setDownloadCenterVisible] = useState(false);
  const [downloadingCount, setDownloadingCount] = useState(0);
  const [favorites, setFavorites] = useState([]);

  // ASR 遗留迁移 + 旧模型导入
  const [migrateStatus, setMigrateStatus] = useState(null);
  const [migrating, setMigrating] = useState(false);
  useEffect(() => {
    // 检查遗留目录
    fetch('/api/asr/migrate-legacy')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && (d.has_legacy_engine || d.has_legacy_models) ? setMigrateStatus(d) : null)
      .catch(() => {});
  }, []);

  // 加载可用模块列表，结果缓存到 sessionStorage 避免页面切换残影
  const loadAvailableModules = useCallback(() => {
    moduleService.getAll().then(res => {
      const enabledModules = (res.modules || []).filter(m => m.enabled);
      enabledModules.sort((a, b) => (a.order || 0) - (b.order || 0));
      setAvailableModules(enabledModules);
      sessionStorage.setItem('novamax_modules', JSON.stringify(enabledModules));
      // 如果当前 activeTab 不在启用列表中，切换到第一个可用模块
      if (enabledModules.length > 0 && !enabledModules.find(m => m.id === activeTabRef.current)) {
        setActiveTab(enabledModules[0].id);
      }
    }).catch(() => {
      // API 失败时保留缓存/兜底列表
    });
  }, []);

  useEffect(() => {
    loadAvailableModules();
  }, []);

  const handleMigrateLegacy = async () => {
    setMigrating(true);
    try {
      const r = await fetch('/api/asr/migrate-legacy', { method: 'POST' });
      if (r.ok) { message.success('遗留文件已迁移到 ASR 目录'); setMigrateStatus(null); }
      else { message.error('迁移失败'); }
    } catch { message.error('迁移请求失败'); }
    finally { setMigrating(false); }
  };

  // ComfyUI 实例管理
  const [comfyuiInstances, setComfyuiInstances] = useState([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [currentInstance, setCurrentInstance] = useState(null);
  const [multiConnectVisible, setMultiConnectVisible] = useState(false);

  // 应用更新
  const [updateInfo, setUpdateInfo] = useState(null);
  // 首页 banner 显示控制
  const [showBanner, setShowBanner] = useState(true);
  // 更新通道（stable / beta）
  const [channel, setChannel] = useState('stable');
  // 关闭所有 banner（仅当前会话，不持久化）
  const handleCloseAllBanners = () => {
    setShowBanner(false);
    setUpdateInfo(null);
    setDismissedEngineUpdates(new Set());
  };

  // 引擎列表（含下载状态，SSE 变化时刷新）
  const [allEngines, setAllEngines] = useState({});
  const [dismissedEngineUpdates, setDismissedEngineUpdates] = useState(new Set());
  const [engineUpdateIndex, setEngineUpdateIndex] = useState(0);
  const [carouselHovered, setCarouselHovered] = useState(false);
  const [installingAll, setInstallingAll] = useState(false);

  // 从引擎列表派生需要提示的 banner（下载中的引擎及其依赖自动隐藏）
  const engineUpdates = useMemo(() => {
    const downloadingIds = new Set(
      Object.entries(allEngines)
        .filter(([, e]) => e.download_states?.some(
          s => ['downloading', 'paused', 'unpacking', 'installing', 'restarting'].includes(s.status)
        ))
        .map(([id]) => id)
    );
    for (const [id, engine] of Object.entries(allEngines)) {
      if (downloadingIds.has(id)) {
        (engine.dependencies || []).forEach(depId => downloadingIds.add(depId));
      }
    }

    const updates = [];

    for (const [id, engine] of Object.entries(allEngines)) {
      if (engine.category === 'app') continue;

      // 有 variants 的引擎：逐 variant 检查（TTS、ASR、OCR 等）
      if (Array.isArray(engine.variants) && engine.variants.length > 0) {
        // 确定需要检查的 variant 列表
        let variantsToCheck = engine.variants;
        if (engine.variant_mode === 'single') {
          // 互斥模式（如 llama.cpp 的 GPU 后端）：只提示已安装的或推荐的
          const installedVariant = engine.variants.find(v => {
            const vId = String(v.id || '').toLowerCase();
            const vVersionSet = new Set((v.versions || []).map(vv => vv.version));
            return (engine.installed_versions || []).some(iv => {
              if (iv.variant_id && String(iv.variant_id).toLowerCase() === vId) return true;
              if (vVersionSet.has(iv.version)) return true;
              return normalizeEngineType(iv.version).includes(normalizeEngineType(vId));
            });
          });
          if (installedVariant) {
            variantsToCheck = [installedVariant];
          } else {
            variantsToCheck = engine.variants.filter(v => v.recommended);
          }
        }
        for (const variant of variantsToCheck) {
          const variantId = String(variant.id || '').toLowerCase();
          const variantVersions = Array.isArray(variant.versions) ? variant.versions : [];
          const latestVersion = variantVersions[0]?.version;
          if (!latestVersion) continue;

          const variantIdLower = variantId;
          const variantNorm = normalizeEngineType(variantId);
          const variantVersionSet = new Set((variant.versions || []).map(v => v.version));
          const variantInstalled = (engine.installed_versions || []).filter(v => {
            if (v.variant_id && String(v.variant_id).toLowerCase() === variantIdLower) return true;
            if (variantVersionSet.has(v.version)) return true;
            return normalizeEngineType(v.version).includes(variantNorm);
          });
          const variantDownloading = (engine.download_states || []).some(s => {
            if (s.variant_id) return String(s.variant_id).toLowerCase() === variantIdLower && ['downloading', 'paused', 'unpacking', 'installing', 'restarting'].includes(s.status);
            // 旧下载状态无 variant_id → 用版本列表 + normalizeEngineType 兜底
            if (variantVersionSet.has(s.targetQuantization)) return ['downloading', 'paused', 'unpacking', 'installing', 'restarting'].includes(s.status);
            const stateKey = normalizeEngineType(s.targetQuantization || '');
            return stateKey.includes(variantNorm) && ['downloading', 'paused', 'unpacking', 'installing', 'restarting'].includes(s.status);
          });
          if (variantDownloading) continue;

          const dismissKey = `${id}:${variantId}`;
          if (dismissedEngineUpdates.has(dismissKey)) continue;

          if (variantInstalled.length === 0) {
            updates.push({
              id: dismissKey,
              dismissKey,
              engineApiId: id,
              name: `${engine.name} / ${variant.name}`,
              latestVersion,
              installed: false,
              dependencies: engine.dependencies || []
            });
          } else if (!variantInstalled.some(v => v.version === latestVersion)) {
            updates.push({
              id: dismissKey,
              dismissKey,
              engineApiId: id,
              name: `${engine.name} / ${variant.name}`,
              latestVersion,
              installed: true,
              dependencies: engine.dependencies || []
            });
          }
        }
        continue;
      }

      // 无 variants 的引擎：整体检查
      if (downloadingIds.has(id)) continue;

      if (dismissedEngineUpdates.has(id)) continue;

      const latestVersion = engine.versions?.[0]?.version;
      if (!latestVersion) continue;

      if (!engine.installed) {
        updates.push({ id, dismissKey: id, engineApiId: id, name: engine.name, latestVersion, installed: false, dependencies: engine.dependencies || [] });
      } else if (!engine.installed_versions?.some(v => v.version === latestVersion)) {
        updates.push({ id, dismissKey: id, engineApiId: id, name: engine.name, latestVersion, installed: true, dependencies: engine.dependencies || [] });
      }
    }

    return updates;
  }, [allEngines, dismissedEngineUpdates]);

  // Carousel: reset index when the list changes (items dismissed, etc.)
  useEffect(() => {
    setEngineUpdateIndex(0);
  }, [engineUpdates.length]);

  // Carousel: auto-rotate every 4s, pause on hover or when only 1 item
  useEffect(() => {
    if (engineUpdates.length <= 1 || carouselHovered) return;
    const timer = setInterval(() => {
      setEngineUpdateIndex(prev => (prev + 1) % engineUpdates.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [engineUpdates.length, carouselHovered]);

  // Install all handler
  const handleInstallAll = async () => {
    setInstallingAll(true);
    const toInstall = [...engineUpdates];
    // Dismiss all immediately
    const allKeys = toInstall.map(e => e.dismissKey);
    setDismissedEngineUpdates(prev => new Set([...prev, ...allKeys]));
    let successCount = 0;
    for (const engine of toInstall) {
      try {
        await engineService.download(engine.engineApiId || engine.id, engine.latestVersion);
        successCount++;
      } catch (e) {
        console.error(`Failed to start download for ${engine.name}:`, e);
      }
    }
    if (successCount > 0) {
      message.success(t('home:downloadStarted', { name: `${successCount} 个组件` }));
    }
    setInstallingAll(false);
  };

  useEffect(() => {
    configService.getFavorites().then(res => {
      setFavorites(res.favorites || []);
    }).catch(() => {});

    // 立即加载本地模型，不等待远程同步
    loadModels();
    // 启动时触发远程模型同步，完成后刷新列表
    remoteConfigService.sync().then(() => loadModels()).catch(() => {});

    // 读取 banner 显示设置
    configService.getUpdateSettings().then(res => {
      const s = res.updateSettings || {};
      setShowBanner(s.show_banner ?? true);
      setChannel(s.channel || 'stable');
    }).catch(() => {});

    // 检查应用更新
    updateService.check().then(res => {
      if (res.hasUpdate) setUpdateInfo(res);
    }).catch(() => {});

    // 检查引擎更新/未安装
    const loadEngines = () => engineService.getAll().then(engines => setAllEngines(engines)).catch(() => {});
    loadEngines();

    // SSE 监听引擎下载状态变化，实时更新 banner（500ms 去抖，避免事件风暴）
    let engineDebounce;
    const es = new EventSource('/api/events');
    es.addEventListener('download-progress', () => {
      clearTimeout(engineDebounce);
      engineDebounce = setTimeout(loadEngines, 500);
    });
    return () => { clearTimeout(engineDebounce); es.close(); };
  }, []);

  // 加载 ComfyUI 实例列表
  const loadComfyUIInstances = useCallback(async () => {
    if (activeTab !== 'comfyui') return;
    try {
      const res = await comfyuiService.getInstances();
      setComfyuiInstances(res.instances || []);
    } catch (error) {
      console.error('Failed to load ComfyUI instances:', error);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'comfyui') {
      loadComfyUIInstances();
      const timer = setInterval(loadComfyUIInstances, 3000); // 轮询状态
      return () => clearInterval(timer);
    }
  }, [activeTab, loadComfyUIInstances]);

  const handleCreateInstance = async () => {
    try {
      await comfyuiService.createInstance({
        name: t('home:createInstanceName'),
        host: '0.0.0.0',
        engine_version: null,
        custom_args: ''
      });
      message.success(t('home:instanceCreated'));
      loadComfyUIInstances();
    } catch (error) {
      message.error(error.response?.data?.error || t('home:createFailed'));
    }
  };

  const handleInstanceSettings = (instance) => {
    setCurrentInstance(instance);
    setSettingsVisible(true);
  };

  const toggleFavorite = (modelId) => {
    setFavorites(prev => {
      const next = prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId];
      configService.setFavorites(next).catch(() => {});
      return next;
    });
  };

  const isModelDownloaded = (model) =>
    model.active_file_ok === true ||
    model.download_status === 'completed';

  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await modelService.getByType(activeTabRef.current);
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [activeTab]);

  const refreshDownloadCount = useCallback(() => {
    const activeStatuses = ['downloading', 'unpacking', 'installing', 'restarting'];
    downloadService.getAll().then(data => {
      const count = (data.downloads || []).filter(d => activeStatuses.includes(d.status)).length;
      setDownloadingCount(count);
    }).catch(() => {});
  }, []);

  useEffect(() => { refreshDownloadCount(); }, []);

  // SSE 实时状态同步
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('model-updated', () => { loadModels(); refreshDownloadCount(); });
    es.addEventListener('download-progress', () => { loadModels(); refreshDownloadCount(); });
    es.addEventListener('favorites-updated', (e) => {
      try {
        const data = JSON.parse(e.data);
        setFavorites(data.favorites || []);
      } catch {}
    });
    es.addEventListener('server-restarted', () => {
      console.log('服务器重启，刷新页面...');
      window.location.reload();
    });
    return () => es.close();
  }, [loadModels]);

  const handleStartRouter = async () => {
    setRouterLoading(true);
    try {
      const result = await backendService.startRouter(activeTab);
      message.success(`路由模式启动成功！已加载 ${result.loadedModels}/${result.totalModels} 个模型`);
      loadModels();
    } catch (error) {
      message.error(`启动失败: ${error.message || '未知错误'}`);
    } finally {
      setRouterLoading(false);
    }
  };

  const filteredModels = models.filter(model => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = model.name.toLowerCase().includes(q) ||
      model.description?.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (activeTab === 'comfyui' && filterTab !== 'all') {
      return model.workflow?.type === filterTab;
    }
    if (filterTab === 'downloaded') return model.source !== 'custom' && model.source !== 'cloudapi' && isModelDownloaded(model);
    if (filterTab === 'favorited') return favorites.includes(model.id);
    if (filterTab === 'custom') return model.source === 'custom';
    if (filterTab === 'cloudapi') return model.source === 'cloudapi';
    return true;
  });

  const downloadedModels = models.filter(m => m.source !== 'custom' && m.source !== 'cloudapi' && isModelDownloaded(m));
  const customModels = models.filter(m => m.source === 'custom');
  const cloudApiModels = models.filter(m => m.source === 'cloudapi');

  useEffect(() => {
    if (activeTab !== 'llm') return;

    const checkSlaveModeStatus = async () => {
      try {
        const status = await multiConnectService.getStatus();
        const isEnabled = status?.status === 'enabled' || status?.status === 1 || status?.status === true;
        if (isEnabled) {
          setMultiConnectVisible(true);
        }
      } catch {
        // 忽略检测失败，避免影响首页加载
      }
    };

    checkSlaveModeStatus();
  }, [activeTab]);

  useEffect(() => {
    const handleSlaveModeEnabled = () => {
      setMultiConnectVisible(true);
    };

    window.addEventListener('slaveModeEnabled', handleSlaveModeEnabled);
    return () => window.removeEventListener('slaveModeEnabled', handleSlaveModeEnabled);
  }, []);

  const handleCloseMultiConnectModal = async () => {
    try {
      const status = await multiConnectService.getStatus();
      const isEnabled = status?.status === 'enabled' || status?.status === 1 || status?.status === true;
      if (isEnabled) {
        setMultiConnectVisible(true);
      } else {
        setMultiConnectVisible(false);
      }
    } catch {
      setMultiConnectVisible(false);
    }
  };

  const handleOpenMultiConnectModal = () => {
    setMultiConnectVisible(true);
  };

  return (
    <Layout className="home-layout">
      <Header className="home-header">
        <div className="home-header-inner">
          <div className="home-header-left">
            <Title level={3} style={{ margin: 0, color: 'inherit' }}>NovaMax{channel === 'beta' && <Tag color="orange" style={{ marginLeft: 8, fontSize: 12, verticalAlign: 'middle' }}>测试版</Tag>}</Title>
          </div>
          <div className="home-header-center">
            <Input
              placeholder={t('home:searchPlaceholder')}
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 400 }}
            />
          </div>
          <div className="home-header-right">
            <Space size={4}>
              {activeTab === 'llm' && (
                <Button
                  type="text"
                  icon={<WifiOutlined />}
                  onClick={handleOpenMultiConnectModal}
                  title={t('home:multiConnect')}
                >
                  {t('home:multiConnect')}
                </Button>
              )}
              <Badge count={downloadingCount} size="small">
                <Button
                  type="text"
                  icon={<DownloadOutlined />}
                  onClick={() => setDownloadCenterVisible(true)}
                  title={t('home:downloadCenter')}
                />
              </Badge>
              <Button
                type="text"
                onClick={() => setLocale(i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN')}
                title={t('common:language')}
              >
                {i18n.language === 'zh-CN' ? t('common:english') : t('common:chinese')}
              </Button>
              {/* 主题切换暂时隐藏 */}
              <Button
                type="text"
                icon={<SettingOutlined />}
                onClick={() => navigate('/global-settings')}
                title={t('home:globalSettings')}
              />
            </Space>
          </div>
        </div>
      </Header>
      {showBanner && updateInfo && (
        <div className="update-banner">
          <div className="update-banner-content">
            <GiftOutlined className="update-banner-icon" />
            <span className="update-banner-text">
              {t('home:newVersionReleased', {
                latestVersion: updateInfo.latestVersion,
                currentVersion: updateInfo.currentVersion,
              })}
            </span>
            <Button
              type="primary"
              size="small"
              onClick={() => navigate('/global-settings?menu=update')}
              className="update-banner-btn"
            >
              {t('home:updateNow')}
            </Button>
          </div>
          <CloseOutlined className="update-banner-close" onClick={handleCloseAllBanners} />
        </div>
      )}
      {showBanner && engineUpdates.length > 0 && (() => {
        const current = engineUpdates[engineUpdateIndex] || engineUpdates[0];
        const hasMultiple = engineUpdates.length > 1;
        const installCount = engineUpdates.filter(e => !e.installed).length;
        const updateCount = engineUpdates.filter(e => e.installed).length;
        return (
          <div className="engine-carousel-wrapper">
            {/* Carousel banner — single item */}
            <div
              className="engine-carousel-banner"
              onMouseEnter={() => setCarouselHovered(true)}
              onMouseLeave={() => setCarouselHovered(false)}
            >
              <div className="update-banner-content">
                <ToolOutlined className="update-banner-icon" />
                <span className="update-banner-text">
                  {current.installed
                    ? t('home:engineUpdateAvailable', { name: current.name, latestVersion: current.latestVersion })
                    : t('home:engineNotInstalled', { name: current.name })}
                </span>
                <Button
                  type="primary"
                  size="small"
                  onClick={async () => {
                    const rootEngine = allEngines[current.engineApiId] || allEngines[current.id] || {};
                    const deps = rootEngine.dependencies || [];
                    setDismissedEngineUpdates(prev => new Set([...prev, current.dismissKey, ...deps]));
                    try {
                      await engineService.download(current.engineApiId || current.id, current.latestVersion);
                      message.success(t('home:downloadStarted', { name: current.name }));
                    } catch (e) {
                      message.error(t('home:downloadFailed', { error: e.response?.data?.error || e.message }));
                    }
                  }}
                  className="update-banner-btn"
                >
                  {current.installed ? t('home:updateNow') : t('home:installNow')}
                </Button>
              </div>
              <div className="engine-carousel-nav">
                {hasMultiple && (
                  <>
                    <span
                      className="engine-carousel-arrow"
                      onClick={(e) => { e.stopPropagation(); setEngineUpdateIndex(prev => (prev - 1 + engineUpdates.length) % engineUpdates.length); }}
                    >◀</span>
                    <span className="engine-carousel-dots">
                      {engineUpdates.map((_, i) => (
                        <span
                          key={i}
                          className={`engine-carousel-dot${i === engineUpdateIndex ? ' active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setEngineUpdateIndex(i); }}
                        />
                      ))}
                    </span>
                    <span
                      className="engine-carousel-arrow"
                      onClick={(e) => { e.stopPropagation(); setEngineUpdateIndex(prev => (prev + 1) % engineUpdates.length); }}
                    >▶</span>
                  </>
                )}
              </div>
              <CloseOutlined
                className="update-banner-close"
                onClick={handleCloseAllBanners}
              />
            </div>
            {/* Persistent action bar */}
            <div className="engine-action-bar">
              <span className="engine-action-bar-text">
                {installCount > 0 && updateCount > 0
                  ? `${t('home:installAllSummary', { count: installCount })}，${t('home:updateAllSummary', { count: updateCount })}`
                  : installCount > 0
                    ? t('home:installAllSummary', { count: installCount })
                    : t('home:updateAllSummary', { count: updateCount })}
              </span>
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                loading={installingAll}
                onClick={handleInstallAll}
                className="engine-action-bar-btn"
              >
                {updateCount === 0 ? t('home:installAll') : installCount === 0 ? t('home:updateAll') : t('home:installUpdateAll')}
              </Button>
            </div>
          </div>
        );
      })()}
      <Content className="home-content">
        <div className="home-toolbar-bar">
          <div className="home-content-inner">
            <div className="home-toolbar">
              <Tabs
                activeKey={activeTab}
                onChange={(key) => {
                  setActiveTab(key);
                }}
                items={availableModules.filter(m => m.enabled !== false).map(mod => ({ key: mod.id, label: mod.name }))}
                style={{ flex: 1 }}
              />
              {activeTab !== 'ocr' && (
                <Segmented
                  value={filterTab}
                  onChange={setFilterTab}
                  options={
                    activeTab === 'comfyui' ? COMFYUI_FILTER_OPTIONS(t)
                      : activeTab === 'tts' ? TTS_FILTER_OPTIONS(favorites, downloadedModels, customModels, cloudApiModels)
                      : activeTab === 'asr' ? ASR_FILTER_OPTIONS(favorites, downloadedModels, customModels, cloudApiModels)
                      : DEFAULT_FILTER_OPTIONS(t, favorites, downloadedModels, customModels, cloudApiModels)
                  }
                />
              )}
            </div>
          </div>
        </div>
        <div className="home-scroll-area">
          <div className="home-content-inner">
        {/* LLM Tab 启动全部按钮 - 暂时隐藏 */}

        {/* ComfyUI Tab 实例管理（折叠面板）*/}
        {activeTab === 'comfyui' && (
          <Collapse
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'instances',
                label: t('home:comfyuiManage'),
                children: (
                  <div>
                    {comfyuiInstances.length === 0 ? (
                      <div style={{ padding: '16px 0', textAlign: 'center', color: '#999' }}>
                        {t('home:noInstances')}
                      </div>
                    ) : (
                      comfyuiInstances.map(instance => (
                        <ComfyUIInstanceCard
                          key={instance.id}
                          instance={instance}
                          onUpdate={loadComfyUIInstances}
                          onSettings={handleInstanceSettings}
                        />
                      ))
                    )}
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={handleCreateInstance}
                      block
                      style={{ marginTop: 8 }}
                    >
                      {t('home:addInstance')}
                    </Button>
                  </div>
                )
              }
            ]}
          />
        )}

        {/* TTS Tab: 直接渲染统一工作室 */}
        {activeTab === 'tts' ? (
          <TTSStudio />
        ) : (
          <>

        {/* ASR 遗留迁移提示 */}
        {activeTab === 'asr' && migrateStatus && (
          <Alert
            type="warning"
            showIcon
            message="检测到旧版 Whisper 遗留文件，可一键迁移至 ASR（此迁移操作仅访问旧目录完成迁移后删除）"
            description={
              <div style={{ fontSize: 12 }}>
                {migrateStatus.has_legacy_engine && <div>引擎: external/asr/ → external/asr/</div>}
                {migrateStatus.has_legacy_models && <div>模型: data/models_dir/asr/ → data/models_dir/asr/</div>}
                <Button type="primary" size="small" icon={<ToolOutlined />} loading={migrating} onClick={handleMigrateLegacy} style={{ marginTop: 6 }}>
                  一键迁移
                </Button>
              </div>
            }
            style={{ marginBottom: 12 }}
          />
        )}

        {/* ASR 功能入口卡片 */}
        {activeTab === 'asr' && (
          <Card
            hoverable
            style={{ background: '#e6f4ff', borderColor: '#91caff', marginBottom: 20, gridColumn: '1 / -1' }}
            bodyStyle={{ padding: 24 }}
            onClick={() => navigate('/asr/use')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: '#1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <SoundOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>语音转文本</div>
                <div style={{ fontSize: 13, color: '#666', lineHeight: 1.8 }}>
                  上传音频文件（支持 MP3 / WAV / FLAC / M4A 等格式），AI 引擎将自动识别语言并输出文字结果。
                  支持 JSON、纯文本、SRT/VTT 字幕等多种输出格式，适配会议记录、字幕制作、语音笔记等场景。
                  上传的音频文件可批量管理，转录历史自动保存，输出文件可自定义目录。
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#1677ff' }}>点击进入 → 开始使用语音转文本功能</div>
              </div>
              <div style={{ fontSize: 36, color: '#1677ff', opacity: 0.3 }}>→</div>
            </div>
          </Card>
        )}

        <div className="model-grid">
          {filteredModels.map(model => (
            <ModelCard
              key={model.id}
              model={model}
              onUpdate={loadModels}
              isFavorited={favorites.includes(model.id)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
            {(activeTab === 'llm' || activeTab === 'comfyui') && (
              <div className="add-model-card" onClick={() => setAddModalVisible(true)}>
                <div className="add-model-content">
                  <div className="add-icon">+</div>
                  <div>{t('home:addNewModel')}</div>
                </div>
              </div>
            )}
        </div>
          </>
        )}
          </div>
        </div>
      </Content>
      <AddModelModal
        visible={addModalVisible}
        type={activeTab}
        onClose={() => setAddModalVisible(false)}
        onSuccess={loadModels}
      />
      <DownloadCenter
        visible={downloadCenterVisible}
        onClose={() => setDownloadCenterVisible(false)}
      />
      <ComfyUIInstanceSettings
        visible={settingsVisible}
        instance={currentInstance}
        onClose={() => setSettingsVisible(false)}
        onSave={loadComfyUIInstances}
        onDelete={loadComfyUIInstances}
      />
      <MultiConnectModal
        visible={multiConnectVisible}
        onClose={handleCloseMultiConnectModal}
      />
    </Layout>
  );
}

export default Home;
