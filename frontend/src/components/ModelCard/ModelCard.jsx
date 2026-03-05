import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Tag, Progress, message, Modal, Input, Descriptions, Typography, Divider, Drawer } from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  SettingOutlined,
  MessageOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PauseCircleOutlined,
  SwapOutlined,
  AppstoreOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { backendService, modelService, downloadService } from '../../services/api';
import ParametersDrawer from '../ParametersDrawer/ParametersDrawer';
import QuantizationSelector from '../QuantizationSelector/QuantizationSelector';
import RequiredModelsPanel from '../RequiredModelsPanel/RequiredModelsPanel';
import UserMappingPanel from '../UserMappingPanel/UserMappingPanel';
import './ModelCard.css';

const { Text } = Typography;

function ModelCard({ model, onUpdate }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [parametersVisible, setParametersVisible] = useState(false);
  const [quantizationSelectorVisible, setQuantizationSelectorVisible] = useState(false);
  const [realDownloadedQuantizations, setRealDownloadedQuantizations] = useState([]);
  const [realDownloadedFiles, setRealDownloadedFiles] = useState([]);
  const [pollInterval, setPollInterval] = useState(null);
  const [workflowModalVisible, setWorkflowModalVisible] = useState(false);
  const [comfyuiSettingsVisible, setComfyuiSettingsVisible] = useState(false);

  // 监听下载状态变化，自动停止轮询
  useEffect(() => {
    // 当下载完成或失败时，停止轮询
    if (pollInterval && (!model.download_status || model.download_status === 'failed')) {
      console.log('下载状态变化，停止轮询:', model.download_status);
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [model.download_status, pollInterval]);

  const handleStart = async () => {
    setLoading(true);
    try {
      await backendService.start(model.id, 'single'); // 使用单模型模式
      message.success('模型启动成功');
      onUpdate();
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || '模型启动失败';
      message.error(errorMsg);
      console.error('模型启动失败:', error);
      onUpdate(); // 更新状态以显示错误
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await backendService.stop(model.id);
      message.success('模型已停止');
      onUpdate();
    } catch (error) {
      message.error('停止失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    // 直接下载默认选择的量化版本
    startDownload();
  };

  const startDownload = async () => {
    setLoading(true);
    try {
      console.log('调用下载服务, 模型ID:', model.id);
      const result = await downloadService.start(model.id);
      console.log('下载服务响应:', result);
      message.success('开始下载');
      onUpdate();
    } catch (error) {
      console.error('下载失败:', error);
      message.error(error.response?.data?.error || '下载失败');
    } finally {
      setLoading(false);
    }
  };

  // 管理量化版本
  const handleManageQuantizations = async () => {
    // 清理旧的轮询
    if (pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }

    // 实时查询已下载的量化版本和文件
    const scanFiles = async () => {
      try {
        // 获取新格式的文件列表
        const filesResult = await modelService.scanDownloadedFiles(model.id);
        setRealDownloadedFiles(filesResult.downloadedFiles || []);
        console.log('实时扫描已下载的文件:', filesResult.downloadedFiles);

        // 为了兼容性，也获取旧格式的量化版本列表
        const quantsResult = await modelService.getDownloadedQuantizations(model.id);
        setRealDownloadedQuantizations(quantsResult.downloadedQuantizations || []);

        // 调用 onUpdate() 刷新整个 model 对象（包括 download_status）
        onUpdate();
      } catch (error) {
        console.error('查询已下载文件失败:', error);
        // 失败时使用数据库中的数据
        setRealDownloadedFiles(model.downloaded_files || []);
        setRealDownloadedQuantizations(model.downloaded_quantizations || []);
      }
    };

    await scanFiles();

    // 如果有下载中的任务，启动轮询
    if (model.download_status === 'downloading' || model.download_status === 'completed') {
      const interval = setInterval(async () => {
        await scanFiles();
      }, 2000);
      setPollInterval(interval);
    }

    setQuantizationSelectorVisible(true);
  };

  // 下载指定的量化版本
  const handleDownloadQuantization = async (quantizationName) => {
    setLoading(true);
    try {
      // 开始下载（传递量化版本名称，不修改 selected_quantization）
      await downloadService.start(model.id, quantizationName);
      message.success(`开始下载 ${quantizationName} 版本`);
      onUpdate();
    } catch (error) {
      message.error(error.response?.data?.error || '下载失败');
    } finally {
      setLoading(false);
    }
  };

  // 切换到已下载的量化版本（旧方法，兼容保留）
  const handleSwitchQuantization = async (quantizationName) => {
    if (quantizationName === model.selected_quantization) {
      message.info('已经是当前量化版本');
      return;
    }

    try {
      await modelService.update(model.id, {
        selected_quantization: quantizationName
      });

      message.success('量化版本已切换');
      onUpdate();
    } catch (error) {
      message.error('切换失败');
    }
  };

  // 切换到指定文件（新方法）
  const handleSwitchToFile = async (filename) => {
    try {
      await modelService.setActiveFile(model.id, filename);
      message.success('已切换到: ' + filename);
      onUpdate();
    } catch (error) {
      message.error('切换失败');
    }
  };

  const handlePauseDownload = async () => {
    setLoading(true);
    try {
      await downloadService.pause(model.id);
      message.success('已暂停下载');
      onUpdate();
    } catch (error) {
      message.error('暂停失败');
    } finally {
      setLoading(false);
    }
  };

  const handleResumeDownload = async () => {
    setLoading(true);
    try {
      await downloadService.resume(model.id);
      message.success('继续下载');
      onUpdate();
    } catch (error) {
      message.error('恢复下载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDownload = async () => {
    if (window.confirm('确定要取消下载吗？已下载的数据将被删除。')) {
      setLoading(true);
      try {
        await downloadService.cancel(model.id);
        message.success('已取消下载');
        onUpdate();
      } catch (error) {
        message.error('取消失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleUse = () => {
    const routes = {
      llm: `/llm/${model.id}`,
      comfyui: `/comfyui/${model.id}`,
      tts: `/tts/${model.id}`,
      whisper: `/whisper/${model.id}`
    };
    navigate(routes[model.type]);
  };

  const handleSettings = () => {
    if (model.type === 'comfyui') {
      setComfyuiSettingsVisible(true);
    } else {
      setParametersVisible(true);
    }
  };

  const handleCleanFiles = async () => {
    if (window.confirm('确定要清理此模型的文件吗？配置将保留，可以重新下载。')) {
      try {
        await modelService.deleteFiles(model.id);
        message.success('文件已清理');
        onUpdate();
      } catch (error) {
        message.error('清理失败');
      }
    }
  };

  const handleDelete = async () => {
    if (window.confirm('⚠️ 警告：此操作将删除模型配置和所有文件，确定要继续吗？')) {
      try {
        await modelService.delete(model.id);
        message.success('模型已删除');
        onUpdate();
      } catch (error) {
        message.error('删除失败');
      }
    }
  };

  const isRunning = model.status === 'running';
  // 如果 downloaded_quantizations 数组有内容，或者下载状态是 completed，说明至少有一个量化版本已下载
  const isDownloaded = model.downloaded
    || (model.downloaded_quantizations && model.downloaded_quantizations.length > 0)
    || model.download_status === 'completed';
  const downloadStatus = model.download_status;
  const downloadProgress = model.download_progress || 0;

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (!bytes) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const totalSize = (model.files?.model?.size || 0) + (model.files?.mmproj?.size || 0);

  // 获取当前选择的量化版本信息
  const currentQuant = model.quantizations?.find(q => q.name === model.selected_quantization);

  // 从完整的量化名称中提取显示用的量化类型
  const getQuantizationDisplayName = (quantName) => {
    if (!quantName) return '';

    // 尝试匹配常见的量化类型模式（在字符串末尾）
    const match = quantName.match(/(Q\d+_[KM]_[MS]|Q\d+_[KM]|Q\d+_\d+|IQ\d+_[A-Z]+|BF16|F16|F32)$/i);
    if (match) {
      return match[1].toUpperCase();
    }

    // 如果没有匹配到，尝试从下划线分隔的最后一部分提取
    const parts = quantName.split(/[-_]/);
    const lastPart = parts[parts.length - 1];

    // 检查最后一部分是否看起来像量化类型
    if (/^(Q\d+|IQ\d+|BF16|F16|F32)/i.test(lastPart)) {
      return lastPart.toUpperCase();
    }

    // 如果都失败，返回原始名称
    return quantName;
  };

  return (
    <Card className="model-card" hoverable>
      <div className="model-header">
        <h3 title={model.name}>{model.name}</h3>
        <Space>
          <Tag color={isRunning ? 'green' : 'default'}>
            {isRunning ? '运行中' : '已停止'}
          </Tag>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={handleSettings}
            title="配置参数"
          />
        </Space>
      </div>
      <p className="model-description">{model.description || '暂无描述'}</p>

      {/* 显示量化版本信息 */}
      {currentQuant && (
        <div className="model-quantization">
          {model.quantizations && model.quantizations.length > 1 ? (
            <Tag
              color="blue"
              style={{ cursor: 'pointer' }}
              onClick={handleManageQuantizations}
              title="点击切换量化版本"
            >
              {getQuantizationDisplayName(currentQuant.name)} <SwapOutlined />
            </Tag>
          ) : (
            <Tag color="blue">{getQuantizationDisplayName(currentQuant.name)}</Tag>
          )}
        </div>
      )}

      {!currentQuant && totalSize > 0 && <div className="model-size">大小: {formatSize(totalSize)}</div>}

      {/* 未下载状态 */}
      {!isDownloaded && !downloadStatus && model.type === 'llm' && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
            loading={loading}
            block
          >
            下载模型
          </Button>
        </Space>
      )}

      {/* 下载中状态 */}
      {downloadStatus === 'downloading' && model.type === 'llm' && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress percent={Math.floor(downloadProgress)} status="active" />
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            正在下载... {Math.floor(downloadProgress)}%
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              icon={<PauseCircleOutlined />}
              onClick={handlePauseDownload}
              loading={loading}
              size="small"
            >
              暂停
            </Button>
            <Button
              danger
              onClick={handleCancelDownload}
              loading={loading}
              size="small"
            >
              取消下载
            </Button>
          </Space>
        </div>
      )}

      {/* 下载暂停状态 */}
      {downloadStatus === 'paused' && model.type === 'llm' && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress percent={Math.floor(downloadProgress)} status="normal" />
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            已暂停 {Math.floor(downloadProgress)}%
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleResumeDownload}
              loading={loading}
              size="small"
            >
              继续下载
            </Button>
            <Button
              danger
              onClick={handleCancelDownload}
              loading={loading}
              size="small"
            >
              取消下载
            </Button>
          </Space>
        </div>
      )}

      {/* 下载失败状态 */}
      {downloadStatus === 'failed' && model.type === 'llm' && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress percent={Math.floor(downloadProgress)} status="exception" />
          <div style={{ marginTop: 8, color: '#ff4d4f', fontSize: '12px' }}>
            下载失败: {model.download_error || '未知错误'}
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleResumeDownload}
              loading={loading}
              size="small"
              block
            >
              重试
            </Button>
          </Space>
        </div>
      )}

      {/* ComfyUI专属按钮 */}
      {model.type === 'comfyui' && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => navigate(`/comfyui/${model.id}`)}
            block
          >
            运行
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => setWorkflowModalVisible(true)}
            block
          >
            管理工作流
          </Button>
          {isRunning && (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
              loading={loading}
              block
            >
              停止
            </Button>
          )}
        </Space>
      )}

      {/* ComfyUI工作流管理Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            <span>{model.name}</span>
          </Space>
        }
        open={workflowModalVisible}
        onCancel={() => setWorkflowModalVisible(false)}
        footer={null}
        width={900}
        destroyOnClose
      >
        {model.workflow && (
          <>
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="工作流类型">
                <Tag color="blue">
                  {{ text2img: '文生图', img2img: '图生图', text2video: '文生视频', img2video: '图生视频' }[model.workflow.type] || model.workflow.type}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="节点数量">
                {Object.keys(model.workflow.original || {}).length} 个
              </Descriptions.Item>
              <Descriptions.Item label="功能描述" span={2}>
                <Text>{model.workflow.llm_analysis || model.description}</Text>
              </Descriptions.Item>
            </Descriptions>
            <Divider style={{ margin: '12px 0' }} />
          </>
        )}
        <RequiredModelsPanel
          requiredModels={model.required_models}
          modelId={model.id}
          onUpdate={onUpdate}
        />
      </Modal>

      {/* 已下载状态（非ComfyUI） */}
      {isDownloaded && !downloadStatus && model.type !== 'comfyui' && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
          {!isRunning ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={loading}
              block
            >
              启动
            </Button>
          ) : (
            <>
              <Button
                type="primary"
                icon={<MessageOutlined />}
                onClick={handleUse}
                block
              >
                使用
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                loading={loading}
                block
              >
                停止
              </Button>
            </>
          )}
        </Space>
      )}

      {/* ComfyUI 参数映射设置 */}
      <Drawer
        title="参数映射配置"
        placement="right"
        width={680}
        open={comfyuiSettingsVisible}
        onClose={() => setComfyuiSettingsVisible(false)}
        destroyOnClose
      >
        <UserMappingPanel
          modelId={model.id}
          model={model}
          embedded
          onMappingUpdate={onUpdate}
        />
      </Drawer>

      {/* 参数配置抽屉 */}
      <ParametersDrawer
        visible={parametersVisible}
        modelId={model.id}
        onClose={() => {
          setParametersVisible(false);
          onUpdate();
        }}
      />

      {/* 量化版本选择器 */}
      {model.quantizations && model.quantizations.length > 0 && (
        <QuantizationSelector
          visible={quantizationSelectorVisible}
          quantizations={model.quantizations}
          currentSelection={model.selected_quantization}
          downloadedQuantizations={realDownloadedQuantizations}
          downloadedFiles={realDownloadedFiles}
          downloadingQuant={model.downloading_quantization || null}
          downloadStatus={downloadStatus}
          downloadProgress={downloadProgress}
          onDownload={handleDownloadQuantization}
          onSwitch={handleSwitchQuantization}
          onSwitchFile={handleSwitchToFile}
          onPauseDownload={handlePauseDownload}
          onResumeDownload={handleResumeDownload}
          onCancelDownload={handleCancelDownload}
          onCancel={() => {
            // 关闭弹框时清理轮询
            if (pollInterval) {
              clearInterval(pollInterval);
              setPollInterval(null);
            }
            setQuantizationSelectorVisible(false);
          }}
        />
      )}
    </Card>
  );
}

export default ModelCard;
