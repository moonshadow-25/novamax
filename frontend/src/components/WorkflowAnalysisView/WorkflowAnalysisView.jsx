import React from 'react';
import { Descriptions, Tag, Typography, Space } from 'antd';
import { FileTextOutlined, NumberOutlined } from '@ant-design/icons';
import './WorkflowAnalysisView.css';

const { Title, Text } = Typography;

const WORKFLOW_TYPE_LABELS = {
  'text2img': { label: '文生图', color: 'blue' },
  'img2img': { label: '图生图', color: 'green' },
  'text2video': { label: '文生视频', color: 'purple' },
  'img2video': { label: '图生视频', color: 'orange' }
};

function WorkflowAnalysisView({ analysis }) {
  if (!analysis) return null;

  const { workflow, parameter_mapping, default_parameters, node_count } = analysis;
  const workflowType = WORKFLOW_TYPE_LABELS[workflow.type] || { label: workflow.type, color: 'default' };

  return (
    <div className="workflow-analysis-view">
      <Title level={5}>
        <FileTextOutlined /> 工作流分析结果
      </Title>

      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="工作流类型">
          <Tag color={workflowType.color}>{workflowType.label}</Tag>
        </Descriptions.Item>

        <Descriptions.Item label="功能描述">
          <Text>{workflow.llm_analysis}</Text>
        </Descriptions.Item>

        <Descriptions.Item label="节点数量">
          <Space>
            <NumberOutlined />
            <Text>{node_count} 个节点</Text>
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label="支持的参数">
          <Space wrap>
            {Object.keys(parameter_mapping.inputs).map(param => (
              <Tag key={param}>{param}</Tag>
            ))}
          </Space>
        </Descriptions.Item>

        <Descriptions.Item label="默认参数">
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
