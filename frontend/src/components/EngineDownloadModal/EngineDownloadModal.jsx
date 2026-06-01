import React, { useState, useEffect } from 'react';
import { Modal, Alert, Progress, Space, Typography, Button, Select, Spin, Tag } from 'antd';
import { DownloadOutlined, CloseOutlined, CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { engineService } from '../../services/api';

const { Text, Title } = Typography;
const { Option } = Select;

/**
 * 引擎下载 Modal 组件
 * 支持依赖提示和多进度条显示
 * TTS 引擎支持运行时环境选择
 */
const EngineDownloadModal = ({ visible, engineId, engineInfo, onComplete, onCancel }) => {
  const [downloading, setDownloading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [selectedRuntime, setSelectedRuntime] = useState(null);
  const [dependencies, setDependencies] = useState([]);

  const versionGroups = React.useMemo(() => {
    if (!engineInfo) return [];
    if (Array.isArray(engineInfo.variants) && engineInfo.variants.length > 0) {
      return engineInfo.variants.map(v => ({
        id: v.id,
        name: v.name,
        versions: Array.isArray(v.versions) ? v.versions.map(ver => ({
          ...ver,
          modelscope_repo: ver.modelscope_repo || v.modelscope_repo || engineInfo.modelscope_repo,
          variant_id: v.id,
          variant_name: v.name
        })) : [],
        runtimes: Array.isArray(v.runtimes) ? v.runtimes : []
      }));
    }
    return [{ id: 'default', name: '', versions: engineInfo.versions || [], runtimes: [] }];
  }, [engineInfo]);

  const flatVersions = React.useMemo(
    () => versionGroups.flatMap(g => g.versions),
    [versionGroups]
  );

  const latestVersion = flatVersions[0];
  const latestVariant = latestVersion
    ? versionGroups.find(g => g.id === latestVersion.variant_id)
    : null;
  const runtimes = latestVariant?.runtimes || engineInfo?.runtimes || [];

  const isLatestInstalled = latestVersion
    ? engineInfo?.installed_versions?.some(v => v.version === latestVersion.version)
    : false;

  useEffect(() => {
    if (visible && engineInfo) {
      setSelectedVersion(latestVersion?.version || null);
      // 自动选择第一个运行时
      if (runtimes.length > 0) {
        setSelectedRuntime(runtimes[0].id);
      } else {
        setSelectedRuntime(null);
      }

      if (latestVersion?.version) {
        checkDependencies(latestVersion.version);
      }
    }
  }, [visible, engineInfo, flatVersions]);

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
      const result = await engineService.download(engineId, selectedVersion, selectedRuntime);
      setTasks(result.tasks);

      pollProgress(result.tasks);
    } catch (error) {
      console.error('Failed to start download:', error);
      setDownloading(false);
    }
  };

  const pollProgress = (taskList) => {
    let finished = false;
    const interval = setInterval(async () => {
      if (finished) return;
      try {
        const updatedTasks = await Promise.all(
          taskList.map(async (task) => {
            const status = await engineService.getDownloadStatus(task.taskId);
            return { ...status, taskId: task.taskId };
          })
        );

        setTasks(updatedTasks);

        const allCompleted = updatedTasks.every(t => t.status === 'completed');
        const anyFailed = updatedTasks.some(t => t.status === 'failed');

        if (allCompleted || anyFailed) {
          finished = true;
          clearInterval(interval);
          setDownloading(false);
          if (allCompleted) onComplete?.();
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

  const downloadButtonText = isLatestInstalled ? '重新安装最新版本' : '安装';

  return (
    <Modal
      title={`${isLatestInstalled ? '引擎管理' : '安装引擎'} — ${engineInfo.name || ''}`}
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
            type={isLatestInstalled ? 'default' : 'primary'}
            icon={isLatestInstalled ? <SyncOutlined /> : <DownloadOutlined />}
            onClick={startDownload}
            disabled={!selectedVersion}
          >
            {downloadButtonText}
          </Button>
        ]
      }
      width={600}
      maskClosable={true}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 引擎信息 */}
        <div>
          <Text type="secondary">{engineInfo?.description}</Text>
          <div style={{ marginTop: 8 }}>
            <Text strong>最新版本：</Text>
            {isLatestInstalled ? (
              <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginLeft: 8 }}>已安装</Tag>
            ) : (
              <Text>{latestVersion?.version}</Text>
            )}
            {latestVersion?.size > 0 && (
              <Text type="secondary" style={{ marginLeft: 8 }}>{formatBytes(latestVersion.size)}</Text>
            )}
          </div>
        </div>

        {/* 运行时环境选择 */}
        {!downloading && runtimes.length > 0 && (
          <div>
            <Text strong>选择运行时环境：</Text>
            <Select
              value={selectedRuntime}
              onChange={setSelectedRuntime}
              style={{ width: '100%', marginTop: 8 }}
            >
              {runtimes.map(rt => (
                <Option key={rt.id} value={rt.id}>
                  {rt.name}{rt.size > 0 ? ` (${formatBytes(rt.size)})` : ''}{rt.description ? ` — ${rt.description}` : ''}
                </Option>
              ))}
            </Select>
          </div>
        )}

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
