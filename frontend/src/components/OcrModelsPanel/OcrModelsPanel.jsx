import React, { useState, useEffect, useRef } from 'react';
import { Table, Tag, Button, Space, Typography, message, Progress, Popconfirm } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined,
  PauseCircleOutlined, PlayCircleOutlined, StopOutlined,
  LoadingOutlined, DeleteOutlined
} from '@ant-design/icons';
import { ocrModelsService, downloadService } from '../../services/api';
import { useTranslation } from 'react-i18next';

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

function OcrModelsPanel({ modelId }) {
  const { t } = useTranslation('home');
  const [files, setFiles] = useState([]);
  const [summary, setSummary] = useState({ total: 0, downloaded: 0, missing: 0 });
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
        if (dl.type !== 'ocr') continue;
        if (dl.sourceModelId !== modelId) continue;
        const filename = dl.filename || dl.targetQuantization;
        const taskId = dl.taskId || dl.comfyuiTaskId || dl.id;
        if (!filename || !taskId) continue;
        restored[filename] = {
          taskId,
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
      const res = await ocrModelsService.getFilesStatus(modelId);
      if (res.success) {
        setFiles(res.files || []);
        setSummary(res.summary || { total: 0, downloaded: 0, missing: 0 });
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
          const res = await ocrModelsService.getDownloadStatus(info.taskId);
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
      const res = await ocrModelsService.downloadFile(modelId, filename);
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
      await ocrModelsService.pauseDownload(taskId);
      setTasks(prev => ({ ...prev, [filename]: { ...prev[filename], paused: true, speed: 0 } }));
    } catch { message.error('暂停失败'); }
  };

  const handleResume = async (filename) => {
    const taskId = tasks[filename]?.taskId;
    if (!taskId) return;
    try {
      await ocrModelsService.resumeDownload(taskId);
      setTasks(prev => ({ ...prev, [filename]: { ...prev[filename], paused: false } }));
    } catch { message.error('恢复失败'); }
  };

  const handleCancel = async (filename) => {
    const taskId = tasks[filename]?.taskId;
    if (taskId) {
      try { await ocrModelsService.cancelDownload(taskId); } catch {}
    }
    setTasks(prev => { const n = { ...prev }; delete n[filename]; return n; });
  };

  const handleDelete = async (filename) => {
    try {
      await ocrModelsService.deleteFile(modelId, filename);
      message.success('文件已删除');
      loadStatus();
    } catch (e) {
      message.error(e.response?.data?.error || e.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '类型', dataIndex: 'role', key: 'role', width: 100,
      render: role => <Tag color={role === 'vad' ? 'orange' : 'blue'}>{role}</Tag>
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
          // taskId 为 null 表示正在发起下载请求
          if (!task.taskId) {
            return <Tag icon={<LoadingOutlined />} color="processing">准备下载...</Tag>;
          }
          return (
            <div style={{ minWidth: 160 }}>
              <Progress percent={task.progress || 0} size="small" status={task.paused ? 'exception' : 'active'} style={{ margin: 0 }} />
              {task.totalBytes > 0 && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {formatBytes(task.downloadedBytes || 0)} / {formatBytes(task.totalBytes)}
                </div>
              )}
              {task.paused
                ? <div style={{ fontSize: 11, color: '#faad14' }}>暂停</div>
                : task.speed > 0
                  ? <div style={{ fontSize: 11, color: '#1677ff' }}>↓ {formatSpeed(task.speed)}</div>
                  : null}
            </div>
          );
        }
        return record.downloaded
          ? <Tag icon={<CheckCircleOutlined />} color="success">已下载</Tag>
          : <Tag icon={<CloseCircleOutlined />} color="error">未下载</Tag>;
      }
    },
    {
      title: '操作', key: 'actions', width: 180,
      render: (_, record) => {
        const task = tasks[record.filename];
        if (task) {
          // taskId 为 null 表示正在发起请求，只显示取消（取消实际无效但给用户出口）
          if (!task.taskId) {
            return (
              <Button size="small" danger icon={<StopOutlined />} onClick={() => handleCancel(record.filename)}>取消</Button>
            );
          }
          return (
            <Space size={4}>
              {task.paused
                ? <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(record.filename)}>恢复</Button>
                : <Button size="small" type="primary" icon={<PauseCircleOutlined />} onClick={() => handlePause(record.filename)}>暂停</Button>}
              <Button size="small" type="primary" danger icon={<StopOutlined />} onClick={() => handleCancel(record.filename)}>取消</Button>
            </Space>
          );
        }
        if (record.downloaded) return (
          <Popconfirm
            title="确认删除模型文件"
            description={`确定要删除 ${record.filename} 吗？删除后需要重新下载才能使用。`}
            onConfirm={() => handleDelete(record.filename)}
            okText="确认"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        );
        // 已有暂停任务时点下载 → 恢复，避免创建重复任务
        if (tasks[record.filename]?.paused) {
          return (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(record.filename)}>
              恢复
            </Button>
          );
        }
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
              （已下载 {summary.downloaded}/{summary.total}）
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
              targets.forEach(f => {
                if (tasks[f.filename]?.paused) {
                  handleResume(f.filename);
                } else if (!tasks[f.filename]) {
                  handleDownload(f.filename);
                }
              });
            }}
          >
            下载全部缺失文件
          </Button>
        )}
      </div>

      {missingCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="warning">
            还有 {missingCount} 个模型文件未下载，缺少文件将导致相应功能不可用
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
      />
    </div>
  );
}

export default OcrModelsPanel;
