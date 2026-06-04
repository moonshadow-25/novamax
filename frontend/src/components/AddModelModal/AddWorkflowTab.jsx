import React, { useState } from 'react';
import { Upload, Input, Button, Space, Alert, Spin, Typography, Divider, Card } from 'antd';
import { InboxOutlined, LoadingOutlined, FileTextOutlined, LinkOutlined } from '@ant-design/icons';
import { comfyuiService } from '../../services/api';
import { useTranslation } from 'react-i18next';
import WorkflowAnalysisView from '../WorkflowAnalysisView/WorkflowAnalysisView';

const { Dragger } = Upload;
const { TextArea } = Input;
const { Title, Text } = Typography;

function AddWorkflowTab({ onSuccess, onClose }) {
  const { t } = useTranslation('home');
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
      setError(t('addWorkflowTab.uploadApiWorkflowRequired'));
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
        setError(response.error || t('addWorkflowTab.analysisFailed'));
        setApiFileList([]);
        setFullFileList([]);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || t('addWorkflowTab.uploadFailed');
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
        setError(response.error || t('settingsDrawer.saveFailed'));
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || t('settingsDrawer.saveFailed');
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
                  ? t('addWorkflowTab.uploadStatsConfigured', { configured: uploadStats.models_with_urls, total: uploadStats.total_models })
                  : t('addWorkflowTab.uploadStatsManualSearch')
              }
              type={uploadStats.has_full_workflow ? 'success' : 'warning'}
              showIcon
            />
          )}

          {/* 工作流基本信息 */}
          <div>
            <Title level={5}>{t('addWorkflowTab.workflowInfo')}</Title>
            <Input
              placeholder={t('addWorkflowTab.workflowNamePlaceholder')}
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <TextArea
              placeholder={t('addWorkflowTab.workflowDescriptionPlaceholder')}
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
            <Button onClick={handleReupload}>{t('addWorkflowTab.reupload')}</Button>
            <Button type="primary" onClick={handleConfirm}>
              {t('addWorkflowTab.confirmSave')}
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
          message={t('addWorkflowTab.uploadWorkflowFiles')}
          description={
            <div>
              <p><strong>{t('addWorkflowTab.apiWorkflowRequiredTitle')}</strong>{t('addWorkflowTab.apiWorkflowRequiredDesc')}</p>
              <p><strong>{t('addWorkflowTab.fullWorkflowRecommendedTitle')}</strong>{t('addWorkflowTab.fullWorkflowRecommendedDesc')}</p>
              <p style={{ marginTop: 8 }}>{t('addWorkflowTab.autoConfigureSourcesHint')}</p>
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
              <span>{t('addWorkflowTab.apiWorkflowRequiredShort')}</span>
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
              {t('addWorkflowTab.clickOrDragUploadApiWorkflow')}
            </p>
            <p className="ant-upload-hint">
              {t('addWorkflowTab.queuePromptHint')}
            </p>
          </Dragger>
        </Card>

        {/* 完整工作流上传（可选） */}
        <Card
          title={
            <Space>
              <LinkOutlined />
              <span>{t('addWorkflowTab.fullWorkflowRecommendedShort')}</span>
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
              {t('addWorkflowTab.clickOrDragUploadFullWorkflow')}
            </p>
            <p className="ant-upload-hint">
              {t('addWorkflowTab.fullWorkflowSaveHint')}
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
          {uploading ? t('addWorkflowTab.analyzingWorkflow') : t('addWorkflowTab.startAnalysis')}
        </Button>

        {/* 分析进度 */}
        {analyzing && (
          <div style={{ textAlign: 'center' }}>
            <Spin tip={t('addWorkflowTab.analyzingWorkflowPleaseWait')} />
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
