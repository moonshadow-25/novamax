import React, { useState, useEffect, useRef } from 'react';
import { Table, Tag, Button, Space, Typography, message, Tooltip, Progress } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { comfyuiService } from '../../services/api';
import './RequiredModelsPanel.css';

const { Title, Text } = Typography;

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

const MODEL_TYPE_LABELS = {
  'clip': 'CLIP',
  'vae': 'VAE',
  'unet': 'UNet',
  'checkpoints': 'Checkpoint',
  'loras': 'LoRA',
  'controlnet': 'ControlNet',
  'upscale_models': 'Upscale'
};

function RequiredModelsPanel({ requiredModels, modelId, onUpdate }) {
  const [models, setModels] = useState(requiredModels || []);
  const [batchInitiating, setBatchInitiating] = useState(false);
  // { [filename]: { taskId, progress } }
  const [downloadingTasks, setDownloadingTasks] = useState(() => {
    // 组件挂载时从 localStorage 恢复任务状态（关闭弹框再打开也能续上）
    if (!modelId) return {};
    try {
      const saved = localStorage.getItem(`comfyui_tasks_${modelId}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const downloadingTasksRef = useRef({});

  // Keep ref in sync with state，同时持久化到 localStorage
  useEffect(() => {
    downloadingTasksRef.current = downloadingTasks;
    if (!modelId) return;
    if (Object.keys(downloadingTasks).length === 0) {
      localStorage.removeItem(`comfyui_tasks_${modelId}`);
    } else {
      localStorage.setItem(`comfyui_tasks_${modelId}`, JSON.stringify(downloadingTasks));
    }
  }, [downloadingTasks, modelId]);

  useEffect(() => {
    if (modelId) {
      loadModelsStatus();
      const interval = setInterval(loadModelsStatus, 3000);
      return () => clearInterval(interval);
    } else {
      setModels(requiredModels || []);
    }
  }, [modelId, requiredModels]);

  // Polling effect — starts when there are active tasks, uses ref for latest state
  useEffect(() => {
    if (Object.keys(downloadingTasks).length === 0) return;

    const intervalId = setInterval(async () => {
      const currentTasks = Object.entries(downloadingTasksRef.current);
      if (currentTasks.length === 0) return;

      const taskUpdates = {};
      const toComplete = [];
      const toFail = [];

      await Promise.all(
        currentTasks
          .filter(([, { taskId }]) => taskId !== null)
          .map(async ([filename, { taskId, progress }]) => {
            try {
              const response = await comfyuiService.getDownloadStatus(taskId);
              if (!response.success) return;

              const status = response.task?.status || 'not_found';

              if (status === 'completed' || status === 'not_found') {
                toComplete.push(filename);
              } else if (status === 'failed') {
                toFail.push({ filename, error: response.task?.error });
              } else {
                // pending or downloading — 更新进度、大小、速度
                const t = response.task;
                taskUpdates[filename] = {
                  taskId,
                  progress: t.progress ?? 0,
                  totalBytes: t.totalBytes ?? null,
                  downloadedBytes: t.downloadedBytes ?? null,
                  speed: t.speed ?? null
                };
              }
            } catch (e) {
              console.error('Poll error:', e);
            }
          })
      );

      const hasChanges =
        toComplete.length > 0 ||
        toFail.length > 0 ||
        Object.keys(taskUpdates).length > 0;

      if (hasChanges) {
        setDownloadingTasks(prev => {
          const next = { ...prev, ...taskUpdates };
          toComplete.forEach(f => delete next[f]);
          toFail.forEach(({ filename: f }) => delete next[f]);
          return next;
        });

        toComplete.forEach(filename => message.success(`下载完成: ${filename}`));
        toFail.forEach(({ filename, error }) =>
          message.error(`下载失败: ${filename}${error ? ' - ' + error : ''}`)
        );

        if (toComplete.length > 0 || toFail.length > 0) {
          loadModelsStatus();
        }
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [downloadingTasks]);

  const loadModelsStatus = async () => {
    if (!modelId) return;
    try {
      const response = await comfyuiService.getModelsStatus(modelId);
      if (response.success) {
        setModels(response.required_models);
      }
    } catch (error) {
      console.error('Failed to load models status:', error);
    }
  };

  const handleDownload = async (record) => {
    if (!modelId) {
      message.warning('请先保存工作流后再下载模型');
      return;
    }
    if (!record.has_url) {
      message.warning('该模型没有配置下载源，请先搜索模型');
      return;
    }

    // Optimistically mark as pending
    setDownloadingTasks(prev => ({
      ...prev,
      [record.filename]: { taskId: null, progress: 0 }
    }));

    try {
      const response = await comfyuiService.downloadModel(modelId, {
        type: record.type,
        filename: record.filename
      });

      if (response.success) {
        setDownloadingTasks(prev => ({
          ...prev,
          [record.filename]: { taskId: response.taskId, progress: 0 }
        }));
      } else {
        setDownloadingTasks(prev => {
          const next = { ...prev };
          delete next[record.filename];
          return next;
        });
        message.error('下载失败: ' + (response.error || '未知错误'));
      }
    } catch (error) {
      setDownloadingTasks(prev => {
        const next = { ...prev };
        delete next[record.filename];
        return next;
      });
      message.error('下载失败: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDownloadAll = async () => {
    if (!modelId) {
      message.warning('请先保存工作流后再下载模型');
      return;
    }

    const missingWithUrls = models.filter(
      m => !m.downloaded && m.has_url && !downloadingTasks[m.filename]
    );
    if (missingWithUrls.length === 0) {
      message.info('没有需要下载的模型');
      return;
    }

    // Optimistically mark all as pending
    const optimistic = {};
    missingWithUrls.forEach(m => {
      optimistic[m.filename] = { taskId: null, progress: 0 };
    });
    setDownloadingTasks(prev => ({ ...prev, ...optimistic }));

    setBatchInitiating(true);
    try {
      const response = await comfyuiService.downloadAllModels(modelId);

      if (response.success) {
        const taskUpdates = {};
        (response.tasks || []).forEach(({ taskId, filename }) => {
          taskUpdates[filename] = { taskId, progress: 0 };
        });
        setDownloadingTasks(prev => ({ ...prev, ...taskUpdates }));
      } else {
        // Remove optimistic entries
        setDownloadingTasks(prev => {
          const next = { ...prev };
          missingWithUrls.forEach(m => delete next[m.filename]);
          return next;
        });
        message.error('批量下载失败: ' + (response.error || '未知错误'));
      }
    } catch (error) {
      setDownloadingTasks(prev => {
        const next = { ...prev };
        missingWithUrls.forEach(m => delete next[m.filename]);
        return next;
      });
      message.error('批量下载失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setBatchInitiating(false);
    }
  };

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type) => (
        <Tag color="blue">{MODEL_TYPE_LABELS[type] || type}</Tag>
      )
    },
    {
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
      render: (filename) => <Text code>{filename}</Text>
    },
    {
      title: '节点位置',
      dataIndex: 'node_id',
      key: 'node_id',
      width: 100,
      render: (nodeId) => <Text type="secondary">{nodeId}</Text>
    },
    {
      title: '状态',
      dataIndex: 'downloaded',
      key: 'downloaded',
      width: 180,
      render: (downloaded, record) => {
        const taskInfo = downloadingTasks[record.filename];
        if (taskInfo) {
          return (
            <div style={{ minWidth: 160 }}>
              <Progress
                percent={taskInfo.progress}
                size="small"
                status="active"
                style={{ margin: 0 }}
              />
              {taskInfo.totalBytes > 0 && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2, lineHeight: 1.4 }}>
                  {formatBytes(taskInfo.downloadedBytes || 0)} / {formatBytes(taskInfo.totalBytes)}
                </div>
              )}
              {taskInfo.speed > 0 && (
                <div style={{ fontSize: 11, color: '#1677ff', lineHeight: 1.4 }}>
                  ↓ {formatSpeed(taskInfo.speed)}
                </div>
              )}
            </div>
          );
        }
        return downloaded ? (
          <Tag icon={<CheckCircleOutlined />} color="success">已下载</Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="error">缺失</Tag>
        );
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_, record) => {
        const isDownloading = !!downloadingTasks[record.filename];

        if (record.downloaded && !isDownloading) {
          return <Button size="small" disabled>已下载</Button>;
        }

        if (!record.has_url && !isDownloading) {
          return (
            <Tooltip title="无下载源">
              <Button size="small" disabled icon={<DownloadOutlined />}>下载</Button>
            </Tooltip>
          );
        }

        return (
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            loading={isDownloading}
            disabled={isDownloading || !modelId}
            onClick={() => handleDownload(record)}
          >
            {isDownloading ? '下载中' : '下载'}
          </Button>
        );
      }
    }
  ];

  const missingCount = models.filter(m => !m.downloaded).length;
  const totalCount = models.length;
  const downloadableCount = models.filter(
    m => !m.downloaded && m.has_url && !downloadingTasks[m.filename]
  ).length;

  return (
    <div className="required-models-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0 }}>
          所需模型列表
          {totalCount > 0 && (
            <Text type="secondary" style={{ fontSize: 14, fontWeight: 'normal', marginLeft: 8 }}>
              ({totalCount - missingCount}/{totalCount} 已下载)
            </Text>
          )}
        </Title>

        {downloadableCount > 0 && modelId && (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownloadAll}
            loading={batchInitiating}
          >
            下载所有缺失模型 ({downloadableCount})
          </Button>
        )}
      </div>

      {missingCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="warning">
            还有 {missingCount} 个模型未下载，请先下载所需模型后才能启动工作流。
          </Text>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={models}
        rowKey={(record) => `${record.type}-${record.filename}-${record.node_id}`}
        pagination={false}
        size="small"
        bordered
      />
    </div>
  );
}

export default RequiredModelsPanel;
