import React, { useState, useEffect } from 'react';
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
  message
} from 'antd';
import {
  SaveOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  QuestionCircleOutlined,
  UndoOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { engineService, modelService } from '../../services/api';
import './ParametersDrawer.css';

const { Panel } = Collapse;
const { Option } = Select;

function ParametersDrawer({ visible, modelId, model, onClose }) {
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

  useEffect(() => {
    if (visible && modelId) {
      loadData();
      loadEngineVersions();
    }
  }, [visible, modelId]);

  const loadEngineVersions = async () => {
    // 只有 LLM 类型才需要引擎版本选择
    if (model?.type !== 'llm') return;
    try {
      const data = await engineService.getById('llamacpp');
      setEngineVersions(data.installed_versions || []);
      // 读取模型当前配置的版本，没有则显示"默认（最新）"
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
      message.success(version ? `已切换到引擎版本 ${version}` : '已切换到默认（最新）版本');
    } catch (e) {
      message.error('切换引擎版本失败');
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
      const standardKeys = [
        'context_length', 'gpu_layers', 'threads', 'parallel',
        'batch', 'ubatch', 'temperature', 'top_p', 'top_k',
        'repeat_penalty', 'version'
      ];

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

      setCustomParams(custom);
      form.setFieldsValue(formValues);
    } catch (error) {
      message.error('加载参数失败');
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

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      // 标准参数键（确保所有标准参数都被保存）
      const standardKeys = [
        'context_length', 'gpu_layers', 'threads', 'parallel',
        'batch', 'ubatch', 'temperature', 'top_p', 'top_k',
        'repeat_penalty'
      ];

      // 合并标准参数（从 form 获取，如果没有则从当前 parameters 获取）
      const allParams = {};
      standardKeys.forEach(key => {
        if (values[key] !== undefined) {
          allParams[key] = values[key];
        } else if (parameters[key] !== undefined) {
          allParams[key] = parameters[key];
        }
      });

      // 添加自定义参数
      customParams.forEach(({ key, value }) => {
        allParams[key] = value;
      });

      await axios.put(`/api/parameters/${modelId}`, {
        parameters: allParams
      });

      message.success('参数已保存');
      loadParameters();
    } catch (error) {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      setLoading(true);
      await axios.post(`/api/parameters/${modelId}/reset`);
      message.success('已重置为默认参数');
      loadParameters();
    } catch (error) {
      message.error('重置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustom = async () => {
    if (!newKey.trim()) {
      message.error('请输入参数名');
      return;
    }

    try {
      // 尝试解析值为数字或布尔值
      let parsedValue = newValue;
      if (newValue === 'true') parsedValue = true;
      else if (newValue === 'false') parsedValue = false;
      else if (!isNaN(newValue) && newValue.trim() !== '') {
        parsedValue = Number(newValue);
      }

      await axios.post(`/api/parameters/${modelId}/custom`, {
        key: newKey,
        value: parsedValue
      });

      message.success('自定义参数已添加');
      setNewKey('');
      setNewValue('');
      loadParameters();
    } catch (error) {
      message.error('添加失败');
    }
  };

  const handleDeleteCustom = async (key) => {
    try {
      await axios.delete(`/api/parameters/${modelId}/custom/${key}`);
      message.success('参数已删除');
      loadParameters();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleDeleteModel = async () => {
    if (deleteInput !== 'delete') {
      message.error('请输入 "delete" 确认删除');
      return;
    }

    try {
      setLoading(true);
      await axios.delete(`/api/models/${modelId}`);
      message.success('模型已删除');
      setDeleteModalVisible(false);
      setDeleteInput('');
      onClose(); // 关闭抽屉
      window.location.reload(); // 刷新页面以更新模型列表
    } catch (error) {
      message.error(error.response?.data?.error || '删除失败');
    } finally {
      setLoading(false);
    }
  };

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
        <InputNumber
          style={{ width: '100%' }}
          min={meta.min}
          max={meta.max}
          step={meta.step || 1}
          placeholder={`默认: ${meta.default}`}
        />
      </Form.Item>
    );
  };

  return (
    <>
      <Drawer
        title="模型参数配置"
        placement="right"
        width={500}
        open={visible}
        onClose={onClose}
        extra={
          <Space>
            {model?.source === 'remote' && (
              <Popconfirm
                title="恢复远程默认参数？"
                description="将重置量化选择（LLM）或参数映射（ComfyUI）为默认值"
                onConfirm={async () => {
                  try {
                    await modelService.restoreDefaults(modelId);
                    message.success('已恢复默认');
                  } catch (e) {
                    message.error('恢复失败');
                  }
                }}
                okText="确定"
                cancelText="取消"
              >
                <Button icon={<UndoOutlined />}>恢复默认</Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="确定重置为默认参数？"
              onConfirm={handleReset}
              okText="确定"
              cancelText="取消"
            >
              <Button icon={<ReloadOutlined />}>重置</Button>
            </Popconfirm>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
            >
              保存
            </Button>
          </Space>
        }
      >
        {parameters && (
          <>
            {/* 删除模型按钮 - 放在最顶部 */}
            <Alert
              message="危险操作"
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>删除此模型将永久删除配置和所有文件，此操作无法撤销。</div>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setDeleteModalVisible(true)}
                    block
                  >
                    删除模型
                  </Button>
                </Space>
              }
              type="error"
              style={{ marginBottom: 16 }}
            />

            {/* 版本信息 */}
            <Alert
              message={
                <Space>
                  <span>参数来源:</span>
                  <Tag color={parameters._source === 'user' ? 'blue' : 'default'}>
                    {parameters._source === 'user' ? '用户自定义' : '默认配置'}
                  </Tag>
                  <span>版本: {parameters._version}</span>
                </Space>
              }
              type={parameters._note ? 'warning' : 'info'}
              description={parameters._note}
              style={{ marginBottom: 16 }}
            />

          <Form
            form={form}
            layout="vertical"
          >
            {/* 引擎版本选择（仅 LLM） */}
            {model?.type === 'llm' && engineVersions.length > 0 && (
              <>
                <Form.Item
                  label={
                    <Space>
                      引擎版本
                      <Tooltip title="选择运行此模型使用的 llama.cpp 版本，默认使用最新安装的版本">
                        <QuestionCircleOutlined style={{ color: '#999' }} />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Select
                    value={selectedEngineVersion}
                    onChange={handleEngineVersionChange}
                    style={{ width: '100%' }}
                    placeholder="默认（最新版本）"
                    allowClear
                  >
                    {engineVersions.map((v, index) => (
                      <Option key={v.version} value={v.version}>
                        {v.version}{index === 0 ? '（最新）' : ''}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
                <Divider />
              </>
            )}

            <Collapse defaultActiveKey={[]} ghost>
              {/* 运行时参数 */}
              <Panel header="运行时参数" key="runtime">
                {['context_length', 'gpu_layers', 'threads', 'parallel', 'batch', 'ubatch']
                  .filter(key => metadata[key])
                  .map(key => renderFormItem(key, metadata[key]))}
              </Panel>

              {/* 采样参数 */}
              <Panel header="采样参数" key="sampling">
                {['temperature', 'top_p', 'top_k', 'repeat_penalty']
                  .filter(key => metadata[key])
                  .map(key => renderFormItem(key, metadata[key]))}
              </Panel>
            </Collapse>

            <Divider />

            {/* 自定义参数 */}
            <div style={{ marginBottom: 16 }}>
              <h4>自定义参数</h4>
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
                    placeholder="参数名"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                </Col>
                <Col span={10}>
                  <Input
                    placeholder="值"
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
          </Form>
        </>
      )}
    </Drawer>

    {/* 删除确认对话框 */}
    <Modal
      title="确认删除模型"
      open={deleteModalVisible}
      onOk={handleDeleteModel}
      onCancel={() => {
        setDeleteModalVisible(false);
        setDeleteInput('');
      }}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true, loading }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          message="警告"
          description="此操作将永久删除模型配置和所有下载的文件，无法恢复！"
          type="error"
          showIcon
        />
        <div>请输入 <strong>delete</strong> 确认删除：</div>
        <Input
          placeholder="输入 delete"
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
