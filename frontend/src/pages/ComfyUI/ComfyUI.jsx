import React, { useState, useEffect, useRef } from 'react';
import {
  Layout, Typography, Button, Space, Row, Col, Card, Form,
  Input, InputNumber, Upload, message, Spin, Progress, Empty,
  Tag, Tooltip, Select, Image, Alert, Collapse
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, EditOutlined,
  CheckOutlined, CloseOutlined, ReloadOutlined, UploadOutlined,
  PictureOutlined, DownOutlined, CloseCircleOutlined, PlusOutlined
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { modelService, comfyuiService } from '../../services/api';

// 从 workflow.original 推导真实默认参数（兼容新旧模型）
function deriveDefaults(model) {
  const mapping = model.parameter_mapping?.inputs || {};
  const workflow = model.workflow?.original || {};
  const result = {};
  for (const [key, def] of Object.entries(mapping)) {
    if (def.type === 'image') continue;
    // 优先用新格式存储的 default_value
    if (def.default_value !== undefined) {
      result[key] = def.default_value;
      continue;
    }
    // 旧模型：从 workflow 节点读实际值
    const node = workflow[def.node_id];
    if (node) {
      // PrimitiveStringMultiline 用 'value' 字段，其他用 field
      const val = node.inputs?.[def.field] ?? node.inputs?.['value'];
      if (val !== undefined && !Array.isArray(val)) {
        result[key] = key === 'seed' ? -1 : val;
      }
    }
    // seed 始终默认 -1
    if (key === 'seed') result[key] = -1;
  }
  return result;
}

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

// 常见尺寸预设
const SIZE_PRESETS = [
  { label: '512×512', value: '512x512' },
  { label: '768×512', value: '768x512' },
  { label: '512×768', value: '512x768' },
  { label: '1024×1024', value: '1024x1024' },
  { label: '1280×720', value: '1280x720' },
  { label: '720×1280', value: '720x1280' },
  { label: '1328×1328', value: '1328x1328' },
  { label: '1920×1080', value: '1920x1080' },
  { label: '自定义', value: 'custom' }
];

function ComfyUI() {
  const navigate = useNavigate();
  const { modelId } = useParams();
  const [form] = Form.useForm();

  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);

  // 连接状态
  const [connected, setConnected] = useState(null); // null=checking, true, false
  const [editingAddress, setEditingAddress] = useState(false);
  const [editHost, setEditHost] = useState('');
  const [editPort, setEditPort] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  // 参数值
  const [params, setParams] = useState({});
  const [imageFiles, setImageFiles] = useState({}); // { paramKey: File }
  const [imagePreviews, setImagePreviews] = useState({}); // { paramKey: dataURL }
  const [batchFileList, setBatchFileList] = useState([]);

  // 尺寸选择
  const [sizePreset, setSizePreset] = useState('1024x1024');
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);

  // 生成状态
  const [generating, setGenerating] = useState(false);
  const [promptId, setPromptId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState('');
  const [results, setResults] = useState([]);
  const [generateError, setGenerateError] = useState(null);

  const pollIntervalRef = useRef(null);

  // 加载模型
  useEffect(() => {
    loadModel();
  }, [modelId]);

  // 检查连接（模型加载后）
  useEffect(() => {
    if (model) {
      checkConnection();
    }
  }, [model]);

  // 轮询生成进度
  useEffect(() => {
    if (promptId && generating) {
      pollIntervalRef.current = setInterval(() => {
        pollProgress();
      }, 2000);
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [promptId, generating]);

  const loadModel = async () => {
    try {
      setLoading(true);
      const data = await modelService.getById(modelId);
      setModel(data);

      // 从 workflow 推导真实默认参数（覆盖旧的硬编码值）
      const defaults = deriveDefaults(data);
      setParams(defaults);
      form.setFieldsValue(defaults);

      // 初始化尺寸
      if (defaults.width && defaults.height) {
        const preset = `${defaults.width}x${defaults.height}`;
        const found = SIZE_PRESETS.find(p => p.value === preset);
        setSizePreset(found ? preset : 'custom');
        setCustomWidth(defaults.width);
        setCustomHeight(defaults.height);
      }
    } catch (error) {
      message.error('加载模型失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async () => {
    setConnected(null);
    try {
      const result = await comfyuiService.checkConnection(modelId);
      setConnected(result.connected);
    } catch {
      setConnected(false);
    }
  };

  const handleSaveAddress = async () => {
    const port = parseInt(editPort, 10);
    if (!editHost.trim() || !port || port < 1 || port > 65535) {
      message.error('请输入有效的地址和端口');
      return;
    }

    setSavingConfig(true);
    try {
      await comfyuiService.updateConfig(modelId, { host: editHost.trim(), port });
      // Update local model state
      setModel(prev => ({
        ...prev,
        comfyui_config: { host: editHost.trim(), port }
      }));
      setEditingAddress(false);
      message.success('地址已保存');
      // Re-check connection with new config
      setTimeout(checkConnection, 200);
    } catch (error) {
      message.error('保存失败: ' + error.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const startEditAddress = () => {
    const cfg = model?.comfyui_config || { host: '127.0.0.1', port: 8188 };
    setEditHost(cfg.host);
    setEditPort(String(cfg.port));
    setEditingAddress(true);
  };

  const pollProgress = async () => {
    if (!promptId) return;
    try {
      const result = await comfyuiService.getProgress(modelId, promptId);
      if (result.status === 'completed') {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setProgress(100);
        setProgressStatus('completed');
        fetchResult();
      } else if (result.status === 'running') {
        setProgress(result.progress || 50);
        setProgressStatus('running');
      } else if (result.status === 'pending') {
        setProgress(0);
        setProgressStatus('pending');
      }
    } catch (error) {
      console.error('Poll progress error:', error);
    }
  };

  const fetchResult = async () => {
    try {
      const result = await comfyuiService.getResult(modelId, promptId);
      if (result.data && result.data.length > 0) {
        setResults(result.data.map(item => item.url));
      }
    } catch (error) {
      setGenerateError('获取结果失败: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!connected) {
      message.error('ComfyUI 未连接，请检查地址配置');
      return;
    }

    setGenerating(true);
    setGenerateError(null);
    setResults([]);
    setProgress(0);
    setProgressStatus('pending');

    try {
      const formValues = form.getFieldsValue();
      const runParams = { ...formValues };

      // 处理尺寸参数
      if (model?.parameter_mapping?.inputs?.width || model?.parameter_mapping?.inputs?.height) {
        if (sizePreset !== 'custom') {
          const [w, h] = sizePreset.split('x').map(Number);
          runParams.width = w;
          runParams.height = h;
        } else {
          runParams.width = customWidth;
          runParams.height = customHeight;
        }
      }

      // 处理 seed
      if (runParams.seed === undefined || runParams.seed === null || runParams.seed === '') {
        runParams.seed = -1;
      }

      // 处理所有图片上传（支持多图）
      for (const [key, file] of Object.entries(imageFiles)) {
        if (file) {
          const fd = new FormData();
          fd.append('image', file);
          const uploadResult = await comfyuiService.uploadImage(modelId, fd);
          runParams[key] = uploadResult.filename;
        }
      }

      const result = await comfyuiService.run(modelId, runParams);
      setPromptId(result.promptId);
    } catch (error) {
      setGenerating(false);
      setGenerateError(error.response?.data?.error || error.message || '生成失败');
    }
  };

  const handleImageChange = (key, info) => {
    if (info.fileList.length === 0) {
      setImageFiles(prev => { const n = { ...prev }; delete n[key]; return n; });
      setImagePreviews(prev => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    const file = info.fileList[info.fileList.length - 1].originFileObj;
    setImageFiles(prev => ({ ...prev, [key]: file }));
    const reader = new FileReader();
    reader.onload = e => setImagePreviews(prev => ({ ...prev, [key]: e.target.result }));
    reader.readAsDataURL(file);
  };

  const removeImage = (key) => {
    setImageFiles(prev => { const n = { ...prev }; delete n[key]; return n; });
    setImagePreviews(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleBatchImageChange = ({ fileList }) => {
    const newFiles = fileList.filter(f => f.originFileObj);
    newFiles.slice(0, imageKeys.length).forEach((fileItem, index) => {
      const key = imageKeys[index];
      const file = fileItem.originFileObj;
      setImageFiles(prev => ({ ...prev, [key]: file }));
      const reader = new FileReader();
      reader.onload = e => setImagePreviews(prev => ({ ...prev, [key]: e.target.result }));
      reader.readAsDataURL(file);
    });
    setBatchFileList([]);
  };

  const handleFileInput = (key, file) => {
    if (!file) return;
    setImageFiles(prev => ({ ...prev, [key]: file }));
    const reader = new FileReader();
    reader.onload = e => setImagePreviews(prev => ({ ...prev, [key]: e.target.result }));
    reader.readAsDataURL(file);
  };

  const renderImageGrid = () => {
    const cols = imageKeys.length >= 5 ? 3 : 2;
    const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
    return (
      <Form.Item key="image-grid" label="输入图像">
        <Upload
          beforeUpload={() => false}
          onChange={handleBatchImageChange}
          accept="image/*"
          multiple
          showUploadList={false}
          fileList={batchFileList}
        >
          <Button icon={<UploadOutlined />} size="small" style={{ marginBottom: 10 }}>
            批量选择（最多 {imageKeys.length} 张）
          </Button>
        </Upload>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
          {imageKeys.map((key, index) => {
            const paramDef = inputs[key];
            const label = paramDef.description || '输入图像';
            const preview = imagePreviews[key];
            const number = circledNumbers[index] || `${index + 1}`;
            return (
              <div key={key}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {number} {label}
                </div>
                {preview ? (
                  <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
                    {/* 正方形图片容器：padding-bottom撑开高度 */}
                    <div style={{ width: '100%', paddingBottom: '100%', position: 'relative' }}>
                      <img
                        src={preview}
                        alt={`preview-${key}`}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </div>
                    <CloseCircleOutlined
                      onClick={() => removeImage(key)}
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        color: '#fff', fontSize: 18, cursor: 'pointer',
                        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))'
                      }}
                    />
                    <label
                      htmlFor={`refile-${key}`}
                      style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'rgba(0,0,0,0.55)', color: '#fff',
                        fontSize: 11, textAlign: 'center', padding: '4px 0',
                        cursor: 'pointer', display: 'block'
                      }}
                    >
                      重新选择
                      <input id={`refile-${key}`} type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={e => { handleFileInput(key, e.target.files[0]); e.target.value = ''; }} />
                    </label>
                  </div>
                ) : (
                  /* label 是 block 元素，width:100% 正确填满网格列 */
                  <label htmlFor={`file-${key}`} style={{ display: 'block', cursor: 'pointer' }}>
                    <div
                      style={{
                        width: '100%', aspectRatio: '1',
                        border: '1.5px dashed #3a3a3a', borderRadius: 6,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        color: '#555', gap: 8,
                        transition: 'border-color 0.2s, color 0.2s',
                        background: 'rgba(255,255,255,0.02)'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#1677ff'; e.currentTarget.style.color = '#1677ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#555'; }}
                    >
                      <PlusOutlined style={{ fontSize: 26 }} />
                      <span style={{ fontSize: 12 }}>上传</span>
                    </div>
                    <input id={`file-${key}`} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { handleFileInput(key, e.target.files[0]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </Form.Item>
    );
  };

  const renderImageField = (key, paramDef) => (
    <Form.Item key={key} label={paramDef.description || '输入图像'}>
      <Upload
        beforeUpload={() => false}
        onChange={info => handleImageChange(key, info)}
        accept="image/*"
        maxCount={1}
        showUploadList={false}
      >
        <Button icon={<UploadOutlined />}>{imagePreviews[key] ? '重新选择' : '选择图片'}</Button>
      </Upload>
      {imagePreviews[key] && (
        <img src={imagePreviews[key]} alt="preview"
          style={{ marginTop: 8, maxWidth: '100%', maxHeight: 160, borderRadius: 4, display: 'block' }} />
      )}
    </Form.Item>
  );

  const renderSizeField = () => (
    <Form.Item key="size" label="尺寸">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select value={sizePreset} onChange={setSizePreset}
          options={SIZE_PRESETS.map(p => ({ label: p.label, value: p.value }))} />
        {sizePreset === 'custom' && (
          <Space>
            <InputNumber min={64} max={4096} step={64} value={customWidth}
              onChange={v => setCustomWidth(v)} addonBefore="宽" />
            <InputNumber min={64} max={4096} step={64} value={customHeight}
              onChange={v => setCustomHeight(v)} addonBefore="高" />
          </Space>
        )}
      </Space>
    </Form.Item>
  );

  const renderField = (key, paramDef) => {
    const { type, description, field } = paramDef;
    if (type === 'image') return renderImageField(key, paramDef);
    if (key === 'height') return null;
    if (key === 'width') return renderSizeField();
    if (key === 'seed') return (
      <Form.Item key={key} label="Seed" name={key}>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item name={key} noStyle>
            <InputNumber style={{ flex: 1 }} min={-1} placeholder="-1 为随机" />
          </Form.Item>
          <Button onClick={() => form.setFieldValue('seed', -1)}>随机</Button>
        </Space.Compact>
      </Form.Item>
    );
    if (key === 'prompt' || key === 'negative_prompt' || field === 'text') return (
      <Form.Item key={key} label={description || key} name={key}>
        <TextArea rows={key === 'prompt' ? 4 : 2}
          placeholder={key === 'negative_prompt' ? '负面提示词（可选）' : '请输入提示词'} />
      </Form.Item>
    );
    if (type === 'number') return (
      <Form.Item key={key} label={description || key} name={key}>
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
    );
    return (
      <Form.Item key={key} label={description || key} name={key}>
        <Input />
      </Form.Item>
    );
  };

  // 主要参数（表面展示）
  const PRIMARY_KEYS = ['prompt', 'negative_prompt', 'width', 'steps'];
  const isPrimary = key => PRIMARY_KEYS.includes(key) || inputs[key]?.type === 'image';
  const isAdvanced = key => !isPrimary(key) && key !== 'height';

  if (loading) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </Content>
      </Layout>
    );
  }

  if (!model) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ padding: 24 }}>
          <Empty description="模型不存在" />
          <Button onClick={() => navigate('/?tab=comfyui')} style={{ marginTop: 16 }}>返回首页</Button>
        </Content>
      </Layout>
    );
  }

  const cfg = model.comfyui_config || { host: '127.0.0.1', port: 8188 };
  // 合并自动映射 + 用户自定义映射（用户定义优先，使表单字段同步更新）
  const inputs = {
    ...(model.parameter_mapping?.inputs || {}),
    ...(model.user_parameter_mapping || {})
  };
  const workflowType = model.workflow?.type || 'text2img';
  const workflowTypeLabels = {
    text2img: '文生图', img2img: '图生图',
    text2video: '文生视频', img2video: '图生视频'
  };

  // 参数渲染顺序：动态收集所有 image 参数，统一排在 prompt 后
  const imageKeys = Object.keys(inputs)
    .filter(k => inputs[k].type === 'image')
    .sort((a, b) => {
      // image < image_2 < image_3 ... < image_mask
      if (a === 'image') return -1;
      if (b === 'image') return 1;
      if (a === 'image_mask') return 1;
      if (b === 'image_mask') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  const paramOrder = [
    'prompt', 'negative_prompt',
    ...imageKeys,
    'width', 'height', 'steps', 'cfg_scale', 'seed', 'sampler', 'scheduler', 'batch_size', 'length'
  ];
  const allKeys = [
    ...paramOrder.filter(k => inputs[k]),
    ...Object.keys(inputs).filter(k => !paramOrder.includes(k))
  ];
  const primaryKeys = allKeys.filter(k => isPrimary(k));
  const advancedKeys = allKeys.filter(k => isAdvanced(k));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        background: 'inherit',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px'
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/?tab=comfyui')}
        />
        <Title level={4} style={{ display: 'inline', marginLeft: 16, marginBottom: 0 }}>
          ComfyUI — {model.name}
        </Title>
        <Tag color="blue" style={{ marginLeft: 12 }}>{workflowTypeLabels[workflowType] || workflowType}</Tag>
      </Header>

      <Content style={{ padding: 16 }}>
        <Row gutter={16} style={{ height: '100%' }}>
          {/* 左侧：参数面板 */}
          <Col xs={24} md={8} lg={7}>
            <Card size="small" style={{ marginBottom: 12 }}>
              {/* 连接状态 */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <Space>
                  <span
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      display: 'inline-block',
                      background: connected === null ? '#faad14' : connected ? '#52c41a' : '#ff4d4f'
                    }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {connected === null ? '检查中...' : connected ? '已连接' : '未连接'}
                  </Text>
                </Space>
                <Tooltip title="重新检查连接">
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={checkConnection}
                    type="text"
                  />
                </Tooltip>
              </div>

              {/* 地址显示/编辑 */}
              {editingAddress ? (
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={editHost}
                    onChange={e => setEditHost(e.target.value)}
                    placeholder="127.0.0.1"
                    style={{ flex: 2 }}
                  />
                  <Input
                    value={editPort}
                    onChange={e => setEditPort(e.target.value)}
                    placeholder="8188"
                    style={{ flex: 1 }}
                    type="number"
                  />
                  <Button
                    icon={<CheckOutlined />}
                    type="primary"
                    loading={savingConfig}
                    onClick={handleSaveAddress}
                  />
                  <Button
                    icon={<CloseOutlined />}
                    onClick={() => setEditingAddress(false)}
                  />
                </Space.Compact>
              ) : (
                <Space>
                  <Text code style={{ fontSize: 12 }}>{cfg.host}:{cfg.port}</Text>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    type="text"
                    onClick={startEditAddress}
                  />
                </Space>
              )}
            </Card>

            {/* 参数表单 */}
            <Card size="small" title="参数设置">
              <Form form={form} layout="vertical" size="small" initialValues={deriveDefaults(model)}>
                {/* 主要参数 */}
                {primaryKeys.map(key => {
                  if (inputs[key]?.type === 'image' && imageKeys.length >= 2) {
                    if (key === imageKeys[0]) return renderImageGrid();
                    return null;
                  }
                  return renderField(key, inputs[key]);
                })}

                {/* 高级参数折叠 */}
                {advancedKeys.length > 0 && (
                  <Collapse ghost size="small" style={{ marginTop: 4 }} items={[{
                    key: 'adv',
                    label: <span style={{ fontSize: 12, color: '#888' }}>高级参数</span>,
                    children: advancedKeys.map(key => renderField(key, inputs[key]))
                  }]} />
                )}
              </Form>

              <Button type="primary" icon={<PlayCircleOutlined />} block size="middle"
                loading={generating} onClick={handleGenerate} style={{ marginTop: 8 }}>
                {generating ? '生成中...' : '生成'}
              </Button>
            </Card>
          </Col>

          {/* 右侧：结果展示 */}
          <Col xs={24} md={16} lg={17}>
            <Card
              size="small"
              title="生成结果"
              style={{ minHeight: 400 }}
            >
              {generateError && (
                <Alert
                  type="error"
                  message={generateError}
                  closable
                  onClose={() => setGenerateError(null)}
                  style={{ marginBottom: 12 }}
                />
              )}

              {!connected && !generating && results.length === 0 && (
                <Alert
                  type="warning"
                  message="ComfyUI 未连接"
                  description={`请确保 ComfyUI 正在运行，地址为 ${cfg.host}:${cfg.port}`}
                  style={{ marginBottom: 12 }}
                />
              )}

              {generating && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <Progress
                    type="circle"
                    percent={progress}
                    status={progressStatus === 'completed' ? 'success' : 'active'}
                  />
                  <div style={{ marginTop: 16 }}>
                    <Text type="secondary">
                      {progressStatus === 'pending' && '等待队列中...'}
                      {progressStatus === 'running' && '正在生成...'}
                      {progressStatus === 'completed' && '生成完成，加载结果...'}
                    </Text>
                  </div>
                </div>
              )}

              {!generating && results.length === 0 && !generateError && (
                <Empty
                  image={<PictureOutlined style={{ fontSize: 48, color: '#ccc' }} />}
                  description="点击「生成」按钮开始创作"
                  style={{ padding: '60px 0' }}
                />
              )}

              {results.length > 0 && (
                <div>
                  <Row gutter={[8, 8]}>
                    {results.map((url, idx) => (
                      <Col key={idx} xs={24} sm={12} md={8} lg={8}>
                        {workflowType.includes('video') ? (
                          <video
                            src={url}
                            controls
                            style={{ width: '100%', borderRadius: 4 }}
                          />
                        ) : (
                          <Image
                            src={url}
                            alt={`result-${idx}`}
                            style={{ width: '100%', borderRadius: 4 }}
                          />
                        )}
                      </Col>
                    ))}
                  </Row>
                  <Button
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      setResults([]);
                      setProgress(0);
                      setProgressStatus('');
                      setPromptId(null);
                    }}
                  >
                    清除结果
                  </Button>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}

export default ComfyUI;
