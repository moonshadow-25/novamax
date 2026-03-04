import React, { useState } from 'react';
import { Modal, Descriptions, Badge, Collapse, Tag, Space, Typography } from 'antd';
import { CheckCircleOutlined, StarOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

function ModelPreviewDialog({ visible, preview, config, onConfirm, onCancel }) {
  const [confirmLoading, setConfirmLoading] = useState(false);

  if (!preview) return null;

  const handleConfirm = async () => {
    setConfirmLoading(true);
    try {
      await onConfirm(config);
    } finally {
      setConfirmLoading(false);
    }
  };

  // 按分类分组量化版本
  const quantizationsByCategory = {
    original: [],
    high: [],
    balanced: [],
    compressed: [],
    ultra_compressed: []
  };

  preview.quantizations.forEach(q => {
    const category = q.category || 'balanced';
    if (quantizationsByCategory[category]) {
      quantizationsByCategory[category].push(q);
    }
  });

  const categoryLabels = {
    original: '原始精度',
    high: '高质量',
    balanced: '平衡推荐',
    compressed: '极致压缩',
    ultra_compressed: '超级压缩'
  };

  const categoryColors = {
    original: 'purple',
    high: 'blue',
    balanced: 'green',
    compressed: 'orange',
    ultra_compressed: 'red'
  };

  return (
    <Modal
      title="模型预览"
      open={visible}
      onOk={handleConfirm}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText="确认添加模型"
      cancelText="取消"
      width={700}
    >
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="名称">
          <Text strong>{preview.name}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="类型">
          <Tag color="blue">{config?.type?.toUpperCase() || 'LLM'}</Tag>
        </Descriptions.Item>
        {preview.filter_folder && (
          <Descriptions.Item label="文件夹筛选">
            <Tag color="gold" icon={<FolderOutlined />}>
              已筛选至: {preview.filter_folder}
            </Tag>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="描述">
          <Paragraph ellipsis={{ rows: 3, expandable: true }}>
            {preview.description}
          </Paragraph>
        </Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 16 }}>
        <Text strong>
          可用量化版本 ({preview.quantizations.length})
        </Text>
        <Collapse
          defaultActiveKey={['balanced']}
          style={{ marginTop: 8 }}
          size="small"
        >
          {Object.entries(quantizationsByCategory).map(([category, quants]) => {
            if (quants.length === 0) return null;

            return (
              <Panel
                header={
                  <Space>
                    <Tag color={categoryColors[category]}>
                      {categoryLabels[category]}
                    </Tag>
                    <Text type="secondary">({quants.length})</Text>
                  </Space>
                }
                key={category}
              >
                {quants.map((q, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 0',
                      borderBottom: idx < quants.length - 1 ? '1px solid #f0f0f0' : 'none'
                    }}
                  >
                    <Space>
                      {q.recommended && (
                        <StarOutlined style={{ color: '#faad14' }} />
                      )}
                      {q.is_folder ? (
                        <FolderOutlined style={{ color: '#1890ff' }} />
                      ) : (
                        <FileOutlined style={{ color: '#52c41a' }} />
                      )}
                      <Text strong>{q.label}</Text>
                      {q.recommended && (
                        <Tag color="gold">推荐</Tag>
                      )}
                    </Space>
                    {q.description && (
                      <div style={{ marginLeft: 24, marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {q.description}
                        </Text>
                      </div>
                    )}
                  </div>
                ))}
              </Panel>
            );
          })}
        </Collapse>
      </div>

      <div style={{ marginTop: 16 }}>
        <Space direction="vertical" size="small">
          <Space>
            <Text strong>功能支持:</Text>
            {preview.capabilities?.chat && (
              <Badge status="success" text="聊天" />
            )}
            {preview.capabilities?.vision && (
              <Badge status="success" text={`视觉 (${preview.mmproj_count} 个 mmproj)`} />
            )}
            {preview.capabilities?.completion && (
              <Badge status="success" text="补全" />
            )}
          </Space>
          {preview.mmproj_count > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              检测到多模态支持文件，该模型支持图像理解
            </Text>
          )}
        </Space>
      </div>
    </Modal>
  );
}

export default ModelPreviewDialog;
