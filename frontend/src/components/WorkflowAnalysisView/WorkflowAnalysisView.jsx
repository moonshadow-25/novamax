import React from 'react';
import { Descriptions, Tag, Typography, Space } from 'antd';
import { FileTextOutlined, NumberOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './WorkflowAnalysisView.css';

const { Title, Text } = Typography;

const WORKFLOW_TYPE_LABELS = {
  'text2img': { labelKey: 'textToImage', color: 'blue' },
  'img2img': { labelKey: 'imageToImage', color: 'green' },
  'text2video': { labelKey: 'textToVideo', color: 'purple' },
  'img2video': { labelKey: 'imageToVideo', color: 'orange' }
};

function WorkflowAnalysisView({ analysis }) {
  const { t } = useTranslation('home');
  if (!analysis) return null;

  const { workflow, parameter_mapping, default_parameters, node_count } = analysis;
  const workflowType = WORKFLOW_TYPE_LABELS[workflow.type] || null;
  const workflowTypeLabel = workflowType ? t(workflowType.labelKey) : workflow.type;

  return (
    <div className="workflow-analysis-view">
      <Title level={5}>
        <FileTextOutlined /> {t('workflowAnalysisView.analysisResult')}
      </Title>

      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label={t('workflowAnalysisView.workflowType')}>
          <Tag color={workflowType?.color || 'default'}>{workflowTypeLabel}</Tag>
        </Descriptions.Item>

        <Descriptions.Item label={t('workflowAnalysisView.functionDescription')}>
          <Text>{workflow.llm_analysis}</Text>
        </Descriptions.Item>

        <Descriptions.Item label={t('workflowAnalysisView.nodeCount')}>
          <Space>
            <NumberOutlined />
            <Text>{t('workflowAnalysisView.nodeCountValue', { count: node_count })}</Text>
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label={t('workflowAnalysisView.supportedParameters')}>
          <Space wrap>
            {Object.keys(parameter_mapping.inputs).map(param => (
              <Tag key={param}>{param}</Tag>
            ))}
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label={t('workflowAnalysisView.defaultParameters')}>
          <Space direction="vertical" size={2}>
            {Object.entries(default_parameters).map(([key, value]) => (
              <Text key={key} type="secondary" style={{ fontSize: 12 }}>
                {key}: {value}
              </Text>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

export default WorkflowAnalysisView;
