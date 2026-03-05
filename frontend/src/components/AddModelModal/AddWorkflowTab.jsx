import React, { useState } from 'react';
import { Upload, Input, Button, Space, Alert, Spin, Typography, Divider, Card } from 'antd';
import { InboxOutlined, LoadingOutlined, FileTextOutlined, LinkOutlined } from '@ant-design/icons';
import { comfyuiService } from '../../services/api';
import WorkflowAnalysisView from '../WorkflowAnalysisView/WorkflowAnalysisView';

const { Dragger } = Upload;
const { TextArea } = Input;
const { Title, Text } = Typography;

function AddWorkflowTab({ onSuccess, onClose }) {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [apiFileList, setApiFileList] = useState([]);
  const [fullFileList, setFullFileList] = useState([]);
  const [uploadStats, setUploadStats] = useState(null);

  // 处理文件上传
  const handleUpload = async () => {
    if (apiFileList.length === 0) {
      setError('请上传API工作流文件');
      return;
    }

    setUploading(true);
    setAnalyzing(true);
    setError('');

    const formData = new FormData();
    formData.append('apiWorkflow', apiFileList[0]);
    if (fullFileList.length > 0) {
      formData.append('fullWorkflow', fullFileList[0]);
    }
    formData.append('name', workflowName || apiFileList[0].name.replace('.json', ''));
    formData.append('description', workflowDescription);

    try {
      const response = await comfyuiService.uploadWorkflow(formData);

      if (response.success) {
        setAnalysis(response.analysis);
        setWorkflowName(response.name);
        setUploadStats({
          has_full_workflow: response.has_full_workflow,
          models_with_urls: response.models_with_urls,
          total_models: response.total_models
        });
      } else {
        setError(response.error || '工作流分析失败');
        setApiFileList([]);
        setFullFileList([]);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || '上传失败';
      setError(errorMsg);
      setApiFileList([]);
      setFullFileList([]);
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  };

  // 确认保存工作流
  const handleConfirm = async () => {
    if (!analysis) return;

    try {
      const response = await comfyuiService.confirmWorkflow({
        name: workflowName,
        description: workflowDescription || analysis.workflow.llm_analysis,
        analysis
      });

      if (response.success) {
        onSuccess && onSuccess(response.model);
        onClose && onClose();
      } else {
        setError(response.error || '保存失败');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || '保存失败';
      setError(errorMsg);
    }
  };

  // 重新上传
  const handleReupload = () => {
    setAnalysis(null);
    setApiFileList([]);
    setFullFileList([]);
    setError('');
    setUploadStats(null);
  };

  if (analysis) {
    return (
      <div>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 上传统计 */}
          {uploadStats && (
            <Alert
              message={
                uploadStats.has_full_workflow
                  ? `已为 ${uploadStats.models_with_urls}/${uploadStats.total_models} 个模型配置下载源`
                  : '仅上传了API工作流，需要手动搜索模型下载地址'
              }
              type={uploadStats.has_full_workflow ? 'success' : 'warning'}
              showIcon
            />
          )}

          {/* 工作流基本信息 */}
          <div>
            <Title level={5}>工作流信息</Title>
            <Input
              placeholder="工作流名称"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <TextArea
              placeholder="工作流描述（可选）"
              value={workflowDescription}
              onChange={(e) => setWorkflowDescription(e.target.value)}
              rows={2}
            />
          </div>

          <Divider />

          {/* 工作流分析结果 */}
          <WorkflowAnalysisView analysis={analysis} />

          {/* 错误提示 */}
          {error && (
            <Alert
              message={error}
              type="error"
              closable
              onClose={() => setError('')}
            />
          )}

          {/* 操作按钮 */}
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={handleReupload}>重新上传</Button>
            <Button type="primary" onClick={handleConfirm}>
              确认保存
            </Button>
          </Space>
        </Space>
      </div>
    );
  }

  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 说明信息 */}
        <Alert
          message="上传ComfyUI工作流文件"
          description={
            <div>
              <p><strong>API工作流（必需）：</strong>用于执行生图，在ComfyUI中右键选择"Queue Prompt"或使用API格式保存</p>
              <p><strong>完整工作流（推荐）：</strong>包含模型下载链接，在ComfyUI中使用"Save"保存</p>
              <p style={{ marginTop: 8 }}>上传完整工作流后，系统会自动配置模型下载源（HF Mirror、ModelScope等）</p>
            </div>
          }
          type="info"
          showIcon
        />

        {/* API工作流上传（必需） */}
        <Card
          title={
            <Space>
              <FileTextOutlined />
              <span>API工作流 (必需)</span>
            </Space>
          }
          size="small"
        >
          <Dragger
            name="apiWorkflow"
            multiple={false}
            accept=".json"
            fileList={apiFileList}
            beforeUpload={(file) => {
              setApiFileList([file]);
              return false;
            }}
            onRemove={() => setApiFileList([])}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              点击或拖拽上传API工作流
            </p>
            <p className="ant-upload-hint">
              在ComfyUI中右键 → Queue Prompt
            </p>
          </Dragger>
        </Card>

        {/* 完整工作流上传（可选） */}
        <Card
          title={
            <Space>
              <LinkOutlined />
              <span>完整工作流 (推荐)</span>
            </Space>
          }
          size="small"
        >
          <Dragger
            name="fullWorkflow"
            multiple={false}
            accept=".json"
            fileList={fullFileList}
            beforeUpload={(file) => {
              setFullFileList([file]);
              return false;
            }}
            onRemove={() => setFullFileList([])}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              <LinkOutlined />
            </p>
            <p className="ant-upload-text">
              点击或拖拽上传完整工作流
            </p>
            <p className="ant-upload-hint">
              包含模型下载链接，在ComfyUI中使用Save保存
            </p>
          </Dragger>
        </Card>

        {/* 上传按钮 */}
        <Button
          type="primary"
          size="large"
          block
          loading={uploading}
          disabled={apiFileList.length === 0}
          onClick={handleUpload}
        >
          {uploading ? '正在分析工作流...' : '开始分析'}
        </Button>

        {/* 分析进度 */}
        {analyzing && (
          <div style={{ textAlign: 'center' }}>
            <Spin tip="正在分析工作流，请稍候..." />
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <Alert
            message={error}
            type="error"
            closable
            onClose={() => setError('')}
          />
        )}
      </Space>
    </div>
  );
}

export default AddWorkflowTab;
