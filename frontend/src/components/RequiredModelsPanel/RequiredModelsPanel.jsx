import React, { useState, useEffect, useRef } from 'react';
import { Table, Tag, Button, Space, Typography, message, Tooltip, Progress } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, PauseCircleOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { comfyuiService } from '../../services/api';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('home');
  const [models, setModels] = useState(requiredModels || []);
  const [batchInitiating, setBatchInitiating] = useState(false);
  // { [filename]: { taskId, progress } }
  const [downloadingTasks, setDownloadingTasks] = useState({});
  const downloadingTasksRef = useRef({});
  const isFirstPollRef = useRef(true);
  const pollingRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    downloadingTasksRef.current = downloadingTasks;
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

  // 轮询任务状态的核心逻辑
  const pollTaskStatus = async () => {
    if (pollingRef.current) return; // 防止并发
    pollingRef.current = true;
    try {
    const currentTasks = Object.entries(downloadingTasksRef.current);
    if (currentTasks.length === 0) return;

    const taskUpdates = {};
    const toComplete = [];
    const toCancelled = [];
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
            } else if (status === 'cancelled') {
              toCancelled.push(filename);
            } else if (status === 'paused') {
              const t = response.task;
              taskUpdates[filename] = {
                taskId,
                progress: t.progress ?? progress,
                totalBytes: t.totalBytes ?? null,
                downloadedBytes: t.downloadedBytes ?? null,
                speed: 0,
                paused: true
              };
            } else {
              // pending or downloading — 更新进度、大小、速度
              const t = response.task;
              taskUpdates[filename] = {
                taskId,
                progress: t.progress ?? 0,
                totalBytes: t.totalBytes ?? null,
                downloadedBytes: t.downloadedBytes ?? null,
                speed: t.speed ?? null,
                paused: false
              };
            }
          } catch (e) {
            console.error('Poll error:', e);
          }
        })
    );

    const hasChanges =
      toComplete.length > 0 ||
      toCancelled.length > 0 ||
      toFail.length > 0 ||
      Object.keys(taskUpdates).length > 0;

    if (hasChanges) {
      setDownloadingTasks(prev => {
        const next = { ...prev, ...taskUpdates };
        toComplete.forEach(f => delete next[f]);
        toCancelled.forEach(f => delete next[f]);
        toFail.forEach(({ filename: f }) => delete next[f]);
        return next;
      });

      // 首次轮询不弹提示（从 localStorage 恢复的旧任务）
      if (!isFirstPollRef.current) {
        toComplete.forEach(filename => message.success(t('requiredModelsPanel.downloadCompletedWithFilename', { filename })));
        toFail.forEach(({ filename, error }) =>
          message.error(t('requiredModelsPanel.downloadFailedWithFilenameAndError', { filename, error: error || '' }))
        );
      }
      isFirstPollRef.current = false;

      if (toComplete.length > 0 || toCancelled.length > 0 || toFail.length > 0) {
        loadModelsStatus();
      }
    }
    } finally {
      pollingRef.current = false;
    }
  };

  // Polling effect — starts when there are active tasks
  useEffect(() => {
    if (Object.keys(downloadingTasks).length === 0) return;

    // 挂载时立即轮询一次，快速同步外部取消等状态
    pollTaskStatus();

    const intervalId = setInterval(pollTaskStatus, 2000);
    return () => clearInterval(intervalId);
  }, [downloadingTasks]);

  // SSE 监听：下载中心取消/完成时立即刷新
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('download-progress', () => {
      pollTaskStatus();
      loadModelsStatus();
    });
    return () => es.close();
  }, []);

  const loadModelsStatus = async () => {
    if (!modelId) return;
    try {
      const response = await comfyuiService.getModelsStatus(modelId);
      if (response.success) {
        setModels(response.required_models);
        // 从后端拉取活跃任务（downloading/paused），补充本地未追踪的任务
        const activeFromServer = {};
        (response.required_models || []).forEach(m => {
          if (m.active_task && !downloadingTasksRef.current[m.filename]) {
            activeFromServer[m.filename] = {
              taskId: m.active_task.taskId,
              progress: 0,
              paused: m.active_task.status === 'paused'
            };
          }
        });
        if (Object.keys(activeFromServer).length > 0) {
          setDownloadingTasks(prev => ({ ...prev, ...activeFromServer }));
        }
      }
    } catch (error) {
      console.error('Failed to load models status:', error);
    }
  };

  const handleDownload = async (record) => {
    if (!modelId) {
      message.warning(t('requiredModelsPanel.saveWorkflowFirst'));
      return;
    }
    if (!record.has_url) {
      message.warning(t('requiredModelsPanel.noDownloadSource'));
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
        message.error(t('requiredModelsPanel.downloadFailedWithError', { error: response.error || t('requiredModelsPanel.unknownError') }));
      }
    } catch (error) {
      setDownloadingTasks(prev => {
        const next = { ...prev };
        delete next[record.filename];
        return next;
      });
      message.error(t('requiredModelsPanel.downloadFailedWithError', { error: error.response?.data?.error || error.message }));
    }
  };

  const handleDownloadAll = async () => {
    if (!modelId) {
      message.warning(t('requiredModelsPanel.saveWorkflowFirst'));
      return;
    }

    const missingWithUrls = models.filter(
      m => !m.downloaded && m.has_url && !downloadingTasks[m.filename]
    );
    if (missingWithUrls.length === 0) {
      message.info(t('requiredModelsPanel.noModelsToDownload'));
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
        message.error(t('requiredModelsPanel.batchDownloadFailedWithError', { error: response.error || t('requiredModelsPanel.unknownError') }));
      }
    } catch (error) {
      setDownloadingTasks(prev => {
        const next = { ...prev };
        missingWithUrls.forEach(m => delete next[m.filename]);
        return next;
      });
      message.error(t('requiredModelsPanel.batchDownloadFailedWithError', { error: error.response?.data?.error || error.message }));
    } finally {
      setBatchInitiating(false);
    }
  };

  const handlePause = async (filename) => {
    const taskInfo = downloadingTasks[filename];
    if (!taskInfo?.taskId) return;
    try {
      await comfyuiService.pauseDownload(taskInfo.taskId);
      setDownloadingTasks(prev => ({
        ...prev,
        [filename]: { ...prev[filename], paused: true, speed: 0 }
      }));
    } catch (error) {
      message.error(t('requiredModelsPanel.pauseFailedWithError', { error: error.response?.data?.error || error.message }));
    }
  };

  const handleResume = async (filename) => {
    const taskInfo = downloadingTasks[filename];
    if (!taskInfo?.taskId) return;
    try {
      await comfyuiService.resumeDownload(taskInfo.taskId);
      setDownloadingTasks(prev => ({
        ...prev,
        [filename]: { ...prev[filename], paused: false }
      }));
    } catch (error) {
      message.error(t('requiredModelsPanel.resumeFailedWithError', { error: error.response?.data?.error || error.message }));
    }
  };

  const handleCancel = async (filename) => {
    const taskInfo = downloadingTasks[filename];
    if (!taskInfo?.taskId) return;
    try {
      await comfyuiService.cancelDownload(taskInfo.taskId);
      setDownloadingTasks(prev => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      message.info(t('requiredModelsPanel.cancelledDownloadWithFilename', { filename }));
    } catch (error) {
      message.error(t('requiredModelsPanel.cancelFailedWithError', { error: error.response?.data?.error || error.message }));
    }
  };

  const columns = [
    {
      title: t('requiredModelsPanel.type'),
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type) => (
        <Tag color="blue">{MODEL_TYPE_LABELS[type] || type}</Tag>
      )
    },
    {
      title: t('requiredModelsPanel.fileName'),
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
      render: (filename) => <Text code>{filename}</Text>
    },
    {
      title: t('requiredModelsPanel.nodePosition'),
      dataIndex: 'node_id',
      key: 'node_id',
      width: 100,
      render: (nodeId) => <Text type="secondary">{nodeId}</Text>
    },
    {
      title: t('requiredModelsPanel.status'),
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
                status={taskInfo.paused ? 'exception' : 'active'}
                style={{ margin: 0 }}
              />
              {taskInfo.totalBytes > 0 && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2, lineHeight: 1.4 }}>
                  {formatBytes(taskInfo.downloadedBytes || 0)} / {formatBytes(taskInfo.totalBytes)}
                </div>
              )}
              {taskInfo.paused ? (
                <div style={{ fontSize: 11, color: '#faad14', lineHeight: 1.4 }}>{t('requiredModelsPanel.paused')}</div>
              ) : taskInfo.speed > 0 ? (
                <div style={{ fontSize: 11, color: '#1677ff', lineHeight: 1.4 }}>
                  ↓ {formatSpeed(taskInfo.speed)}
                </div>
              ) : null}
            </div>
          );
        }
        return downloaded ? (
          <Tag icon={<CheckCircleOutlined />} color="success">{t('requiredModelsPanel.downloaded')}</Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="error">{t('requiredModelsPanel.missing')}</Tag>
        );
      }
    },
    {
      title: t('requiredModelsPanel.actions'),
      key: 'actions',
      width: 180,
      render: (_, record) => {
        const taskInfo = downloadingTasks[record.filename];

        if (taskInfo) {
          return (
            <Space size={4}>
              {taskInfo.paused ? (
                <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(record.filename)}>{t('requiredModelsPanel.resume')}</Button>
              ) : (
                <Button size="small" type="primary" icon={<PauseCircleOutlined />} onClick={() => handlePause(record.filename)}>{t('requiredModelsPanel.pause')}</Button>
              )}
              <Button size="small" type="primary" danger icon={<StopOutlined />} onClick={() => handleCancel(record.filename)}>{t('requiredModelsPanel.cancel')}</Button>
            </Space>
          );
        }

        if (record.downloaded) {
          return <Button size="small" disabled>{t('requiredModelsPanel.downloaded')}</Button>;
        }

        if (!record.has_url) {
          return (
            <Tooltip title={t('requiredModelsPanel.noDownloadSource')}>
              <Button size="small" disabled icon={<DownloadOutlined />}>{t('requiredModelsPanel.download')}</Button>
            </Tooltip>
          );
        }

        return (
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            disabled={!modelId}
            onClick={() => handleDownload(record)}
          >
            {t('requiredModelsPanel.download')}
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
          {t('requiredModelsPanel.requiredModelList')}
          {totalCount > 0 && (
            <Text type="secondary" style={{ fontSize: 14, fontWeight: 'normal', marginLeft: 8 }}>
              ({totalCount - missingCount}/{totalCount} {t('requiredModelsPanel.downloaded')})
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
            {t('requiredModelsPanel.downloadAllMissing')} ({downloadableCount})
          </Button>
        )}
      </div>

      {missingCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="warning">
            {t('requiredModelsPanel.missingModelsHint', { count: missingCount })}
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
