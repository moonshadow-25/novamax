import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Space, Tag, Progress, message, Modal, Input, Descriptions, Typography, Divider, Drawer, Spin, Popconfirm } from 'antd';
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
  HddOutlined,
  FileTextOutlined,
  StarFilled,
  StarOutlined,
  UndoOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  CloudOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { backendService, modelService, downloadService, comfyuiService, engineService } from '../../services/api';
import ParametersDrawer from '../ParametersDrawer/ParametersDrawer';
import QuantizationSelector from '../QuantizationSelector/QuantizationSelector';
import RequiredModelsPanel from '../RequiredModelsPanel/RequiredModelsPanel';
import UserMappingPanel from '../UserMappingPanel/UserMappingPanel';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';
import './ModelCard.css';

const { Text } = Typography;

const normalizeErrorText = (raw = '') => String(raw)
  .replace(/\uFFFD+/g, '')
  .replace(/\r/g, '')
  .trim();

const summarizeDownloadError = (raw = '') => {
  const text = normalizeErrorText(raw);
  if (!text) return '未知错误';

  const lower = text.toLowerCase();
  if (lower.includes('chunkedencodingerror') || lower.includes('incompleteread') || lower.includes('connection broken')) {
    return '下载中断，网络连接不稳定';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return '下载超时，请稍后重试';
  }
  if (lower.includes('404')) {
    return '下载地址不存在（404）';
  }
  if (lower.includes('403')) {
    return '下载地址无权限访问（403）';
  }
  if (lower.includes('no space left on device')) {
    return '磁盘空间不足';
  }

  const firstLine = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('File "') && !line.startsWith('Traceback')) || text;

  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
};

