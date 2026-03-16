import React, { useState } from 'react';
import { Card, Space, Tag, Button, message } from 'antd';
import { PlayCircleOutlined, StopOutlined, SettingOutlined, GlobalOutlined } from '@ant-design/icons';
import { comfyuiService, engineService } from '../../services/api';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';
import './ComfyUIInstanceCard.css';

function ComfyUIInstanceCard({ instance, onUpdate, onSettings }) {
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
      message.success('实例启动中...');
      setTimeout(onUpdate, 1000);
    } catch (error) {
      message.error(error.response?.data?.error || '启动失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await comfyuiService.stopInstance(instance.id);
      message.success('实例已停止');
      onUpdate();
    } catch (error) {
      message.error(error.response?.data?.error || '停止失败');
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
  const displayHost = instance.host === '0.0.0.0' ? '127.0.0.1' : instance.host;

  return (
    <>
      <Card className="comfyui-instance-card" size="small">
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space size={8}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>{instance.name}</span>
            <Tag color={isRunning ? 'green' : isStarting ? 'orange' : 'default'} style={{ margin: 0 }}>
              {isRunning ? '运行中' : isStarting ? '启动中' : '已停止'}
            </Tag>
          </Space>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => onSettings(instance)}
            title="设置"
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
                打开
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
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                loading={loading}
              >
                启动
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
