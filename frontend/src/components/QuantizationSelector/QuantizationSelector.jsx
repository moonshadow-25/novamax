import React, { useState, useEffect } from 'react';
import { Modal, Button, Space, Tag, Divider, Alert, Progress, Tooltip, Collapse } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  StarOutlined,
  CheckCircleFilled,
  DownloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  CaretRightOutlined,
  WarningFilled
} from '@ant-design/icons';
import { systemService } from '../../services/api';
import './QuantizationSelector.css';

const CATEGORY_KEY_MAP = {
  original: 'original',
  high: 'high',
  balanced: 'balanced',
  compressed: 'compressed',
  ultra_compressed: 'ultraCompressed'
};

const CATEGORY_COLORS = {
  original: 'purple',
  high: 'blue',
  balanced: 'green',
  compressed: 'orange',
  ultra_compressed: 'red'
};

function QuantizationSelector({
  visible,
  quantizations,
  currentSelection,
  downloadedQuantizations,
  downloadedFiles,
  downloadStates = [],
  activeFileOk = true,
  onDownload,
  onSwitch,
  onSwitchFile,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onDeleteQuantization,
  onStart,
  onCancel
}) {
  const { t } = useTranslation('home');
  // 使用新的 downloadedFiles 或回退到旧的 downloadedQuantizations
  const files = downloadedFiles || [];
  const oldQuants = downloadedQuantizations || [];

  // 系统内存总量（RAM + VRAM），用于判断是否超出设备可用内存
  const [systemMemoryTotal, setSystemMemoryTotal] = useState(0);

  useEffect(() => {
    if (!visible) return;
    systemService.getInfo().then(data => {
      const ram = data?.hardware?.memory?.total || 0;
      const vram = (data?.hardware?.gpus || []).reduce((sum, gpu) => sum + (gpu.total || 0), 0);
      setSystemMemoryTotal(ram + vram);
    }).catch(() => {});
  }, [visible]);

  // 组合视图：预设 + 已下载文件
  const allItems = [
    // 1. 预设中的项
    ...quantizations.map(preset => {
      // 查找匹配的文件
      const matchedFile = files.find(f => f.matched_preset === preset.name);
      const isDownloadedOld = oldQuants.includes(preset.name);
      // 若该预设是当前激活版本且文件不完整，视为未下载以显示下载按钮
      const isIncomplete = preset.name === currentSelection && activeFileOk === false;
      const isActive = (matchedFile?.is_active === true) && !isIncomplete;
      const isDownloaded = (!!matchedFile || isDownloadedOld) && !isIncomplete;

      return {
        type: 'preset',
        id: preset.name,
        name: preset.name,
        label: preset.label,
        description: preset.description,
        category: preset.category,
        quality: preset.quality,
        recommended: preset.recommended,
        isDownloaded,
        file: matchedFile,
        isActive,
        presetFileSize: preset?.total_size || preset?.file?.size || 0
      };
    }),

    // 2. 未匹配预设的已下载文件
    ...files
      .filter(f => !quantizations.some(p => p.name === f.matched_preset))
      .map(file => ({
        type: 'file',
        id: file.filename,
        name: file.filename,
        label: file.filename,
        description: `文件大小: ${formatBytes(file.size)}`,
        category: 'unknown',
        quality: null,
        recommended: false,
        isDownloaded: true,
        file: file,
        isActive: file.is_active
      }))
  ];

  // 是否有任何文件处于激活状态
  const hasAnyActiveFile = allItems.some(i => i.isActive);

  // 按分类组织量化版本
  const groupedQuantizations = {};
  allItems.forEach(item => {
    if (!groupedQuantizations[item.category]) {
      groupedQuantizations[item.category] = [];
    }
    groupedQuantizations[item.category].push(item);
  });

  // 排序分类
  const sortedCategories = Object.keys(groupedQuantizations).sort((a, b) => {
    const orderMap = { original: 1, high: 2, balanced: 3, compressed: 4, ultra_compressed: 5, unknown: 99 };
    return (orderMap[a] || 99) - (orderMap[b] || 99);
  });

  // 获取推荐版本（后端计算）
  const recommended = quantizations.find(q => q.recommended) || null;

  // 推荐版本的下载/状态信息
  const recommendedItem = recommended ? allItems.find(i => i.name === recommended.name) : null;
  const recommendedState = recommended ? downloadStates.find(s => s.targetQuantization === recommended.name) : null;
  const recommendedDownloading = recommendedState?.status === 'downloading';
  const recommendedPaused = recommendedState?.status === 'paused';
  const recommendedDownloaded = recommendedItem?.isDownloaded;

  // 格式化字节数
  function formatBytes(bytes) {
    if (!bytes) return t('quantization.unknown');
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${parseFloat(gb.toFixed(2))} GB`;
    const mb = bytes / (1024 * 1024);
    return `${parseFloat(mb.toFixed(2))} MB`;
  }

  const renderQuantizationItem = (item) => {
    // 从 downloadStates 数组中查找该量化版本的下载状态
    const itemState = downloadStates.find(s => s.targetQuantization === item.name);
    const isDownloading = itemState?.status === 'downloading';
    const isPaused = itemState?.status === 'paused';
    const isCompleted = itemState?.status === 'completed';
    const isFailed = itemState?.status === 'failed';
    // 判断是否为当前默认：
    // - 有激活文件时：只有激活的文件是当前默认
    // - 没有激活文件时：匹配 currentSelection（selected_quantization）的是当前默认
    const isCurrent = hasAnyActiveFile
      ? item.isActive
      : currentSelection === item.name;
    const progress = itemState?.progress || 0;

    return (
      <div
        key={item.id}
        className={`quantization-item ${isCurrent ? 'current' : ''} ${isDownloading || isPaused ? 'downloading' : ''}`}
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        {/* 下载进度背景 */}
        {(isDownloading || isPaused) && (
          <div
            className="download-progress-bg"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${progress}%`,
              background: isPaused
                ? 'linear-gradient(90deg, rgba(250, 173, 20, 0.1) 0%, rgba(250, 173, 20, 0.2) 100%)'
                : 'linear-gradient(90deg, rgba(24, 144, 255, 0.1) 0%, rgba(24, 144, 255, 0.2) 100%)',
              transition: 'width 0.3s ease',
              zIndex: 0
            }}
          />
        )}

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', padding: '12px' }}>
          {/* 左侧：版本信息 */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>
                {item.label}
              </span>
              {item.recommended && (
                <Tooltip title={t('quantization.recommendedVersion')}>
                  <StarOutlined style={{ color: '#faad14', marginLeft: 8, fontSize: 16 }} />
                </Tooltip>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>
              {item.description}
              {item.quality && ` · ${t('quantization.quality')}: ${item.quality}%`}
            </div>
            {/* 显示文件名（如果有） */}
            {item.file && item.type === 'preset' && (
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                {t('quantization.file')}: {item.file.filename}
              </div>
            )}
          </div>

          {/* 右侧：操作按钮 */}
          <div style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* 删除按钮 - 仅已下载的量化版本显示 */}
            {(item.isDownloaded || isCompleted) && !isDownloading && !isPaused && item.file && onDeleteQuantization && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  Modal.confirm({
                    title: t('quantization.deleteThisVersion'),
                    content: t('quantization.confirmDelete', { label: item.label }),
                    okText: t('modelCard.delete'),
                    cancelText: t('modelCard.cancel'),
                    okButtonProps: { danger: true },
                    onOk: () => onDeleteQuantization(item.file.filename)
                  });
                }}
                title={t('quantization.deleteThisVersion')}
              />
            )}

            {/* 内存不足警告图标 - 仅未下载且文件大小超过设备可用内存时显示 */}
            {!item.isDownloaded && !isDownloading && !isPaused && !isCompleted && !isFailed && item.type === 'preset' &&
              systemMemoryTotal > 0 && item.presetFileSize > 0 && item.presetFileSize > systemMemoryTotal && (
              <Tooltip title={t('quantization.memoryExceededWarning')}>
                <WarningFilled style={{ color: '#faad14', fontSize: 20, cursor: 'default' }} />
              </Tooltip>
            )}

            {/* 下载按钮 - 仅未下载的预设时显示 */}
            {!item.isDownloaded && !isDownloading && !isPaused && !isCompleted && !isFailed && item.type === 'preset' && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => onDownload(item.name)}
                size="small"
              >
                {t('quantization.download')}
              </Button>
            )}

            {/* 默认选中标记 */}
            {isCurrent && !isDownloading && !isPaused && (
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: 20 }} />
            )}

            {/* 设为默认按钮 - 统一逻辑，不区分已下载/未下载 */}
            {!isCurrent && !isDownloading && !isPaused && (
              <Button
                size="small"
                onClick={() => {
                  if (item.file && item.isDownloaded && onSwitchFile) {
                    onSwitchFile(item.file.filename);
                  } else {
                    onSwitch(item.name);
                  }
                }}
              >
                {t('quantization.setAsDefault')}
              </Button>
            )}

            {/* 下载失败 */}
            {isFailed && (
              <Space size="small">
                <span style={{ fontSize: 12, color: '#ff4d4f' }}>{t('quantization.failed')}</span>
                <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => onResumeDownload(item.name)}>{t('quantization.retry')}</Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => onCancelDownload(item.name)}
                >
                  {t('quantization.cancel')}
                </Button>
              </Space>
            )}

            {/* 正在下载中 */}
            {isDownloading && (
              <Space size="small">
                <span style={{ fontSize: 12, color: '#1890ff' }}>{progress.toFixed(0)}%</span>
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  onClick={() => onPauseDownload(item.name)}
                >
                  {t('quantization.pause')}
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => onCancelDownload(item.name)}
                >
                  {t('quantization.cancel')}
                </Button>
              </Space>
            )}

            {/* 已暂停 */}
            {isPaused && (
              <Space size="small">
                <span style={{ fontSize: 12, color: '#faad14' }}>{t('quantization.pausedWithProgress', { progress: progress.toFixed(0) })}</span>
                <Button
                  size="small"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={() => onResumeDownload(item.name)}
                >
                  {t('quantization.resume')}
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => onCancelDownload(item.name)}
                >
                  {t('quantization.cancel')}
                </Button>
              </Space>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={t('quantization.title')}
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="close" onClick={onCancel}>
          {t('quantization.close')}
        </Button>
      ]}
      width={800}
    >
      {recommended && (
        <div className="recommended-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StarOutlined style={{ color: '#faad14', fontSize: 20 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{t('quantization.recommendedVersionWithLabel', { label: recommended.label })}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{recommended.description}</div>
            </div>
            {recommendedDownloaded ? (
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: 20 }} />
            ) : !recommendedDownloading && !recommendedPaused && (
              <>
                {systemMemoryTotal > 0 && (recommended?.total_size || recommended?.file?.size || 0) > systemMemoryTotal && (
                  <Tooltip title={t('quantization.memoryExceededWarning')}>
                    <WarningFilled style={{ color: '#faad14', fontSize: 20, cursor: 'default' }} />
                  </Tooltip>
                )}
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  size="small"
                  onClick={() => onDownload(recommended.name)}
                >
                  {t('quantization.download')}
                </Button>
              </>
            )}
            {recommendedDownloading && (
              <span style={{ fontSize: 12, color: '#1890ff' }}>{t('quantization.downloadingWithProgress', { progress: (recommendedState?.progress || 0).toFixed(0) })}</span>
            )}
            {recommendedPaused && (
              <span style={{ fontSize: 12, color: '#faad14' }}>{t('quantization.paused')}</span>
            )}
          </div>
        </div>
      )}

      <div className="quantization-selector">
        <Collapse
          ghost
          items={sortedCategories.map((category) => ({
            key: category,
            label: (
              <Tag color={CATEGORY_COLORS[category]}>
                {t(`quantization.category.${CATEGORY_KEY_MAP[category]}`) || category}
              </Tag>
            ),
            children: (
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                {groupedQuantizations[category].map(renderQuantizationItem)}
              </Space>
            )
          }))}
        />
      </div>

      <Divider />

      <div style={{ fontSize: '12px', color: '#999' }}>
        <div>💡 {t('quantization.tipTitle')}</div>
        <div>{t('quantization.tipSetDefaultThenDownload')}</div>
        <div>{t('quantization.tipKeepMultiple')}</div>
        <div>{t('quantization.tipQualityTradeoff')}</div>
      </div>
    </Modal>
  );
}

export default QuantizationSelector;
