import React, { useState, useEffect, useRef } from 'react';
import { Drawer, Progress, Button, Space, Tag, Empty, Typography, message } from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { downloadService } from '../../services/api';

const { Text } = Typography;

const formatSpeed = (bytesPerSec) => {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSec} B/s`;
};

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const statusMap = {
  downloading: { color: 'processing', label: '下载中' },
  unpacking: { color: 'processing', label: '解压中' },
  installing: { color: 'processing', label: '安装中' },
  paused: { color: 'warning', label: '已暂停' },
  completed: { color: 'success', label: '已完成' },
  failed: { color: 'error', label: '失败' }
};

function DownloadCenter({ visible, onClose }) {
  const [downloads, setDownloads] = useState([]);
  const esRef = useRef(null);

  const loadDownloads = async () => {
    try {
      const data = await downloadService.getAll();
      setDownloads((data.downloads || []).filter(d => d.status !== 'cancelling'));
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    if (!visible) return;
    loadDownloads();

    // SSE 实时刷新
    const es = new EventSource('/api/events');
    esRef.current = es;
    es.addEventListener('download-progress', () => loadDownloads());
    es.addEventListener('model-updated', () => loadDownloads());

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [visible]);

  const handlePause = async (modelId, quantName) => {
    try {
      await downloadService.pause(modelId, quantName);
      loadDownloads();
    } catch (e) {
      message.error('暂停失败');
    }
  };

  const handleResume = async (modelId, quantName) => {
    try {
      await downloadService.resume(modelId, quantName);
      loadDownloads();
    } catch (e) {
      message.error('恢复失败');
    }
  };

  const handleCancel = async (modelId, quantName) => {
    try {
      await downloadService.cancel(modelId, quantName);
      loadDownloads();
    } catch (e) {
      message.error('取消失败');
    }
  };

  return (
    <Drawer
      title="下载中心"
      open={visible}
      onClose={onClose}
      width={480}
    >
      {downloads.length === 0 ? (
        <Empty description="暂无下载任务" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {downloads.map((dl, idx) => {
            const st = statusMap[dl.status] || { color: 'default', label: dl.status };
            const progressStatus = dl.status === 'downloading' ? 'active'
              : dl.status === 'paused' ? 'normal'
              : dl.status === 'failed' ? 'exception'
              : 'success';

            // 引擎下载使用阶段映射，避免小文件 tqdm 来不及到 100% 导致进度偏低
            const displayPercent = dl.type === 'engine'
              ? (dl.status === 'completed' ? 100
                : dl.status === 'installing' ? 85
                : dl.status === 'unpacking' ? 70
                : Math.round((dl.progress || 0) * 0.6))
              : Math.floor(dl.progress || 0);

            return (
              <div key={idx} style={{
                padding: 12,
                border: '1px solid #f0f0f0',
                borderRadius: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dl.modelName}
                    {dl.type === 'engine' && <Tag color="purple" style={{ marginLeft: 8 }}>引擎</Tag>}
                  </Text>
                  <Space size={4}>
                    {dl.targetQuantization && (
                      <Tag color="blue" style={{ margin: 0 }}>{dl.targetQuantization}</Tag>
                    )}
                    <Tag color={st.color} style={{ margin: 0 }}>{st.label}</Tag>
                  </Space>
                </div>

                <Progress
                  percent={displayPercent}
                  status={progressStatus}
                  size="small"
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dl.status === 'downloading' && (
                      <>
                        {formatSize(dl.downloadedBytes)} / {formatSize(dl.totalBytes)}
                        {dl.speed > 0 && ` - ${formatSpeed(dl.speed)}`}
                      </>
                    )}
                    {dl.status === 'failed' && dl.error}
                  </Text>

                  <Space size={4}>
                    {dl.status === 'downloading' && (
                      <Button
                        size="small"
                        icon={<PauseCircleOutlined />}
                        onClick={() => handlePause(dl.modelId, dl.targetQuantization)}
                      >
                        暂停
                      </Button>
                    )}
                    {dl.status === 'paused' && (
                      <Button
                        size="small"
                        icon={<PlayCircleOutlined />}
                        onClick={() => handleResume(dl.modelId, dl.targetQuantization)}
                      >
                        继续
                      </Button>
                    )}
                    {(dl.status === 'downloading' || dl.status === 'paused') && (
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleCancel(dl.modelId, dl.targetQuantization)}
                      >
                        取消
                      </Button>
                    )}
                  </Space>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}

export default DownloadCenter;
