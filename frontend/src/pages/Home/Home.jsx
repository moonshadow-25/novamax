import React, { useState, useEffect } from 'react';
import { Layout, Tabs, Input, Button, Space, Typography, message } from 'antd';
import { SearchOutlined, BulbOutlined, BulbFilled, ThunderboltOutlined } from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { modelService, backendService } from '../../services/api';
import ModelCard from '../../components/ModelCard/ModelCard';
import AddModelModal from '../../components/AddModelModal/AddModelModal';
import './Home.css';

const { Header, Content } = Layout;
const { Title } = Typography;

const MODEL_TYPES = [
  { key: 'llm', label: 'LLM' },
  { key: 'comfyui', label: 'ComfyUI' },
  { key: 'tts', label: 'TTS' },
  { key: 'whisper', label: 'Whisper' }
];

function Home() {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('llm');
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [routerLoading, setRouterLoading] = useState(false);

  useEffect(() => {
    loadModels();
  }, [activeTab]);

  // 自动刷新下载进度
  useEffect(() => {
    const hasDownloading = models.some(m =>
      m.download_status === 'downloading' ||
      m.download_status === 'paused' ||
      m.download_status === 'completed'  // 完成状态也需要刷新一次以更新 downloaded 字段
    );

    if (!hasDownloading) return;

    const interval = setInterval(() => {
      loadModels();
    }, 2000); // 每2秒刷新一次

    return () => clearInterval(interval);
  }, [models]);

  const loadModels = async () => {
    setLoading(true);
    try {
      const data = await modelService.getByType(activeTab);
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const filteredModels = models.filter(model =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const downloadedModels = filteredModels.filter(m => m.downloaded);

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
          <Button
            type="text"
            icon={theme === 'dark' ? <BulbFilled /> : <BulbOutlined />}
            onClick={toggleTheme}
          />
        </Space>
      </Header>
      <Content className="home-content">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={MODEL_TYPES.map(type => ({
            key: type.key,
            label: type.label
          }))}
          style={{ marginBottom: 24 }}
        />

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

        <div className="model-grid">
          {filteredModels.map(model => (
            <ModelCard
              key={model.id}
              model={model}
              onUpdate={loadModels}
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
    </Layout>
  );
}

export default Home;
