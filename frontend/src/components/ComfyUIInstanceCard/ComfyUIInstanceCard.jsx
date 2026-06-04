import React, { useState } from 'react';
import { Card, Space, Tag, Button, message } from 'antd';
import { PlayCircleOutlined, StopOutlined, SettingOutlined, GlobalOutlined } from '@ant-design/icons';
import { comfyuiService, engineService } from '../../services/api';
import { useTranslation } from 'react-i18next';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';
import './ComfyUIInstanceCard.css';

function ComfyUIInstanceCard({ instance, onUpdate, onSettings }) {
  const { t } = useTranslation('home');
  const [loading, setLoading] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);

  const getAccessibleURL = (host, port) => {
    if (host === '0.0.0.0') {
      const currentHost = window.location.hostname;
      if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
        return `http://127.0.0.1:${port}`;
      } else {
        return `http://${currentHost}:${port}`;
      }
    }
    return `http://${host}:${port}`;
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const result = await engineService.checkInstalled('comfyui');
      if (!result.installed) {
        setEngineInfo(result.engineInfo);
        setShowDownloadModal(true);
        return;
      }
      await comfyuiService.startInstance(instance.id);
      message.success(t('comfyuiInstanceCard.instanceStarting'));
      setTimeout(onUpdate, 1000);
    } catch (error) {
      message.error(error.response?.data?.error || t('comfyuiInstanceCard.startFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await comfyuiService.stopInstance(instance.id);
      message.success(t('comfyuiInstanceCard.instanceStopped'))
      onUpdate();
    } catch (error) {
      message.error(error.response?.data?.error || t('comfyuiInstanceCard.stopFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    const url = getAccessibleURL(instance.host, instance.port);
    window.open(url, '_blank');
  };

  const isRunning = instance.status === 'running';
  const isStarting = instance.status === 'starting';
  const isCrashed = instance.status === 'crashed';
  const displayHost = instance.host === '0.0.0.0' ? '127.0.0.1' : instance.host;

  const statusTag = isCrashed
    ? <Tag color="red" style={{ margin: 0 }}>{t('comfyuiInstanceCard.crashed')}</Tag>
    : isRunning
    ? <Tag color="green" style={{ margin: 0 }}>{t('comfyuiInstanceCard.running')}</Tag>
    : isStarting
    ? <Tag color="orange" style={{ margin: 0 }}>{t('comfyuiInstanceCard.starting')}</Tag>
    : <Tag style={{ margin: 0 }}>{t('comfyuiInstanceCard.stopped')}</Tag>;

  return (
    <>
      <Card className="comfyui-instance-card" size="small">
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space size={8}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>{instance.name}</span>
            {statusTag}
          </Space>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => onSettings(instance)}
            title={t('settingsDrawer.config')}
          />
        </Space>
        <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: 12 }}>
            {displayHost}:{instance.port}
            {instance.engine_version && ` · ${instance.engine_version}`}
          </span>
          <Space size={8}>
            {isRunning && (
              <Button
                size="small"
                icon={<GlobalOutlined />}
                onClick={handleOpen}
              >
                {t('comfyuiInstanceCard.open')}
              </Button>
            )}
            {isRunning || isStarting ? (
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={handleStop}
                loading={loading}
              >
                {t('modelCard.stop')}
              </Button>
            ) : isCrashed ? (
              <Space size={4}>
                <Button
                  type="primary"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={handleStart}
                  loading={loading}
                >
                  {t('comfyuiInstanceCard.restart')}
                </Button>
                <Button
                  size="small"
                  onClick={handleStop}
                >
                  {t('comfyuiInstanceCard.clear')}
                </Button>
              </Space>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                loading={loading}
              >
                {t('modelCard.start')}
              </Button>
            )}
          </Space>
        </Space>
      </Space>
      </Card>
      <EngineDownloadModal
        visible={showDownloadModal}
        engineId="comfyui"
        engineInfo={engineInfo}
        onComplete={() => { setShowDownloadModal(false); }}
        onCancel={() => setShowDownloadModal(false)}
      />
    </>
  );
}

export default ComfyUIInstanceCard;
