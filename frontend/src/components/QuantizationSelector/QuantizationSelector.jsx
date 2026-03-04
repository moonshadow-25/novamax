import React, { useState } from 'react';
import { Modal, Button, Space, Tag, Divider, Alert, Progress, Tooltip } from 'antd';
import {
  StarOutlined,
  CheckCircleFilled,
  DownloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import './QuantizationSelector.css';

const CATEGORY_LABELS = {
  original: '原始精度',
  high: '高质量',
  balanced: '平衡推荐',
  compressed: '极致压缩',
  ultra_compressed: '超级压缩'
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
  downloadingQuant,
  downloadStatus,
  downloadProgress,
  onDownload,
  onSwitch,
  onSwitchFile,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onCancel
}) {
  // 使用新的 downloadedFiles 或回退到旧的 downloadedQuantizations
  const files = downloadedFiles || [];
  const oldQuants = downloadedQuantizations || [];

  // 组合视图：预设 + 已下载文件
  const allItems = [
    // 1. 预设中的项
    ...quantizations.map(preset => {
      // 查找匹配的文件
      const matchedFile = files.find(f => f.matched_preset === preset.name);
      const isDownloadedOld = oldQuants.includes(preset.name);
      const isDownloaded = !!matchedFile || isDownloadedOld;
      const isActive = matchedFile?.is_active || false;

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
        isActive
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

  // 获取推荐版本
  const recommended = quantizations.find(q => q.recommended);

  // 格式化字节数
  function formatBytes(bytes) {
    if (!bytes) return '未知';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  const renderQuantizationItem = (item) => {
    const isTargetQuant = downloadingQuant === item.name;
    const isDownloading = isTargetQuant && downloadStatus === 'downloading';
    const isPaused = isTargetQuant && downloadStatus === 'paused';
    const isCompleted = isTargetQuant && downloadStatus === 'completed';
    const isCurrent = currentSelection === item.name || item.isActive;
    const progress = (isDownloading || isPaused) ? (downloadProgress || 0) : 0;

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
                <Tooltip title="推荐版本">
                  <StarOutlined style={{ color: '#faad14', marginLeft: 8, fontSize: 16 }} />
                </Tooltip>
              )}
              {isCurrent && (
                <Tag color="blue" style={{ marginLeft: 8 }}>当前使用</Tag>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>
              {item.description}
              {item.quality && ` · 质量: ${item.quality}%`}
            </div>
            {/* 显示文件名（如果有） */}
            {item.file && item.type === 'preset' && (
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                文件: {item.file.filename}
              </div>
            )}
          </div>

          {/* 右侧：操作按钮 */}
          <div style={{ marginLeft: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* 已下载标记 */}
            {(item.isDownloaded || isCompleted) && !isDownloading && !isPaused && (
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: 20 }} />
            )}

            {/* 设为默认按钮 - 统一逻辑，不区分已下载/未下载 */}
            {!isCurrent && !isDownloading && !isPaused && (
              <Button
                size="small"
                onClick={() => {
                  // 如果有文件信息且已下载，使用新的切换文件方法
                  if (item.file && item.isDownloaded && onSwitchFile) {
                    onSwitchFile(item.file.filename);
                  } else {
                    // 否则使用设置默认量化版本方法
                    onSwitch(item.name);
                  }
                }}
              >
                设为默认
              </Button>
            )}

            {/* 下载按钮 - 仅未下载的预设时显示 */}
            {!item.isDownloaded && !isDownloading && !isPaused && !isCompleted && item.type === 'preset' && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => onDownload(item.name)}
                size="small"
              >
                下载
              </Button>
            )}

            {/* 正在下载中 */}
            {isDownloading && (
              <Space size="small">
                <span style={{ fontSize: 12, color: '#1890ff' }}>{progress.toFixed(0)}%</span>
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  onClick={onPauseDownload}
                >
                  暂停
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={onCancelDownload}
                >
                  取消
                </Button>
              </Space>
            )}

            {/* 已暂停 */}
            {isPaused && (
              <Space size="small">
                <span style={{ fontSize: 12, color: '#faad14' }}>已暂停 {progress.toFixed(0)}%</span>
                <Button
                  size="small"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={onResumeDownload}
                >
                  继续
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={onCancelDownload}
                >
                  取消
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
      title="量化版本管理"
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="close" onClick={onCancel}>
          关闭
        </Button>
      ]}
      width={800}
    >
      {recommended && (
        <Alert
          message={`推荐版本: ${recommended.label}`}
          description={recommended.description}
          type="info"
          showIcon
          icon={<StarOutlined />}
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="quantization-selector">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {sortedCategories.map((category) => (
            <div key={category} className="quantization-category">
              <div className="category-header">
                <Tag color={CATEGORY_COLORS[category]}>
                  {CATEGORY_LABELS[category] || category}
                </Tag>
              </div>
              <Space direction="vertical" size="small" style={{ width: '100%', marginTop: 8 }}>
                {groupedQuantizations[category].map(renderQuantizationItem)}
              </Space>
            </div>
          ))}
        </Space>
      </div>

      <Divider />

      <div style={{ fontSize: '12px', color: '#999' }}>
        <div>💡 提示：</div>
        <div>• 点击"设为默认"可以选择默认的量化版本，然后在卡片上点击"下载模型"</div>
        <div>• 可以同时下载和保留多个量化版本</div>
        <div>• 质量越高效果越好，但文件越大、占用显存越多</div>
      </div>
    </Modal>
  );
}

export default QuantizationSelector;
