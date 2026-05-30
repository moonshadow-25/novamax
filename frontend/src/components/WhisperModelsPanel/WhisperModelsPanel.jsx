import React, { useState, useEffect, useRef } from 'react';
import { Table, Tag, Button, Space, Typography, message, Progress } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined,
  PauseCircleOutlined, PlayCircleOutlined, StopOutlined
} from '@ant-design/icons';
import { asrModelsService, downloadService } from '../../services/api';
import './WhisperModelsPanel.css';

const { Title, Text } = Typography;

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bps) {
  if (!bps || bps <= 0) return '';
  return `${formatBytes(bps)}/s`;
}

function WhisperModelsPanel({ modelId, onPathReady }) {
  const [files, setFiles] = useState([]);
  const [summary, setSummary] = useState({ total: 0, downloaded: 0, missing: 0 });
  // { [filename]: { taskId, progress, totalBytes, downloadedBytes, speed, paused } }
  const [tasks, setTasks] = useState({});
  const tasksRef = useRef({});
  const pollingRef = useRef(false);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    if (!modelId) return;
    loadStatus();
    restoreTasks();
    const t = setInterval(loadStatus, 3000);
    return () => clearInterval(t);
  }, [modelId]);

  useEffect(() => {
    if (Object.keys(tasks).length === 0) return;
    pollTasks();
    const t = setInterval(pollTasks, 2000);
    return () => clearInterval(t);
  }, [tasks]);

  const restoreTasks = async () => {
    try {
      const data = await downloadService.getAll();
      const list = data.downloads || [];
      const restored = {};
      for (const dl of list) {
        if (dl.type !== 'asr') continue;
        if (dl.sourceModelId !== modelId) continue;
        restored[dl.targetQuantization] = {
          taskId: dl.comfyuiTaskId,
          progress: dl.progress || 0,
          totalBytes: dl.totalBytes || null,
          downloadedBytes: dl.downloadedBytes || null,
          speed: dl.speed || 0,
          paused: dl.status === 'paused'
        };
      }
      if (Object.keys(restored).length > 0) {
        setTasks(prev => ({ ...restored, ...prev }));
      }
    } catch {}
  };

  const loadStatus = async () => {
    if (!modelId) return;
    try {
      const res = await asrModelsService.getFilesStatus(modelId);
      if (res.success) {
        setFiles(res.files || []);
        setSummary(res.summary || {});
        if (onPathReady) onPathReady(res.asr_path);
      }
    } catch {}
  };

  const pollTasks = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const entries = Object.entries(tasksRef.current).filter(([, t]) => t.taskId);
      if (!entries.length) return;
      const updates = {};
      const done = [];
      await Promise.all(entries.map(async ([filename, info]) => {
        try {
          const res = await asrModelsService.getDownloadStatus(info.taskId);
          const t = res.task;
          if (!t || t.status === 'completed' || t.status === 'not_found') {
            done.push(filename);
            loadStatus();
          } else if (t.status === 'failed' || t.status === 'cancelled') {
            done.push(filename);
          } else {
            updates[filename] = {
              ...info,
              progress: t.progress ?? info.progress,
              totalBytes: t.totalBytes ?? null,
              downloadedBytes: t.downloadedBytes ?? null,
              speed: t.speed ?? null,
              paused: t.status === 'paused'
            };
          }
        } catch {}
      }));
      setTasks(prev => {
        const next = { ...prev, ...updates };
        done.forEach(f => delete next[f]);
        return next;
      });
    } finally {
      pollingRef.current = false;
    }
  };

  const handleDownload = async (filename) => {
    setTasks(prev => ({ ...prev, [filename]: { taskId: null, progress: 0 } }));
    try {
      const res = await asrModelsService.downloadFile(modelId, filename);
      if (res.success) {
        setTasks(prev => ({ ...prev, [filename]: { taskId: res.taskId, progress: 0 } }));
      } else {
        setTasks(prev => { const n = { ...prev }; delete n[filename]; return n; });
        message.error(res.error || '下载失败');
      }
    } catch (e) {
      setTasks(prev => { const n = { ...prev }; delete n[filename]; return n; });
      message.error(e.response?.data?.error || e.message || '下载失败');
    }
  };

  const handlePause = async (filename) => {
    const taskId = tasks[filename]?.taskId;
    if (!taskId) return;
    try {
      await asrModelsService.pauseDownload(taskId);
      setTasks(prev => ({ ...prev, [filename]: { ...prev[filename], paused: true, speed: 0 } }));
    } catch (e) { message.error('暂停失败'); }
  };

  const handleResume = async (filename) => {
    const taskId = tasks[filename]?.taskId;
    if (!taskId) return;
    try {
      await asrModelsService.resumeDownload(taskId);
      setTasks(prev => ({ ...prev, [filename]: { ...prev[filename], paused: false } }));
    } catch (e) { message.error('恢复失败'); }
  };

  const handleCancel = async (filename) => {
    const taskId = tasks[filename]?.taskId;
    if (!taskId) return;
    try {
      await asrModelsService.cancelDownload(taskId);
      setTasks(prev => { const n = { ...prev }; delete n[filename]; return n; });
    } catch (e) { message.error('取消失败'); }
  };

  const columns = [
    {
      title: '类型', dataIndex: 'role', key: 'role', width: 100,
      render: role => <Tag color={role === 'vad' ? 'orange' : 'blue'}>{role === 'vad' ? 'VAD' : 'ASR'}</Tag>
    },
    {
      title: '文件名', dataIndex: 'filename', key: 'filename',
      render: v => <Text code>{v}</Text>
    },
    {
      title: '大小', dataIndex: 'size', key: 'size', width: 100,
      render: v => <Text type="secondary">{v ? formatBytes(v) : '-'}</Text>
    },
    {
      title: '状态', key: 'status', width: 180,
      render: (_, record) => {
        const task = tasks[record.filename];
        if (task) {
          return (
            <div style={{ minWidth: 160 }}>
              <Progress percent={task.progress || 0} size="small" status={task.paused ? 'exception' : 'active'} style={{ margin: 0 }} />
              {task.totalBytes > 0 && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {formatBytes(task.downloadedBytes || 0)} / {formatBytes(task.totalBytes)}
                </div>
              )}
              {task.paused
                ? <div style={{ fontSize: 11, color: '#faad14' }}>已暂停</div>
                : task.speed > 0
                  ? <div style={{ fontSize: 11, color: '#1677ff' }}>↓ {formatSpeed(task.speed)}</div>
                  : null}
            </div>
          );
        }
        return record.downloaded
          ? <Tag icon={<CheckCircleOutlined />} color="success">已下载</Tag>
          : <Tag icon={<CloseCircleOutlined />} color="error">缺失</Tag>;
      }
    },
    {
      title: '操作', key: 'actions', width: 180,
      render: (_, record) => {
        const task = tasks[record.filename];
        if (task) {
          return (
            <Space size={4}>
              {task.paused
                ? <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(record.filename)}>继续</Button>
                : <Button size="small" type="primary" icon={<PauseCircleOutlined />} onClick={() => handlePause(record.filename)}>暂停</Button>}
              <Button size="small" type="primary" danger icon={<StopOutlined />} onClick={() => handleCancel(record.filename)}>取消</Button>
            </Space>
          );
        }
        if (record.downloaded) return <Button size="small" disabled>已下载</Button>;
        return (
          <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={() => handleDownload(record.filename)}>
            下载
          </Button>
        );
      }
    }
  ];

  const missingCount = summary.missing || 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0 }}>
          模型文件列表
          {summary.total > 0 && (
            <Text type="secondary" style={{ fontSize: 14, fontWeight: 'normal', marginLeft: 8 }}>
              ({summary.downloaded}/{summary.total} 已下载)
            </Text>
          )}
        </Title>
        {(summary.missing || 0) > 0 && (
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => {
              const targets = files.filter(f => !f.downloaded);
              targets.forEach(f => handleDownload(f.filename));
            }}
          >
            下载全部缺失
          </Button>
        )}
      </div>

      {missingCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="warning">
            还有 {missingCount} 个文件未下载，请先下载后才能启动 ASR。
          </Text>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={files}
        rowKey="filename"
        pagination={false}
        size="small"
        bordered
        className="whisper-models-table"
      />
    </div>
  );
}

export default WhisperModelsPanel;