const getApiErrorMessage = (error) => error?.response?.data?.error || error?.message || '';

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

  // 名称编辑
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(model.name);

  // ComfyUI 启动相关
  const [comfyuiLaunchVisible, setComfyuiLaunchVisible] = useState(false);
  const [comfyuiLaunching, setComfyuiLaunching] = useState(false);
  const [comfyuiLaunchStatus, setComfyuiLaunchStatus] = useState('');
  const launchPollRef = useRef(null);

  // 引擎下载相关
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engineTarget, setEngineTarget] = useState('comfyui'); // 当前引擎目标

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
      // LLM 模型启动前检查 llamacpp 引擎（云API不需要）
      if (model.type === 'llm' && model.source !== 'cloudapi') {
        const engineResult = await engineService.checkInstalled('llamacpp');
        if (!engineResult.installed) {
          setEngineInfo(engineResult.engineInfo);
          setEngineTarget('llamacpp');
          setShowEngineModal(true);
          setLoading(false);
          return;
        }
      }
      await doStartModel();
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || '模型启动失败';
      message.error(errorMsg);
      console.error('模型启动失败:', error);
      onUpdate();
    } finally {
      setLoading(false);
    }
  };

  const doStartModel = async () => {
    setLoading(true);
    try {
      await backendService.start(model.id, 'single');
      message.info('模型正在启动，请稍候...');
      onUpdate();
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || '模型启动失败';
      message.error(errorMsg);
      console.error('模型启动失败:', error);
      onUpdate();
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

  // ComfyUI 运行入口：检查是否有运行中的实例
  const handleComfyUIRun = async () => {
    try {
      const res = await comfyuiService.getInstances();
      const instances = res.instances || [];

      // 检查是否有运行中的实例
      const runningInstance = instances.find(i => i.status === 'running');
      if (runningInstance) {
        // 有运行中的实例，直接进入
        navigate(`/comfyui/${model.id}`);
      } else {
        // 没有运行中的实例，显示启动 Modal
        setComfyuiLaunchVisible(true);
      }
    } catch (error) {
      console.error('Failed to check instances:', error);
      // 出错时直接进入（用户可以手动处理）
      navigate(`/comfyui/${model.id}`);
    }
  };

  const handleComfyUILaunch = async () => {
    setComfyuiLaunching(true);
    setComfyuiLaunchStatus('正在检查引擎...');

    try {
      // 先检查本地引擎是否安装
      const engineResult = await engineService.checkInstalled('comfyui');
      if (!engineResult.installed) {
        setEngineInfo(engineResult.engineInfo);
        setEngineTarget('comfyui');
        setComfyuiLaunchVisible(false);
        setComfyuiLaunching(false);
        setShowEngineModal(true);
        return;
      }

      // 检查所需模型是否全部下载
      setComfyuiLaunchStatus('正在检查模型文件...');
      try {
        const res = await comfyuiService.getModelsStatus(model.id);
        if (res.summary?.missing > 0) {
          setComfyuiLaunchVisible(false);
          setComfyuiLaunching(false);
          message.warning(`还有 ${res.summary.missing} 个模型未下载，请先下载所需模型`);
          onUpdate();
          setWorkflowModalVisible(true);
          return;
        }
      } catch (e) {
        console.error('检查模型状态失败:', e);
      }

      await doLaunchInstance();
    } catch (error) {
      setComfyuiLaunchStatus(`启动失败: ${error.response?.data?.error || error.message}`);
      setComfyuiLaunching(false);
    }
  };

  // 实际启动实例的逻辑，引擎就绪后调用
  const doLaunchInstance = async () => {
    setComfyuiLaunchVisible(true);
    setComfyuiLaunching(true);
    setComfyuiLaunchStatus('正在启动 ComfyUI...');

    try {
      await comfyuiService.ensureInstance();
      const res = await comfyuiService.getInstances();
      const instances = res.instances || [];

      if (instances.length === 0) {
        throw new Error('无法创建 ComfyUI 实例');
      }

      const firstInstance = instances[0];
      await comfyuiService.startInstance(firstInstance.id);

      let attempts = 0;
      setComfyuiLaunchStatus('等待 ComfyUI 就绪...');

      launchPollRef.current = setInterval(async () => {
        attempts++;
        try {
          const host = firstInstance.host === '0.0.0.0' ? '127.0.0.1' : firstInstance.host;
          const result = await comfyuiService.checkConnection(host, firstInstance.port);
          if (result.connected) {
            clearInterval(launchPollRef.current);
            setComfyuiLaunchVisible(false);
            setComfyuiLaunching(false);
            navigate(`/comfyui/${model.id}`);
          }
        } catch (err) {
          console.error('Connection check failed:', err);
        }

        if (attempts >= 60) {
          clearInterval(launchPollRef.current);
          setComfyuiLaunchStatus('连接超时，ComfyUI 可能启动失败');
          setComfyuiLaunching(false);
        }
      }, 1000);
    } catch (error) {
      setComfyuiLaunchStatus(`启动失败: ${error.response?.data?.error || error.message}`);
      setComfyuiLaunching(false);
    }
  };

  const handleComfyUILaunchCancel = () => {
    if (launchPollRef.current) clearInterval(launchPollRef.current);
    setComfyuiLaunchVisible(false);
    setComfyuiLaunching(false);
    setComfyuiLaunchStatus('');
  };

  const handleDownload = async () => {
    // 文件不完整时：直接重新下载激活文件对应的量化版本
    if (hasActiveFile && !model.active_file_ok) {
      const activeFile = downloadedFiles.find(f => f.is_active);
      const quantName = activeFile?.matched_preset;
      if (quantName) {
        setLoading(true);
        try {
          await downloadService.start(model.id, quantName);
          message.success('开始重新下载');
        } catch (error) {
          message.error(summarizeDownloadError(getApiErrorMessage(error)) || '下载失败');
        } finally {
          setLoading(false);
          onUpdate(); // 无论成功/失败都刷新，确保 active_file_ok 状态与磁盘同步
        }
        return;
      }
    }
    // 没有选中量化版本时，先打开选择器让用户选
    if (!model.selected_quantization) {
      handleManageQuantizations();
      return;
    }
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
      message.error(summarizeDownloadError(getApiErrorMessage(error)) || '下载失败');
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
      message.error(summarizeDownloadError(getApiErrorMessage(error)) || '下载失败');
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

  const handleRestoreDefaults = async () => {
    try {
      await modelService.restoreDefaults(model.id);
      message.success('已恢复默认');
      onUpdate();
    } catch (error) {
      message.error('恢复失败');
    }
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      message.warning('模型名称不能为空');
      setNameValue(model.name);
      setEditingName(false);
      return;
    }
    if (trimmed === model.name) { setEditingName(false); return; }
    try {
      await modelService.update(model.id, { name: trimmed });
      onUpdate();
    } catch (e) {
      const errorText = getApiErrorMessage(e) || '重命名失败';
      message.error(errorText);
      setNameValue(model.name);
    }
    setEditingName(false);
  };



  const isRunning = model.status === 'running';
  const isStarting = model.status === 'starting';
  
  // 统一使用 model.downloaded_files 作为主要数据源（最可靠）
  // realDownloadedFiles 只在弹窗打开时用于实时显示，关闭后应使用 model 数据
  const downloadedFiles = model.downloaded_files || [];
  const hasActiveFile = downloadedFiles.some(f => f.is_active);
  // 激活文件磁盘完整性（由后端校验文件是否存在且大小匹配）
  const activeFileOk = hasActiveFile && model.active_file_ok === true;
  // 激活文件对应的量化版本名称（用于重新下载判断）
  const activeQuantName = hasActiveFile ? (downloadedFiles.find(f => f.is_active)?.matched_preset ?? null) : null;
  // 文件不完整时，是否正在对该激活版本执行重新下载操作（进行中 / 暂停 / 失败）
  const isRedownloadingActive = !model.active_file_ok &&
    activeQuantName !== null &&
    model.downloading_quantization === activeQuantName;

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

  // 默认版本下载失败（必须是默认量化版本）
  const isDefaultDownloadFailed = downloadStatus === 'failed' &&
                                  model.downloading_quantization === model.selected_quantization;

  // 判断是否可以启动：
  // 场景1：有active文件且完整（已下载的默认版本）且不在下载默认版本
  // 场景2：选中了未下载版本且该版本已下载完成
  const canStart = (activeFileOk && !isDownloadingDefault) || (hasUndownloadedSelection && isDefaultDownloadCompleted) || model.source === 'cloudapi';

  // 判断是否应该显示下载按钮：
  // 1. 选中了未下载版本 且 不在下载中/已完成状态
  // 2. 或者完全没有文件也没有选中版本（从服务器同步的新卡片）
  // 3. 或者有active文件但文件不完整（需要重新下载）
  const shouldDownload = model.source !== 'custom' && model.source !== 'cloudapi' &&
      (hasUndownloadedSelection || (!hasActiveFile && !model.selected_quantization) || (hasActiveFile && !model.active_file_ok)) &&
      !isDefaultDownloadCompleted &&
      !isDownloadingDefault &&
      !isDefaultDownloadFailed &&
      !isRedownloadingActive;
  
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
        {editingName ? (
          <Input
            size="small"
            value={nameValue}
            autoFocus
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleSaveName}
            onPressEnter={handleSaveName}
            onKeyDown={e => { if (e.key === 'Escape') { setNameValue(model.name); setEditingName(false); } }}
            style={{ flex: 1, marginRight: 8, fontWeight: 600, fontSize: 14 }}
          />
        ) : (
          <h3
            title={`${model.name}（点击重命名）`}
            onClick={() => { setNameValue(model.name); setEditingName(true); }}
            style={{ cursor: 'text' }}
          >
            {model.name}
          </h3>
        )}
        <Space size={4}>
          {model.type === 'llm' && (
            <Button
              size="small"
              icon={isFavorited
                ? <StarFilled />
                : <StarOutlined />}
              onClick={() => onToggleFavorite?.(model.id)}
              title={isFavorited ? '取消收藏' : '收藏'}
            />
          )}
          {model.source === 'remote' && (
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={handleRestoreDefaults}
              title="恢复默认"
            />
          )}
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={handleSettings}
            title="配置参数"
          />
        </Space>
      </div>
      <div className="model-meta">
        {model.source === 'custom' ? (
          <span className="model-source">custom</span>
        ) : model.source === 'cloudapi' ? (
          <span className="model-source">{model.cloud_platform || '云API'}</span>
        ) : model.modelscope_id ? (
          <span className="model-source" title={model.modelscope_id}>
            {model.modelscope_id.split('/')[0]}
          </span>
        ) : <span />}
      </div>
      <p className="model-description">{model.description || '暂无描述'}</p>

      <div className="model-card-footer">
      {/* 显示量化版本信息和模型大小 */}
      {(currentQuant || modelSize > 0 || model.source === 'cloudapi') && (
        <div className="model-quantization">
          {modelSize > 0 && (
            <span className="model-size-badge">{parseFloat((modelSize / (1024 ** 3)).toFixed(2))}GB</span>
          )}
          {(currentQuant || model.source === 'custom' || model.source === 'cloudapi') && (
            model.source === 'custom' ? (
              <Tag color="orange">自定义 <HddOutlined /></Tag>
              // <Tag style={{ background: '#fff7e6', borderColor: '#ffd591', color: '#ff9800' }}>自定义 </Tag> //<HddOutlined />
            ) : model.source === 'cloudapi' ? (
              <Tag color="geekblue">云API <CloudOutlined /></Tag>
              // <Tag style={{ background: '#e6f7ff', borderColor: '#91d5ff', color: '#1890ff' }}>云API </Tag> //<CloudOutlined />
            ) : model.quantizations && model.quantizations.length > 1 ? (
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
            )
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

      {/* 下载中状态 - 只有当下载的是选中的默认版本或重新下载不完整激活文件时才显示 */}
      {downloadStatus === 'downloading' && model.type === 'llm' &&
       ((hasUndownloadedSelection && model.downloading_quantization === model.selected_quantization) || isRedownloadingActive) && (
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

      {/* 下载暂停状态 - 只有当下载的是选中的默认版本或重新下载不完整激活文件时才显示 */}
      {downloadStatus === 'paused' && model.type === 'llm' &&
       ((hasUndownloadedSelection && model.downloading_quantization === model.selected_quantization) || isRedownloadingActive) && (
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

      {/* 下载失败状态 - 只有当下载的是选中的默认版本或重新下载不完整激活文件时才显示 */}
      {downloadStatus === 'failed' && model.type === 'llm' &&
       ((hasUndownloadedSelection && model.downloading_quantization === model.selected_quantization) || isRedownloadingActive) && (
        <div className="download-progress" style={{ marginTop: 16 }}>
          <Progress
            percent={Math.floor(downloadProgress)}
            status="exception"
            format={() => (
              <CloseCircleOutlined
                style={{ color: '#ff4d4f', cursor: 'pointer' }}
                onClick={() => handleCancelDownload(model.downloading_quantization)}
              />
            )}
          />
          <div style={{ marginTop: 8, color: '#ff4d4f', fontSize: '12px' }}>
            下载失败：{summarizeDownloadError(model.download_error)}
          </div>
          <Space style={{ width: '100%', marginTop: 8 }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => handleResumeDownload(model.downloading_quantization)}
              loading={loading}
              size="small"
            >
              重试
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

      {/* ComfyUI专属按钮 */}
      {model.type === 'comfyui' && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleComfyUIRun}
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
        </Space>
      )}

      {/* ComfyUI 启动确认 Modal */}
      <Modal
        title="启动 ComfyUI"
        open={comfyuiLaunchVisible}
        onCancel={comfyuiLaunching ? undefined : handleComfyUILaunchCancel}
        closable={!comfyuiLaunching}
        maskClosable={false}
        footer={
          comfyuiLaunching ? null : [
            <Button
              key="skip"
              onClick={() => { handleComfyUILaunchCancel(); navigate(`/comfyui/${model.id}`); }}
            >
              直接进入
            </Button>,
            <Button key="launch" type="primary" onClick={handleComfyUILaunch}>
              启动并进入
            </Button>
          ]
        }
      >
        {comfyuiLaunching ? (
          <Space direction="vertical" align="center" style={{ width: '100%', padding: '24px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#666' }}>{comfyuiLaunchStatus}</div>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>未检测到 ComfyUI 正在运行。</div>
            <div>点击<strong>启动并进入</strong>将自动启动默认实例，就绪后自动进入运行界面。</div>
            <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              如果你已在其他端口运行了 ComfyUI，可点击"直接进入"后在运行页面选择实例。
            </div>
          </Space>
        )}
      </Modal>

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


      {/* 启动按钮 - 当有active文件且不在下载默认版本时显示（非ComfyUI） */}
      {canStart && model.type !== 'comfyui' && (        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
          {isStarting ? (
            <Button
              danger
              icon={<LoadingOutlined />}
              onClick={handleStop}
              block
              color="red"
              variant="solid"
            >
              中断启动
            </Button>
          ) : !isRunning ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={loading}
              block
              color="green"
              variant="solid"
            >
              启动
            </Button>
          ) : model.source === 'cloudapi' ? (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
              loading={loading}
              block
              color="red"
              variant="solid"
            >
              停止
            </Button>
          ) : (
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                loading={loading}
                color="red"
                variant="solid"
                style={{ flex: 1 }}
              >
                停止
              </Button>
              <Button
                type="primary"
                icon={<MessageOutlined />}
                onClick={handleUse}
                color="green"
                variant="solid"
                style={{ flex: 1 }}
              >
                使用
              </Button>
            </div>
          )}
        </Space>
      )}

      {/* 自定义模型文件缺失提示 */}
      {model.source === 'custom' && !activeFileOk && model.type !== 'comfyui' && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
          <Button
            block
            disabled
            icon={<WarningOutlined />}
            color="red"
            variant="solid"
            style={{ cursor: 'not-allowed' }}
          >
            模型文件缺失
          </Button>
        </Space>
      )}
      </div>

      {/* ComfyUI 参数映射设置 */}
      <Drawer
        title="参数映射配置"
        placement="right"
        width={680}
        open={comfyuiSettingsVisible}
        onClose={() => setComfyuiSettingsVisible(false)}
        destroyOnClose
        extra={
          <Popconfirm
            title="删除卡片"
            description="删除此卡片配置及对应的工作流文件，已下载的模型文件不受影响。"
            onConfirm={async () => {
              try {
                await modelService.delete(model.id);
                message.success('卡片已删除');
                setComfyuiSettingsVisible(false);
                onUpdate();
              } catch (e) {
                message.error('删除失败');
              }
            }}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>删除卡片</Button>
          </Popconfirm>
        }
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
        model={model}
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
          activeFileOk={model.active_file_ok}
          onDownload={handleDownloadQuantization}
          onSwitch={handleSwitchQuantization}
          onSwitchFile={handleSwitchToFile}
          onPauseDownload={handlePauseDownload}
          onResumeDownload={handleResumeDownload}
          onCancelDownload={handleCancelDownload}
          onDeleteQuantization={handleDeleteQuantization}
          onStart={() => { setQuantizationSelectorVisible(false); handleStart(); }}
          onCancel={async () => {
            // 先刷新模型数据，等待完成
            await onUpdate();
            
            // 再关闭弹窗，确保UI使用最新数据
            setQuantizationSelectorVisible(false);
          }}
        />
      )}

      {/* 引擎下载 Modal（启动时引擎未安装） */}
      <EngineDownloadModal
        visible={showEngineModal}
        engineId={engineTarget}
        engineInfo={engineInfo}
        onComplete={() => {
          setShowEngineModal(false);
          if (engineTarget === 'llamacpp') {
            doStartModel();
          } else {
            // 引擎就绪后重新走完整流程（会继续检测模型是否下载全）
            handleComfyUILaunch();
          }
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </Card>
  );
}

export default ModelCard;
