import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Tag, Progress, message, Modal, Input, Descriptions, Typography, Divider, Drawer, Alert } from 'antd';
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
  FileTextOutlined,
  StarFilled,
  StarOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { backendService, modelService, downloadService } from '../../services/api';
import ParametersDrawer from '../ParametersDrawer/ParametersDrawer';
import QuantizationSelector from '../QuantizationSelector/QuantizationSelector';
import RequiredModelsPanel from '../RequiredModelsPanel/RequiredModelsPanel';
import UserMappingPanel from '../UserMappingPanel/UserMappingPanel';
import './ModelCard.css';

const { Text } = Typography;

function ModelCard({ model, onUpdate, isFavorited = false, onToggleFavorite }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [parametersVisible, setParametersVisible] = useState(false);
  const [quantizationSelectorVisible, setQuantizationSelectorVisible] = useState(false);
  const [realDownloadedQuantizations, setRealDownloadedQuantizations] = useState([]);
  const [realDownloadedFiles, setRealDownloadedFiles] = useState([]);
  const [pollInterval, setPollInterval] = useState(null);
  const [workflowModalVisible, setWorkflowModalVisible] = useState(false);
  const [comfyuiSettingsVisible, setComfyuiSettingsVisible] = useState(false);
  const [deleteWorkflowVisible, setDeleteWorkflowVisible] = useState(false);
  const [deleteWorkflowInput, setDeleteWorkflowInput] = useState('');

  // 弹框打开时始终轮询，关闭时停止
  useEffect(() => {
    if (!quantizationSelectorVisible) {
      if (pollInterval) {
        clearInterval(pollInterval);
        setPollInterval(null);
      }
      return;
    }
    // 已有轮询则不重复创建
    if (pollInterval) return;

    const interval = setInterval(async () => {
      try {
        const filesResult = await modelService.scanDownloadedFiles(model.id);
        setRealDownloadedFiles(filesResult.downloadedFiles || []);
        const quantsResult = await modelService.getDownloadedQuantizations(model.id);
        setRealDownloadedQuantizations(quantsResult.downloadedQuantizations || []);
        onUpdate();
      } catch (e) { /* ignore */ }
    }, 2000);
    setPollInterval(interval);

    return () => {
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantizationSelectorVisible]);

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
    // 先手动读取一次文件列表
    try {
      const filesResult = await modelService.scanDownloadedFiles(model.id);
      setRealDownloadedFiles(filesResult.downloadedFiles || []);
      const quantsResult = await modelService.getDownloadedQuantizations(model.id);
      setRealDownloadedQuantizations(quantsResult.downloadedQuantizations || []);
      onUpdate();
    } catch (error) {
      console.error('查询已下载文件失败:', error);
      setRealDownloadedFiles(model.downloaded_files || []);
      setRealDownloadedQuantizations(model.downloaded_quantizations || []);
    }
    // 弹框打开后 useEffect 会自动开始轮询
    setQuantizationSelectorVisible(true);
  };

  // 下载指定的量化版本
  const handleDownloadQuantization = async (quantizationName) => {
    setLoading(true);
    try {
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

      // 先刷新模型数据，再更新文件列表，避免中间态闪烁
      await onUpdate();
      const filesResult = await modelService.scanDownloadedFiles(model.id);
      setRealDownloadedFiles(filesResult.downloadedFiles || []);
      message.success('量化版本已切换');
    } catch (error) {
      message.error('切换失败');
    }
  };

  // 切换到指定文件（新方法）
  const handleSwitchToFile = async (filename) => {
    try {
      await modelService.setActiveFile(model.id, filename);

      // 先刷新模型数据，再更新文件列表，避免中间态闪烁
      await onUpdate();
      try {
        const filesResult = await modelService.scanDownloadedFiles(model.id);
        setRealDownloadedFiles(filesResult.downloadedFiles || []);
      } catch (e) {
        console.error('扫描文件失败:', e);
      }
      message.success('已切换到: ' + filename);
    } catch (error) {
      message.error('切换失败');
    }
  };

  const handlePauseDownload = async (quantizationName) => {
    setLoading(true);
    try {
      await downloadService.pause(model.id, quantizationName);
      message.success('已暂停下载');
      onUpdate();
    } catch (error) {
      message.error('暂停失败');
    } finally {
      setLoading(false);
    }
  };

  const handleResumeDownload = async (quantizationName) => {
    setLoading(true);
    try {
      await downloadService.resume(model.id, quantizationName);
      message.success('继续下载');
      onUpdate();
    } catch (error) {
      message.error('恢复下载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDownload = async (quantizationName) => {
    if (window.confirm('确定要取消下载吗？已下载的数据将被删除。')) {
      setLoading(true);
      try {
        await downloadService.cancel(model.id, quantizationName);
        message.success('已取消下载');
        onUpdate();
      } catch (error) {
        message.error('取消失败');
      } finally {
        setLoading(false);
      }
    }
  };

  // 删除指定量化版本文件
  const handleDeleteQuantization = async (filename) => {
    try {
      await modelService.deleteQuantization(model.id, filename);
      message.success('已删除');
      // 先刷新模型数据（更新卡片状态：启动/下载），再刷新文件列表
      await onUpdate();
      try {
        const filesResult = await modelService.scanDownloadedFiles(model.id);
        setRealDownloadedFiles(filesResult.downloadedFiles || []);
      } catch (e) {
        // 如果没有文件了，scanDownloadedFiles 可能返回空
        setRealDownloadedFiles([]);
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleUse = () => {
    if (model.type === 'llm' && model.port) {
      // LLM 模型直接打开 llama.cpp 自带的对话页面
      const host = window.location.hostname || '127.0.0.1';
      window.open(`http://${host}:${model.port}`, '_blank');
      return;
    }
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

  const handleDeleteWorkflow = async () => {
    if (deleteWorkflowInput !== 'delete') return;
    try {
      await modelService.delete(model.id);
      message.success('工作流已删除');
      setDeleteWorkflowVisible(false);
      setDeleteWorkflowInput('');
      setWorkflowModalVisible(false);
      onUpdate();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const isRunning = model.status === 'running';
  
  // 统一使用 model.downloaded_files 作为主要数据源（最可靠）
  // realDownloadedFiles 只在弹窗打开时用于实时显示，关闭后应使用 model 数据
  const downloadedFiles = model.downloaded_files || [];
  const hasActiveFile = downloadedFiles.some(f => f.is_active);
  
  // 检查是否选择了未下载的量化版本（与active文件互斥）
  const hasUndownloadedSelection = model.selected_quantization && !hasActiveFile;
  
  // 下载状态
  const downloadStatus = model.download_status;
  const downloadProgress = model.download_progress || 0;
  
  // 是否正在下载默认版本
  const isDownloadingDefault = (downloadStatus === 'downloading' || downloadStatus === 'paused') &&
                                model.downloading_quantization === model.selected_quantization;

  // 默认版本下载完成（必须是默认量化版本的下载完成）
  const isDefaultDownloadCompleted = downloadStatus === 'completed' &&
                                     model.downloading_quantization === model.selected_quantization;

  // 判断是否可以启动：
  // 场景1：有active文件（已下载的默认版本）且不在下载默认版本
  // 场景2：选中了未下载版本且该版本已下载完成
  const canStart = (hasActiveFile && !isDownloadingDefault) || (hasUndownloadedSelection && isDefaultDownloadCompleted);

  // 判断是否应该显示下载按钮：选中了未下载版本 且 不在下载中/已完成状态
  const shouldDownload = hasUndownloadedSelection &&
                        !isDefaultDownloadCompleted &&
                        !isDownloadingDefault;
  
  // 旧的下载状态判断（兼容）
  const isDownloaded = model.downloaded
    || (model.downloaded_quantizations && model.downloaded_quantizations.length > 0)
    || isDefaultDownloadCompleted;

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (!bytes) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const totalSize = (model.files?.model?.size || 0) + (model.files?.mmproj?.size || 0);

  // 获取当前选择的量化版本信息
  // 卡片状态始终使用 model.downloaded_files（与 model 数据一致），避免与 realDownloadedFiles 不同步导致闪烁
  let currentQuant = null;
  let currentQuantName = null;

  if (hasActiveFile) {
    const activeFile = downloadedFiles.find(f => f.is_active);
    if (activeFile && activeFile.matched_preset) {
      currentQuant = model.quantizations?.find(q => q.name === activeFile.matched_preset);
      currentQuantName = activeFile.matched_preset;
    }
  }
  if (!currentQuant && model.selected_quantization) {
    currentQuant = model.quantizations?.find(q => q.name === model.selected_quantization);
    currentQuantName = model.selected_quantization;
  }

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

  const modelSize = currentQuant?.total_size || currentQuant?.file?.size || totalSize || 0;

  return (
    <Card className="model-card" hoverable>
      <div className="model-header">
        <h3 title={model.name}>{model.name}</h3>
        <Space size={4}>
          {modelSize > 0 && (
            <span className="model-size-badge">{parseFloat((modelSize / (1024 ** 3)).toFixed(2))}GB</span>
          )}
          {model.type === 'llm' && (
            <Button
              size="small"
              type="text"
              icon={isFavorited
                ? <StarFilled style={{ color: '#faad14' }} />
                : <StarOutlined style={{ color: '#bbb' }} />}
              onClick={() => onToggleFavorite?.(model.id)}
              title={isFavorited ? '取消收藏' : '收藏'}
            />
          )}
          <Tag color={isRunning ? 'green' : 'default'} style={{ margin: 0 }}>
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
      {model.modelscope_id && (
        <div className="model-source" title={model.modelscope_id}>
          {model.modelscope_id.split('/')[0]}
        </div>
      )}
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


      {/* 下载按钮 - 当选择了未下载的量化版本且不在下载默认版本时显示 */}
      {shouldDownload && model.type === 'llm' && (
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

      {/* 下载中状态 - 只有当下载的是选中的默认版本时才显示 */}
      {downloadStatus === 'downloading' && hasUndownloadedSelection && 
       model.downloading_quantization === model.selected_quantization && 
       model.type === 'llm' && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress percent={Math.floor(downloadProgress)} status="active" />
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            正在下载... {Math.floor(downloadProgress)}%
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              icon={<PauseCircleOutlined />}
              onClick={() => handlePauseDownload(model.downloading_quantization)}
              loading={loading}
              size="small"
            >
              暂停
            </Button>
            <Button
              danger
              onClick={() => handleCancelDownload(model.downloading_quantization)}
              loading={loading}
              size="small"
            >
              取消下载
            </Button>
          </Space>
        </div>
      )}

      {/* 下载暂停状态 - 只有当下载的是选中的默认版本时才显示 */}
      {downloadStatus === 'paused' && hasUndownloadedSelection && 
       model.downloading_quantization === model.selected_quantization && 
       model.type === 'llm' && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress percent={Math.floor(downloadProgress)} status="normal" />
          <div style={{ marginTop: 8, color: '#666', fontSize: '12px' }}>
            已暂停 {Math.floor(downloadProgress)}%
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => handleResumeDownload(model.downloading_quantization)}
              loading={loading}
              size="small"
            >
              继续下载
            </Button>
            <Button
              danger
              onClick={() => handleCancelDownload(model.downloading_quantization)}
              loading={loading}
              size="small"
            >
              取消下载
            </Button>
          </Space>
        </div>
      )}

      {/* 下载失败状态 - 只有当下载的是选中的默认版本时才显示 */}
      {downloadStatus === 'failed' && hasUndownloadedSelection && 
       model.downloading_quantization === model.selected_quantization && 
       model.type === 'llm' && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress percent={Math.floor(downloadProgress)} status="exception" />
          <div style={{ marginTop: 8, color: '#ff4d4f', fontSize: '12px' }}>
            下载失败: {model.download_error || '未知错误'}
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => handleResumeDownload(model.downloading_quantization)}
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
        footer={
          <div style={{ textAlign: 'left' }}>
            <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteWorkflowVisible(true)}>
              删除工作流
            </Button>
          </div>
        }
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

      {/* 删除工作流确认对话框 */}
      <Modal
        title="确认删除工作流"
        open={deleteWorkflowVisible}
        onOk={handleDeleteWorkflow}
        onCancel={() => {
          setDeleteWorkflowVisible(false);
          setDeleteWorkflowInput('');
        }}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: deleteWorkflowInput !== 'delete' }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            message="提示"
            description="此操作仅删除工作流配置，不会删除已下载的模型文件。"
            type="warning"
            showIcon
          />
          <div>请输入 <strong>delete</strong> 确认删除：</div>
          <Input
            placeholder="输入 delete"
            value={deleteWorkflowInput}
            onChange={(e) => setDeleteWorkflowInput(e.target.value)}
            onPressEnter={handleDeleteWorkflow}
          />
        </Space>
      </Modal>

      {/* 启动按钮 - 当有active文件且不在下载默认版本时显示（非ComfyUI） */}
      {canStart && model.type !== 'comfyui' && (
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
          currentSelection={currentQuantName}
          downloadedQuantizations={realDownloadedQuantizations}
          downloadedFiles={realDownloadedFiles}
          downloadStates={model.download_states || []}
          onDownload={handleDownloadQuantization}
          onSwitch={handleSwitchQuantization}
          onSwitchFile={handleSwitchToFile}
          onPauseDownload={handlePauseDownload}
          onResumeDownload={handleResumeDownload}
          onCancelDownload={handleCancelDownload}
          onDeleteQuantization={handleDeleteQuantization}
          onCancel={async () => {
            // 先刷新模型数据，等待完成
            await onUpdate();
            
            // 再关闭弹窗，确保UI使用最新数据
            setQuantizationSelectorVisible(false);
          }}
        />
      )}
    </Card>
  );
}

export default ModelCard;
