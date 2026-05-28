/**
 * FFmpeg 未安装提示弹窗 — 统一入口。
 * 在所有需要 ffmpeg 的操作中使用此弹窗。
 */
import React from 'react';
import { Modal, Typography, Space } from 'antd';
import { ExclamationCircleOutlined, DownloadOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export default function FfmpegRequiredModal({ open, onClose, onInstall }) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      closable
      maskClosable
      footer={null}
      width={420}
      centered
    >
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <ExclamationCircleOutlined style={{ fontSize: 48, color: '#faad14', marginBottom: 16 }} />
        <Paragraph strong style={{ fontSize: 16, marginBottom: 8 }}>
          FFmpeg 未安装
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 20 }}>
          TTS 的格式转换、音频合片等功能需要 FFmpeg 组件。
          请点击下方按钮下载安装，安装完成后自动可用。
        </Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          <button
            onClick={onInstall}
            style={{
              width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 500,
              background: '#1890ff', color: '#fff', border: 'none', borderRadius: 6,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <DownloadOutlined /> 下载安装 FFmpeg
          </button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            安装完成后刷新页面即可生效
          </Text>
        </Space>
      </div>
    </Modal>
  );
}
