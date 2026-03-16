import React, { useState, useEffect } from 'react';
import { Modal, Alert, Progress, Space, Typography, Button, Select, Spin } from 'antd';
import { DownloadOutlined, CloseOutlined } from '@ant-design/icons';
import { engineService } from '../../services/api';

const { Text, Title } = Typography;
const { Option } = Select;

/**
 * 引擎下载 Modal 组件
 * 支持依赖提示和多进度条显示
 */
const EngineDownloadModal = ({ visible, engineId, engineInfo, onComplete, onCancel }) => {
  const [downloading, setDownloading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [dependencies, setDependencies] = useState([]);

  useEffect(() => {
    if (visible && engineInfo) {
      // 设置默认版本（最新版本）
      const latestVersion = engineInfo.versions[0]?.version;
      setSelectedVersion(latestVersion);

      // 检查依赖
      if (latestVersion) {
        checkDependencies(latestVersion);
      }
    }
  }, [visible, engineInfo]);

  const checkDependencies = async (version) => {
    try {
      const result = await engineService.validate(engineId, version);
      if (!result.satisfied) {
        setDependencies(result.missing);
      } else {
        setDependencies([]);
      }
    } catch (error) {
      console.error('Failed to check dependencies:', error);
    }
  };

  const startDownload = async () => {
    if (!selectedVersion) return;

    setDownloading(true);

    try {
      const result = await engineService.download(engineId, selectedVersion);
      setTasks(result.tasks);

      // 轮询下载进度
      pollProgress(result.tasks);
    } catch (error) {
      console.error('Failed to start download:', error);
      setDownloading(false);
    }
  };

  const pollProgress = (taskList) => {
    const interval = setInterval(async () => {
      try {
        const updatedTasks = await Promise.all(
          taskList.map(async (task) => {
            const status = await engineService.getDownloadStatus(task.taskId);
            return { ...status, taskId: task.taskId };
          })
        );

        setTasks(updatedTasks);

        // 检查是否全部完成
        const allCompleted = updatedTasks.every(t => t.status === 'completed');
        const anyFailed = updatedTasks.some(t => t.status === 'failed');

        if (allCompleted) {
          clearInterval(interval);
          setDownloading(false);
          onComplete?.();
        } else if (anyFailed) {
          clearInterval(interval);
          setDownloading(false);
        }
      } catch (error) {
        console.error('Failed to poll progress:', error);
      }
    }, 1000);
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatSpeed = (speed) => {
    if (!speed) return '0 B/s';
    return `${formatBytes(speed)}/s`;
  };

  // 检查中（engineInfo 尚未加载）
  if (!engineInfo) {
    return (
      <Modal
        title="检查引擎..."
        open={visible}
        onCancel={onCancel}
        footer={null}
        width={600}
        maskClosable={false}
      >
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#888' }}>正在检查引擎状态...</div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`需要下载 ${engineInfo.name || ''}`}
      open={visible}
      onCancel={onCancel}
      footer={
        downloading ? [
          <Button key="bg" onClick={onCancel}>
            后台运行
          </Button>
        ] : [
          <Button key="cancel" onClick={onCancel} icon={<CloseOutlined />}>
            取消
          </Button>,
          <Button
            key="download"
            type="primary"
            onClick={startDownload}
            icon={<DownloadOutlined />}
            disabled={!selectedVersion}
          >
            开始下载
          </Button>
        ]
      }
      width={600}
      maskClosable={true}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 版本选择器 */}
        {!downloading && engineInfo.versions?.length > 1 && (
          <div>
            <Text strong>选择版本：</Text>
            <Select
              value={selectedVersion}
              onChange={(value) => {
                setSelectedVersion(value);
                checkDependencies(value);
              }}
              style={{ width: '100%', marginTop: 8 }}
            >
              {engineInfo.versions.map(v => (
                <Option key={v.version} value={v.version}>
                  {v.version} ({formatBytes(v.size)})
                </Option>
              ))}
            </Select>
          </div>
        )}

        {/* 引擎信息 */}
        <div>
          <Text type="secondary">{engineInfo?.description}</Text>
          <div style={{ marginTop: 8 }}>
            <Text strong>版本：</Text>
            <Text>{selectedVersion}</Text>
          </div>
          <div style={{ marginTop: 4 }}>
            <Text strong>大小：</Text>
            <Text>
              {formatBytes(engineInfo?.versions?.find(v => v.version === selectedVersion)?.size)}
            </Text>
          </div>
        </div>

        {/* 依赖提示 */}
        {dependencies.length > 0 && !downloading && (
          <Alert
            message="依赖提示"
            description={
              <div>
                此引擎依赖以下组件，将一起下载：
                <ul style={{ marginTop: 8, marginBottom: 0 }}>
                  {dependencies.map(dep => (
                    <li key={dep.id}>
                      {dep.id} - {dep.reason}
                    </li>
                  ))}
                </ul>
              </div>
            }
            type="info"
            showIcon
          />
        )}

        {/* 下载进度 */}
        {downloading && tasks.length > 0 && (
          <div>
            <Title level={5}>下载进度</Title>
            {tasks.map(task => {
              const isInstalling = task.status === 'installing';
              const isUnpacking = task.status === 'unpacking';
              const displayPercent =
                task.status === 'completed' ? 100 :
                task.status === 'installing' ? 85 :
                task.status === 'unpacking' ? 70 :
                Math.round((task.progress || 0) * 0.6);
              const statusText = {
                downloading: formatSpeed(task.speed),
                unpacking: '正在解压...',
                installing: '正在安装...',
                completed: '✓ 完成',
                failed: `✗ 失败: ${task.error}`,
              }[task.status] || task.status;

              return (
                <div key={task.taskId} style={{ marginBottom: 16 }}>
                  <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong>{task.engineId}</Text>
                    {(isInstalling || isUnpacking) && <Spin size="small" />}
                    <Text type="secondary">{statusText}</Text>
                  </div>
                  <Progress
                    percent={displayPercent}
                    status={
                      task.status === 'failed' ? 'exception' :
                      task.status === 'completed' ? 'success' : 'active'
                    }
                  />
                  {task.totalBytes > 0 && task.status === 'downloading' && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}
                    </Text>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Space>
    </Modal>
  );
};

export default EngineDownloadModal;
