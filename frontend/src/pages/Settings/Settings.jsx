import React, { useState, useEffect } from 'react';
import { Layout, Typography, Button, Card, Spin, Empty, Descriptions, Tag, Switch, message, Space, InputNumber, Divider } from 'antd';
import { ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { modelService, engineService } from '../../services/api';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

function Settings() {
  const navigate = useNavigate();
  const { modelId } = useParams();
  const { t } = useTranslation('settings');

  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState(5);
  const [engineInfo, setEngineInfo] = useState(null);

  useEffect(() => {
    loadModel();
  }, [modelId]);

  const loadModel = async () => {
    try {
      const data = await modelService.getById(modelId);
      setModel(data);
      setAutoStart(!!data.auto_start);

      const engineId = data.engine_id || data.engine_type;
      if (engineId) {
        try {
          const eng = await engineService.getById(engineId);
          setEngineInfo(eng);
        } catch { setEngineInfo(null); }
      }

      const cfg = data.asr_config || data.whisper_config || data.tts_config || {};
      setIdleTimeout(cfg.idle_timeout_min ?? 5);
    } catch {
      message.error('加载模型失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoStartChange = async (checked) => {
    try {
      await modelService.update(modelId, { auto_start: checked });
      setAutoStart(checked);
      message.success('已保存');
    } catch {
      message.error('保存失败');
    }
  };

  const handleSaveIdleTimeout = async () => {
    setSaving(true);
    try {
      const cfgField = model?.type === 'asr' ? 'asr_config' : 'tts_config';
      await modelService.update(modelId, { [cfgField]: { idle_timeout_min: idleTimeout } });
      message.success('已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </Content>
      </Layout>
    );
  }

  if (!model) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ padding: 24, textAlign: 'center' }}>
          <Empty description="模型不存在" />
          <Button onClick={() => navigate('/')} style={{ marginTop: 16 }}>返回首页</Button>
        </Content>
      </Layout>
    );
  }

  const latestVersion = engineInfo?.versions?.[0]?.version || '—';
  const installed = engineInfo?.installed || false;
  const modelType = model.type || 'llm';
  const showEngineSettings = modelType === 'tts' || modelType === 'asr';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: 'inherit', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center' }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <Title level={4} style={{ margin: '0 0 0 16px' }}>{t('modelSettings')} — {model.name}</Title>
      </Header>
      <Content style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="名称">{model.name}</Descriptions.Item>
            <Descriptions.Item label="类型"><Tag>{modelType.toUpperCase()}</Tag></Descriptions.Item>
            <Descriptions.Item label="描述">{model.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="Model ID"><Text copyable>{model.id}</Text></Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="基本设置" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <Text strong>自动启动</Text>
                <div><Text type="secondary" style={{ fontSize: 12 }}>应用启动时自动加载此模型</Text></div>
              </span>
              <Switch checked={autoStart} onChange={handleAutoStartChange} />
            </div>
          </Space>
        </Card>

        {showEngineSettings && (
          <Card size="small" title="引擎设置" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="引擎状态">
                <Tag color={installed ? 'success' : 'error'}>{installed ? '已安装' : '未安装'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="最新版本">{latestVersion}</Descriptions.Item>
            </Descriptions>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ whiteSpace: 'nowrap' }}>闲置自动关闭</Text>
              <InputNumber min={3} max={30} step={1} value={idleTimeout} onChange={v => setIdleTimeout(v ?? 5)} style={{ width: 72 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>分钟后自动关闭以节约资源</Text>
              <Button size="small" type="primary" loading={saving} onClick={handleSaveIdleTimeout} style={{ marginLeft: 'auto' }}>保存</Button>
            </div>
          </Card>
        )}

        <Button
          type="default"
          icon={<SettingOutlined />}
          onClick={() => {
            const tab = model?.type || 'llm';
            navigate(`/?tab=${tab}`);
          }}
          block
          style={{ marginTop: 8 }}
        >
          在首页打开模型卡片（高级设置）
        </Button>
      </Content>
    </Layout>
  );
}

export default Settings;
