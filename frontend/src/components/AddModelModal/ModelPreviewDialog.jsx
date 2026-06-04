import React, { useState } from 'react';
import { Modal, Descriptions, Badge, Collapse, Tag, Space, Typography } from 'antd';
import { CheckCircleOutlined, StarOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

function ModelPreviewDialog({ visible, preview, config, onConfirm, onCancel }) {
  const { t } = useTranslation('home');
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
    original: t('quantization.category.original'),
    high: t('quantization.category.high'),
    balanced: t('quantization.category.balanced'),
    compressed: t('quantization.category.compressed'),
    ultra_compressed: t('quantization.category.ultraCompressed')
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
      title={t('modelPreviewDialog.title')}
      open={visible}
      onOk={handleConfirm}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      okText={t('modelPreviewDialog.confirmAddModel')}
      cancelText={t('settingsDrawer.cancel')}
      width={700}
    >
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={t('modelPreviewDialog.name')}>
          <Text strong>{preview.name}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('modelPreviewDialog.type')}>
          <Tag color="blue">{config?.type?.toUpperCase() || 'LLM'}</Tag>
        </Descriptions.Item>
        {preview.filter_folder && (
          <Descriptions.Item label={t('modelPreviewDialog.folderFilter')}>
            <Tag color="gold" icon={<FolderOutlined />}>
              {t('modelPreviewDialog.filteredTo', { folder: preview.filter_folder })}
            </Tag>
          </Descriptions.Item>
        )}
        <Descriptions.Item label={t('modelPreviewDialog.description')}>
          <Paragraph ellipsis={{ rows: 3, expandable: true }}>
            {preview.description}
          </Paragraph>
        </Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 16 }}>
        <Text strong>
          {t('modelPreviewDialog.availableQuantizations', { count: preview.quantizations.length })}
        </Text>
        <Collapse
          defaultActiveKey={[]}
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
                        <Tag color="gold">{t('quantization.recommendedVersion')}</Tag>
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
            <Text strong>{t('modelPreviewDialog.capabilitySupport')}</Text>
            {preview.capabilities?.chat && (
              <Badge status="success" text={t('modelPreviewDialog.capabilityChat')} />
            )}
            {preview.capabilities?.vision && (
              <Badge status="success" text={t('modelPreviewDialog.capabilityVisionWithCount', { count: preview.mmproj_count })} />
            )}
            {preview.capabilities?.completion && (
              <Badge status="success" text={t('modelPreviewDialog.capabilityCompletion')} />
            )}
          </Space>
          {preview.mmproj_count > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              {t('modelPreviewDialog.multimodalDetectedHint')}
            </Text>
          )}
        </Space>
      </div>
    </Modal>
  );
}

export default ModelPreviewDialog;
