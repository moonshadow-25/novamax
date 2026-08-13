import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  Form,
  InputNumber,
  Button,
  Space,
  Divider,
  Input,
  Popconfirm,
  Tag,
  Alert,
  Collapse,
  Row,
  Col,
  Tooltip,
  Modal,
  Select,
  Switch,
  message
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  QuestionCircleOutlined,
  FolderOpenOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { engineService, modelService, backendService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import './ParametersDrawer.css';

const { Panel } = Collapse;
const { Option } = Select;

function ParametersDrawer({ visible, modelId, model, onClose }) {
  const { t } = useTranslation('home');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [parameters, setParameters] = useState(null);
  const [metadata, setMetadata] = useState({});
  const [customParams, setCustomParams] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  // 引擎版本相关
  const [engineVersions, setEngineVersions] = useState([]);
  const [selectedEngineVersion, setSelectedEngineVersion] = useState(null);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);

  // 自动启动 & 多机互联
  const [autoStart, setAutoStart] = useState(false);
  const [multiHost, setMultiHost] = useState(false);
  const [reasoningOn, setReasoningOn] = useState(false);

  const isCloudApi = model?.source === 'cloudapi';

  // RPC 多机互联（主机端）
  const showRpcSettings = model?.type === 'llm' && !isCloudApi;
  const [rpcEnable, setRpcEnable] = useState(false);
  const [rpcDevices, setRpcDevices] = useState([]); // string[]
  const [newRpcDevice, setNewRpcDevice] = useState('');

  useEffect(() => {
    if (visible && modelId) {
      loadData();
      loadEngineVersions();
      setAutoStart(!!model?.auto_start);
      setMultiHost(!!model?.multi_host);
    }
  }, [visible, modelId]);

  const handleAutoStartChange = async (checked) => {
    try {
      await modelService.update(modelId, { auto_start: checked });
      setAutoStart(checked);
      const modelName = model?.name || modelId;
      // message.success(checked ? `已为「${modelName}」开启自动启动` : `已为「${modelName}」关闭自动启动`);
    } catch (e) {
      const data = e.response?.data;
      if (e.response?.status === 409 && data?.error) {
        Modal.error({
          title: t('settingsDrawer.operationFailed'),
          content: data.error,
          okText: t('settingsDrawer.confirm')
        });
      } else {
        message.error(t('settingsDrawer.setFailed'));
      }
    }
  };

  const handleMultiHostChange = async (checked) => {
    try {
      await modelService.update(modelId, { multi_host: checked });
      setMultiHost(checked);
    } catch (e) {
      message.error(t('settingsDrawer.setFailed'));
    }
  };

  const handleReasoningChange = async (checked) => {
    setReasoningOn(checked);

    if (isCloudApi) return;
    if (!parameters) {
      message.error(t('settingsDrawer.parametersNotLoaded'));
      return;
    }

    try {
      const newParams = {
        ...parameters,
        reasoning: checked ? 'on' : 'off'
      };
      await axios.put(`/api/parameters/${modelId}`, {
        parameters: newParams
      });
      setParameters(prev => prev ? { ...prev, reasoning: checked ? 'on' : 'off' } : prev);
      message.success(checked ? t('settingsDrawer.reasoningEnabled') : t('settingsDrawer.reasoningDisabled'));
    } catch (error) {
      setReasoningOn(!checked);
      message.error(t('settingsDrawer.setFailed'));
    }
  };

  const loadEngineVersions = async () => {
    // 只有本地 LLM 类型才需要引擎版本选择，云 API 模型不需要
    if (model?.type !== 'llm' || isCloudApi) return;
    try {
      const engineData = await engineService.getById('llamacpp');
      const installedVersions = engineData.installed_versions || [];
      const availableVersions = Array.isArray(engineData.versions) && engineData.versions.length > 0
        ? engineData.versions
        : (engineData.variants || []).flatMap(variant =>
            (variant.versions || []).map(version => ({
              ...version,
              variant_id: variant.id,
              variant_name: variant.name
            }))
          );
      const { orderedInstalledVersions, latestInstalledVersion } = resolveVersionOrder(
        availableVersions,
        installedVersions
      );
      setEngineVersions(orderedInstalledVersions);
      setLatestEngineVersion(latestInstalledVersion);
      setSelectedEngineVersion(model?.engine_version || null);
    } catch (e) {
      console.error('加载引擎版本失败:', e);
    }
  };

  const handleEngineVersionChange = async (version) => {
    try {
      // null 表示使用默认（最新）版本
      await modelService.update(modelId, { engine_version: version || null });
      setSelectedEngineVersion(version);
      message.success(version ? t('settingsDrawer.switchedEngineVersion', { version }) : t('settingsDrawer.switchedDefaultLatestVersion'));
    } catch (e) {
      message.error(t('settingsDrawer.switchEngineVersionFailed'));
    }
  };

  const loadData = async () => {
    // 先加载元数据，再加载参数
    await loadMetadata();
    await loadParameters();
  };

  const loadParameters = async () => {
    try {
      const response = await axios.get(`/api/parameters/${modelId}`);
      const params = response.data.parameters;
      setParameters(params);

      // 标准参数键（与后端 parameterService 保持一致）
      const standardKeys = isCloudApi
        ? ['port']
        : ['context_length', 'port', 'parallel', 'load-mode', 'n-gpu-layers',
           'flash-attn', 'jinja',
           'temperature', 'top_p', 'top_k',
           'repeat_penalty', 'version', 'reasoning', 'rpc_enable', 'rpc_devices'];

      const custom = [];
      const formValues = {};

      Object.keys(params).forEach(key => {
        if (key.startsWith('_')) return; // 跳过元数据字段 (_source, _version, _note)

        if (standardKeys.includes(key)) {
          formValues[key] = params[key];
        } else {
          custom.push({ key, value: params[key] });
        }
      });

      // 如果 port 没有值，或模型类型与默认端口不匹配，填入正确默认值
      const EMBEDDING_PATTERN = /(?:embedding|embed|sentence[-_ ]?transformer|text2vec|semantic|vector|dpr|contriever|simcse|sbert)/i;
      const RERANKER_PATTERN = /(?:rerank|re-rank|cross[-_ ]?encoder|bge-?reranker|jina-?reranker|colbert)/i;
      const hasRerankerFlag = model?.reranker === true || model?.parameters?.reranker === true;
      const hasRerankerKeyword = RERANKER_PATTERN.test(model?.name || model?.id || '');
      const isReranker = hasRerankerFlag || hasRerankerKeyword;
      const hasEmbeddingFlag = model?.embedding === true || model?.parameters?.embedding === true;
      const hasEmbeddingKeyword = EMBEDDING_PATTERN.test(model?.name || model?.id || '');
      const isEmbedding = !isReranker && (hasEmbeddingFlag || hasEmbeddingKeyword);
      const DEFAULT_PORT = isReranker ? 1245 : isEmbedding ? 1278 : 1234;
      if (formValues.port === undefined || formValues.port === 1234) {
        if (isReranker || isEmbedding) formValues.port = DEFAULT_PORT;
      }

      setCustomParams(isCloudApi ? [] : custom);
      setReasoningOn(params.reasoning === 'on');
      setRpcEnable(params.rpc_enable === true);
      setRpcDevices(Array.isArray(params.rpc_devices) ? params.rpc_devices : []);
      form.setFieldsValue(formValues);
    } catch (error) {
      message.error(t('settingsDrawer.loadParametersFailed'));
    }
  };

  const loadMetadata = async () => {
    try {
      const response = await axios.get('/api/parameters/metadata/all');
      setMetadata(response.data.metadata);
    } catch (error) {
      console.error('加载元数据失败:', error);
    }
  };

  const handleSave = async (options = {}) => {
    const {
      rpcEnableOverride,
      rpcDevicesOverride,
      successText = t('settingsDrawer.parametersSaved'),
      silentSuccess = false
    } = options;

    try {
      setLoading(true);
      const values = await form.validateFields();

      // 标准参数键（确保所有标准参数都被保存）
      const standardKeys = isCloudApi
        ? ['port']
        : ['context_length', 'port', 'parallel', 'load-mode', 'n-gpu-layers',
           'flash-attn', 'jinja',
           'temperature', 'top_p', 'top_k',
           'repeat_penalty', 'reasoning'];
      // 合并标准参数（从 form 获取，如果没有则从当前 parameters 获取）
      const allParams = {};
      standardKeys.forEach(key => {
        if (values[key] !== undefined) {
          allParams[key] = values[key];
        } else if (parameters[key] !== undefined) {
          allParams[key] = parameters[key];
        }
      });

      // 云 API 模型不允许自定义参数
      if (!isCloudApi) {
        customParams.forEach(({ key, value }) => {
          allParams[key] = value;
        });
        // reasoning 开关始终保存为 on/off
        allParams.reasoning = reasoningOn ? 'on' : 'off';
        // RPC 多机互联
        allParams.rpc_enable = rpcEnableOverride ?? rpcEnable;
        allParams.rpc_devices = (rpcDevicesOverride ?? rpcDevices).filter(Boolean);
      }

      await axios.put(`/api/parameters/${modelId}`, {
        parameters: allParams
      });

      if (!silentSuccess) {
        message.success(successText);
      }
      await loadParameters();
    } catch (error) {
      message.error(t('settingsDrawer.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      setLoading(true);
      await axios.post(`/api/parameters/${modelId}/reset`);
      message.success(t('settingsDrawer.resetDefaultsSuccess'));
      // 同步重置引擎版本和自动启动状态
      setSelectedEngineVersion(null);
      setAutoStart(false);
      loadParameters();
    } catch (error) {
      message.error(t('settingsDrawer.resetFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustom = async () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) {
      message.error(t('settingsDrawer.inputParameterName'));
      return;
    }

    try {
      const trimmedValue = newValue.trim();
      // 尝试解析值为数字或布尔值
      let parsedValue = trimmedValue;
      if (trimmedValue === 'true') parsedValue = true;
      else if (trimmedValue === 'false') parsedValue = false;
      else if (!isNaN(trimmedValue) && trimmedValue !== '') {
        parsedValue = Number(trimmedValue);
      }

      await axios.post(`/api/parameters/${modelId}/custom`, {
        key: trimmedKey,
        value: parsedValue
      });

      message.success(t('settingsDrawer.customParameterAdded'));
      setNewKey('');
      setNewValue('');
      loadParameters();
    } catch (error) {
      message.error(t('settingsDrawer.addFailed'));
    }
  };

  const addRpcDevice = async () => {
    const candidate = newRpcDevice.trim();
    if (!candidate) return;

    const exists = rpcDevices.some(device => device.trim().toLowerCase() === candidate.toLowerCase());
    if (exists) {
      message.warning(t('settingsDrawer.rpcDeviceExists'));
      return;
    }

    const nextDevices = [...rpcDevices, candidate];
    setRpcDevices(nextDevices);
    setNewRpcDevice('');
    await handleSave({
      rpcEnableOverride: rpcEnable,
      rpcDevicesOverride: nextDevices,
      successText: t('settingsDrawer.rpcDeviceAdded')
    });
  };

  const removeRpcDevice = async (index) => {
    const nextDevices = rpcDevices.filter((_, i) => i !== index);
    setRpcDevices(nextDevices);
    await handleSave({
      rpcEnableOverride: rpcEnable,
      rpcDevicesOverride: nextDevices,
      successText: t('settingsDrawer.rpcDeviceRemoved')
    });
  };

  const handleDeleteCustom = async (key) => {
    try {
      await axios.delete(`/api/parameters/${modelId}/custom/${key}`);
      message.success(t('settingsDrawer.parameterDeleted'));
      loadParameters();
    } catch (error) {
      message.error(t('settingsDrawer.deleteFailed'));
    }
  };

  const handleDeleteModel = async () => {
    if (deleteInput !== 'delete') {
      message.error(t('settingsDrawer.inputDeleteConfirm'));
      return;
    }

    try {
      setLoading(true);
      await axios.delete(`/api/models/${modelId}`);
      message.success(t('settingsDrawer.modelDeleted'));
      setDeleteModalVisible(false);
      setDeleteInput('');
      onClose(); // 关闭抽屉
      window.location.reload(); // 刷新页面以更新模型列表
    } catch (error) {
      message.error(error.response?.data?.error || t('settingsDrawer.deleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  const runtimeKeys = isCloudApi
    ? ['port']
    : ['port', 'context_length', 'parallel', 'load-mode', 'n-gpu-layers', 'flash-attn', 'jinja'];

  const samplingKeys = isCloudApi
    ? []
    : ['temperature', 'top_p', 'top_k', 'repeat_penalty'];

  const renderFormItem = (key, meta) => {
    return (
      <Form.Item
        key={key}
        name={key}
        label={
          <Space>
            {meta.label}
            {meta.description && (
              <Tooltip title={meta.description}>
                <QuestionCircleOutlined style={{ color: '#999' }} />
              </Tooltip>
            )}
          </Space>
        }
      >
        {meta.options ? (
          <Select placeholder={t('settingsDrawer.defaultWithValue', { value: meta.default })}>
            {meta.options.map(opt => (
              <Select.Option key={opt} value={opt}>{opt}</Select.Option>
            ))}
          </Select>
        ) : meta.type === 'string' || meta.type === 'boolean' ? (
          <Input placeholder={t('settingsDrawer.defaultWithValue', { value: meta.default })} />
        ) : (
          <InputNumber
            style={{ width: '100%' }}
            min={meta.min}
            max={meta.max}
            step={meta.step || 1}
            placeholder={t('settingsDrawer.defaultWithValue', { value: meta.default })}
          />
        )}
      </Form.Item>
    );
  };

  return (
    <>
      <Drawer
        title={t('settingsDrawer.modelParametersTitle')}
        placement="right"
        width={500}
        open={visible}
        onClose={onClose}
        rootClassName="parameters-drawer"
        extra={
          <Space>
            <Popconfirm
              title={t('settingsDrawer.confirmResetDefaults')}
              onConfirm={handleReset}
              okText={t('settingsDrawer.confirm')}
              cancelText={t('settingsDrawer.cancel')}
            >
              <Button icon={<ReloadOutlined />}>{t('settingsDrawer.restoreDefaults')}</Button>
            </Popconfirm>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
            >
              {t('settingsDrawer.save')}
            </Button>
          </Space>
        }
      >
        {parameters && (
          <>
            {/* 删除模型按钮 - 放在最顶部 */}
            <Alert
              message={t('settingsDrawer.dangerOperation')}
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>{t('settingsDrawer.deleteModelPermanentDesc')}</div>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setDeleteModalVisible(true)}
                    block
                  >
                    {t('settingsDrawer.deleteModel')}
                  </Button>
                </Space>
              }
              type="error"
              style={{ marginBottom: 16 }}
            />

            {/* 版本信息（云 API 模型不显示参数来源/版本） */}
            {!isCloudApi && (
              <Alert
                message={
                  <Space>
                    <span>{t('settingsDrawer.parameterSource')}:</span>
                    <Tag color={parameters._source === 'user' ? 'blue' : 'default'}>
                      {parameters._source === 'user' ? t('settingsDrawer.userCustom') : t('settingsDrawer.defaultConfig')}
                    </Tag>
                    <span>{t('settingsDrawer.version')}: {parameters._version}</span>
                  </Space>
                }
                type={parameters._note ? 'warning' : 'info'}
                description={parameters._note}
                style={{ marginBottom: 16 }}
              />
            )}

          <Form
            form={form}
            layout="vertical"
          >
            {/* 引擎版本选择（仅本地 LLM） */}
            {model?.type === 'llm' && !isCloudApi && engineVersions.length > 0 && (
              <>
                <Form.Item
                  label={
                    <Space>
                      {t('settingsDrawer.engineVersion')}
                      <Tooltip title={t('settingsDrawer.llamacppEngineVersionHint')}>
                        <QuestionCircleOutlined style={{ color: '#999' }} />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Select
                    value={selectedEngineVersion}
                    onChange={handleEngineVersionChange}
                    style={{ width: '100%' }}
                    placeholder={t('settingsDrawer.defaultLatestVersion')}
                    allowClear
                  >
                    {engineVersions.map((v) => (
                      <Option key={v.version} value={v.version}>
                        {v.version}{v.version === latestEngineVersion ? ` ${t('settingsDrawer.latestTag')}` : ''}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
                <Divider />
              </>
            )}

            <Collapse defaultActiveKey={[]} ghost style={{ marginLeft: -16, marginBottom: 8 }}>
              {/* 运行时参数 */}
              <Panel header={t('settingsDrawer.runtimeParameters')} key="runtime">
                {runtimeKeys
                  .filter(key => metadata[key])
                  .map(key => renderFormItem(key, metadata[key]))}
              </Panel>

              {/* 采样参数 */}
              {samplingKeys.length > 0 && (
                <Panel header={t('settingsDrawer.samplingParameters')} key="sampling">
                  {samplingKeys
                    .filter(key => metadata[key])
                    .map(key => renderFormItem(key, metadata[key]))}
                </Panel>
              )}
            </Collapse>

            {/* 自动启动 & 多机互联（仅 LLM） */}
            {model?.type === 'llm' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <Space style={{ marginRight: 12 }}>
                    <span>{t('settingsDrawer.autoStart')}</span>
                    <Tooltip title={t('settingsDrawer.autoStartHint')}>
                      <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                    </Tooltip>
                  </Space>
                  <Switch
                    checked={autoStart}
                    onChange={handleAutoStartChange}
                    checkedChildren={t('settingsDrawer.switchOn')}
                    unCheckedChildren={t('settingsDrawer.switchOff')}
                  />
                </div>

                {!isCloudApi && (
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                  <Space style={{ marginRight: 12 }}>
                    <span>{t('settingsDrawer.reasoningSwitch')}</span>
                    <Tooltip title={t('settingsDrawer.reasoningHint')}>
                      <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                    </Tooltip>
                  </Space>
                  <Switch
                    checked={reasoningOn}
                    onChange={handleReasoningChange}
                    checkedChildren={t('settingsDrawer.switchOn')}
                    unCheckedChildren={t('settingsDrawer.switchOff')}
                  />
                </div>
                )}

                {/* <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
                  <Space style={{ marginRight: 12 }}>
                    <span>{t('settingsDrawer.multiConnect')}</span>
                    <Tooltip title={t('settingsDrawer.multiConnectComingSoonHint')}>
                      <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                    </Tooltip>
                  </Space>
                  <Switch
                    checked={multiHost}
                    onChange={handleMultiHostChange}
                    checkedChildren={t('settingsDrawer.switchOn')}
                    unCheckedChildren={t('settingsDrawer.switchOff')}
                    disabled
                  />
                </div> */}
                {/* <Divider style={{ margin: '4px 0 16px' }} /> */}

                {/* RPC 多机互联（主机端） */}
                {showRpcSettings && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <Space style={{ marginRight: 12 }}>
                      <span>{t('settingsDrawer.multiConnect')}</span>
                      <Tooltip title={t('settingsDrawer.rpcHint')}>
                        <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
                      </Tooltip>
                    </Space>
                    <Switch
                      checked={rpcEnable}
                      onChange={async (v) => {
                        setRpcEnable(v);
                        await handleSave({
                          rpcEnableOverride: v,
                          rpcDevicesOverride: rpcDevices,
                          successText: v ? t('settingsDrawer.rpcEnabled') : t('settingsDrawer.rpcDisabled')
                        });
                      }}
                      checkedChildren={t('settingsDrawer.switchOn')}
                      unCheckedChildren={t('settingsDrawer.switchOff')}
                    />
                  </div>

                  {rpcEnable && (
                    <div style={{ paddingLeft: 4 }}>
                      <div style={{ marginBottom: 6, color: '#999', fontSize: 12 }}>
                        {t('settingsDrawer.rpcDevicesHint')}
                      </div>
                      {rpcDevices.map((device, idx) => (
                        <Row key={idx} gutter={8} style={{ marginBottom: 6 }}>
                          <Col flex="auto">
                            <Input
                              value={device}
                              onChange={e => {
                                const next = [...rpcDevices];
                                next[idx] = e.target.value;
                                setRpcDevices(next);
                              }}
                              placeholder={t('settingsDrawer.rpcDeviceExample')}
                            />
                          </Col>
                          <Col>
                            <Button
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => removeRpcDevice(idx)}
                            />
                          </Col>
                        </Row>
                      ))}
                      <Row gutter={8}>
                        <Col flex="auto">
                          <Input
                            placeholder={t('settingsDrawer.addRpcDevice')}
                            value={newRpcDevice}
                            onChange={e => setNewRpcDevice(e.target.value)}
                            onPressEnter={addRpcDevice}
                          />
                        </Col>
                        <Col>
                          <Button
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={addRpcDevice}
                          />
                        </Col>
                      </Row>
                    </div>
                  )}
                </div>
                )}
              </>
            )}

            {!isCloudApi && (
              <>
                <Divider />

                {/* 自定义参数 */}
                <div style={{ marginBottom: 16 }}>
                  <h4>{t('settingsDrawer.customParameters')}</h4>
                  {customParams.map(({ key, value }) => (
                    <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                      <Col span={10}>
                        <Input value={key} disabled />
                      </Col>
                      <Col span={10}>
                        <Input value={String(value)} disabled />
                      </Col>
                      <Col span={4}>
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeleteCustom(key)}
                          block
                        />
                      </Col>
                    </Row>
                  ))}

                  <Row gutter={8} style={{ marginTop: 16 }}>
                    <Col span={10}>
                      <Input
                        placeholder={t('settingsDrawer.parameterName')}
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                      />
                    </Col>
                    <Col span={10}>
                      <Input
                        placeholder={t('settingsDrawer.value')}
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                      />
                    </Col>
                    <Col span={4}>
                      <Button
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={handleAddCustom}
                        block
                      />
                    </Col>
                  </Row>
                </div>

                <Divider />
              </>
            )}

            {/* 打开日志文件夹 */}
            <Divider />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={async () => {
                try {
                  await backendService.openLogsFolder();
                  message.success(t('settingsDrawer.logsFolderOpened'));
                } catch {
                  message.error(t('settingsDrawer.openFailed'));
                }
              }}
              block
            >
              {t('settingsDrawer.openLogsFolder')}
            </Button>
          </Form>
        </>
      )}
    </Drawer>

    {/* 删除确认对话框 */}
    <Modal
      title={t('settingsDrawer.confirmDeleteModel')}
      open={deleteModalVisible}
      onOk={handleDeleteModel}
      onCancel={() => {
        setDeleteModalVisible(false);
        setDeleteInput('');
      }}
      okText={t('settingsDrawer.delete')}
      cancelText={t('settingsDrawer.cancel')}
      okButtonProps={{ danger: true, loading }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message={t('settingsDrawer.warning')}
          description={t('settingsDrawer.deleteModelIrreversible')}
          type="error"
          showIcon
        />
        <div>{t('settingsDrawer.inputDeleteToConfirmPrefix')} <strong>delete</strong> {t('settingsDrawer.inputDeleteToConfirmSuffix')}</div>
        <Input
          placeholder={t('settingsDrawer.inputDelete')}
          value={deleteInput}
          onChange={(e) => setDeleteInput(e.target.value)}
          onPressEnter={handleDeleteModel}
        />
      </Space>
    </Modal>

  </>
  );
}

export default ParametersDrawer;
