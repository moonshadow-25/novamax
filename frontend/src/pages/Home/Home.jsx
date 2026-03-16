import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Tabs, Input, Button, Space, Typography, message, Segmented, Badge, Collapse } from 'antd';
import { SearchOutlined, BulbOutlined, BulbFilled, ThunderboltOutlined, DownloadOutlined, SettingOutlined, PlusOutlined } from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { modelService, backendService, configService, downloadService, comfyuiService, remoteConfigService } from '../../services/api';
import ModelCard from '../../components/ModelCard/ModelCard';
import AddModelModal from '../../components/AddModelModal/AddModelModal';
import DownloadCenter from '../../components/DownloadCenter/DownloadCenter';
import ComfyUIInstanceCard from '../../components/ComfyUIInstanceCard/ComfyUIInstanceCard';
import ComfyUIInstanceSettings from '../../components/ComfyUIInstanceSettings/ComfyUIInstanceSettings';
import './Home.css';

const { Header, Content } = Layout;
const { Title } = Typography;

const MODEL_TYPES = [
  { key: 'llm', label: 'LLM' },
  { key: 'comfyui', label: 'ComfyUI' },
  { key: 'tts', label: 'TTS' },
  { key: 'whisper', label: 'Whisper' }
];

const DEFAULT_FILTER_OPTIONS = (favorites, downloadedModels) => [
  { label: '全部', value: 'all' },
  { label: `收藏 ${favorites.length > 0 ? favorites.length : ''}`.trim(), value: 'favorited' },
  { label: `已下载 ${downloadedModels.length > 0 ? downloadedModels.length : ''}`.trim(), value: 'downloaded' },
];

const COMFYUI_FILTER_OPTIONS = [
  { value: 'all',        label: '全部' },
  { value: 'text2img',   label: '文生图' },
  { value: 'img2img',    label: '图生图' },
  { value: 'text2video', label: '文生视频' },
  { value: 'img2video',  label: '图生视频' },
];

// 其他类型暂时使用默认选项，后续可以根据需要调整
const TTS_FILTER_OPTIONS = DEFAULT_FILTER_OPTIONS;
const WHISPER_FILTER_OPTIONS = DEFAULT_FILTER_OPTIONS;

function Home() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    return ['llm', 'comfyui', 'tts', 'whisper'].includes(tab) ? tab : 'llm';
  });
  const [filterTabs, setFilterTabs] = useState({ llm: 'all', comfyui: 'all', tts: 'all', whisper: 'all' });
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

  // ComfyUI 实例管理
  const [comfyuiInstances, setComfyuiInstances] = useState([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [currentInstance, setCurrentInstance] = useState(null);

  useEffect(() => {
    configService.getFavorites().then(res => {
      setFavorites(res.favorites || []);
    }).catch(() => {});

    // 启动时触发远程模型同步，完成后刷新列表
    remoteConfigService.sync().then(() => loadModels()).catch(() => {});
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
        name: '新实例',
        host: '0.0.0.0',
        port: 8189,
        engine_version: null,
        custom_args: ''
      });
      message.success('实例已创建');
      loadComfyUIInstances();
    } catch (error) {
      message.error(error.response?.data?.error || '创建失败');
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
    model.downloaded ||
    (model.downloaded_quantizations && model.downloaded_quantizations.length > 0) ||
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
    downloadService.getAll().then(data => {
      const count = (data.downloads || []).filter(d => d.status === 'downloading').length;
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
    if (filterTab === 'downloaded') return isModelDownloaded(model);
    if (filterTab === 'favorited') return favorites.includes(model.id);
    return true;
  });

  const downloadedModels = models.filter(m => isModelDownloaded(m));

  return (
    <Layout className="home-layout">
      <Header className="home-header">
        <Space size="large" style={{ width: '100%', justifyContent: 'space-between' }}>
          <Title level={3} style={{ margin: 0, color: 'inherit' }}>NovaMax</Title>
          <Input
            placeholder="搜索模型..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 400 }}
          />
          <Space size={4}>
            <Badge count={downloadingCount} size="small">
              <Button
                type="text"
                icon={<DownloadOutlined />}
                onClick={() => setDownloadCenterVisible(true)}
                title="下载中心"
              />
            </Badge>
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => navigate('/global-settings')}
              title="全局设置"
            />
            <Button
              type="text"
              icon={theme === 'dark' ? <BulbFilled /> : <BulbOutlined />}
              onClick={toggleTheme}
            />
          </Space>
        </Space>
      </Header>
      <Content className="home-content">
        <div className="home-toolbar">
          <Tabs
            activeKey={activeTab}
            onChange={(key) => { setActiveTab(key); }}
            items={MODEL_TYPES.map(type => ({ key: type.key, label: type.label }))}
            style={{ flex: 1 }}
          />
          <Segmented
            value={filterTab}
            onChange={setFilterTab}
            options={
              activeTab === 'comfyui' ? COMFYUI_FILTER_OPTIONS
                : activeTab === 'tts' ? TTS_FILTER_OPTIONS(favorites, downloadedModels)
                : activeTab === 'whisper' ? WHISPER_FILTER_OPTIONS(favorites, downloadedModels)
                : DEFAULT_FILTER_OPTIONS(favorites, downloadedModels)
            }
          />
        </div>

        {/* LLM Tab 显示启动全部按钮 */}
        {activeTab === 'llm' && downloadedModels.length > 0 && (
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              onClick={handleStartRouter}
              loading={routerLoading}
            >
              启动全部模型（路由模式）
            </Button>
            <div style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              一次性启动所有已下载的 LLM 模型，共享资源
            </div>
          </div>
        )}

        {/* ComfyUI Tab 实例管理（折叠面板）*/}
        {activeTab === 'comfyui' && (
          <Collapse
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'instances',
                label: 'ComfyUI 管理',
                children: (
                  <div>
                    {comfyuiInstances.length === 0 ? (
                      <div style={{ padding: '16px 0', textAlign: 'center', color: '#999' }}>
                        暂无实例，点击模型卡片的"运行"按钮将自动创建
                      </div>
                    ) : (
                      <>
                        {comfyuiInstances.map(instance => (
                          <ComfyUIInstanceCard
                            key={instance.id}
                            instance={instance}
                            onUpdate={loadComfyUIInstances}
                            onSettings={handleInstanceSettings}
                          />
                        ))}
                        <Button
                          type="dashed"
                          icon={<PlusOutlined />}
                          onClick={handleCreateInstance}
                          block
                          style={{ marginTop: 8 }}
                        >
                          新增实例
                        </Button>
                      </>
                    )}
                  </div>
                )
              }
            ]}
          />
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
          <div className="add-model-card" onClick={() => setAddModalVisible(true)}>
            <div className="add-model-content">
              <div className="add-icon">+</div>
              <div>添加新模型</div>
            </div>
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
    </Layout>
  );
}

export default Home;
