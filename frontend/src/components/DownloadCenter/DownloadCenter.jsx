import React, { useState, useEffect, useRef } from 'react';
import { Drawer, Progress, Button, Space, Tag, Empty, Typography, message } from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { downloadService, comfyuiService, asrModelsService, ttsService } from '../../services/api';

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

const summarizeDownloadError = (raw = '') => {
  const text = String(raw || '').replace(/\uFFFD+/g, '').replace(/\r/g, '').trim();
  if (!text) return '下载失败';
  const lower = text.toLowerCase();
  if (lower.includes('chunkedencodingerror') || lower.includes('incompleteread') || lower.includes('connection broken')) {
    return '下载中断，网络连接不稳定';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return '下载超时，请稍后重试';
  }
  if (lower.includes('404')) return '下载地址不存在（404）';
  if (lower.includes('403')) return '下载地址无权限访问（403）';
  if (lower.includes('no space left on device')) return '磁盘空间不足';
  const firstLine = text.split('\n').map(s => s.trim()).find(Boolean) || text;
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine;
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

  const handlePause = async (dl) => {
    try {
      if (dl.type === 'comfyui') {
        await comfyuiService.pauseDownload(dl.comfyuiTaskId);
      } else if (dl.type === 'asr') {
        await asrModelsService.pauseDownload(dl.comfyuiTaskId);
      } else if (dl.type === 'tts') {
        await ttsService.pauseDownload(dl.comfyuiTaskId);
      } else {
        await downloadService.pause(dl.modelId, dl.targetQuantization);
      }
      loadDownloads();
    } catch (e) {
      message.error('暂停失败');
    }
  };

  const handleResume = async (dl) => {
    try {
      if (dl.type === 'comfyui') {
        await comfyuiService.resumeDownload(dl.comfyuiTaskId);
      } else if (dl.type === 'asr') {
        await asrModelsService.resumeDownload(dl.comfyuiTaskId);
      } else if (dl.type === 'tts') {
        await ttsService.resumeDownload(dl.comfyuiTaskId);
      } else {
        await downloadService.resume(dl.modelId, dl.targetQuantization);
      }
      loadDownloads();
    } catch (e) {
      message.error('恢复失败');
    }
  };

  const handleCancel = async (dl) => {
    try {
      if (dl.type === 'comfyui') {
        await comfyuiService.cancelDownload(dl.comfyuiTaskId);
      } else if (dl.type === 'asr') {
        await asrModelsService.cancelDownload(dl.comfyuiTaskId);
      } else if (dl.type === 'tts') {
        await ttsService.cancelDownload(dl.comfyuiTaskId);
      } else {
        await downloadService.cancel(dl.modelId, dl.targetQuantization);
      }
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
                    {dl.type === 'model' && <Tag color="blue" style={{ marginLeft: 8 }}>LLM</Tag>}
                    {dl.type === 'engine' && <Tag color="purple" style={{ marginLeft: 8 }}>引擎</Tag>}
                    {dl.type === 'comfyui' && <Tag color="green" style={{ marginLeft: 8 }}>ComfyUI</Tag>}
                    {dl.type === 'asr' && <Tag color="cyan" style={{ marginLeft: 8 }}>ASR</Tag>}
                    {dl.type === 'tts' && <Tag color="geekblue" style={{ marginLeft: 8 }}>TTS</Tag>}
                  </Text>
                  <Space size={4}>
                    {dl.type !== 'comfyui' && dl.targetQuantization && (
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
                    {dl.status === 'failed' && summarizeDownloadError(dl.error)}
                  </Text>

                  <Space size={4}>
                    {dl.status === 'downloading' && (
                      <Button
                        size="small"
                        icon={<PauseCircleOutlined />}
                        onClick={() => handlePause(dl)}
                      >
                        暂停
                      </Button>
                    )}
                    {dl.status === 'paused' && (
                      <Button
                        size="small"
                        icon={<PlayCircleOutlined />}
                        onClick={() => handleResume(dl)}
                      >
                        继续
                      </Button>
                    )}
                    {(dl.status === 'downloading' || dl.status === 'paused') && (
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleCancel(dl)}
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
