import React, { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber,
  Space, Popconfirm, Tag, Typography, Collapse, Tooltip, message
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { comfyuiService } from '../../services/api';

const { Text } = Typography;

const TYPE_OPTIONS = [
  { label: '数字 (number)', value: 'number' },
  { label: '文本 (string)', value: 'string' },
];

function UserMappingPanel({ modelId, model, onMappingUpdate, embedded = false }) {
  const [nodes, setNodes] = useState([]);
  const [userMapping, setUserMapping] = useState(model?.user_parameter_mapping || {});
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => {
    comfyuiService.getWorkflowNodes(modelId)
      .then(res => setNodes(res.nodes || []))
      .catch(() => {});
  }, [modelId]);

  // 同步外部 model 变更（如重新加载）
  useEffect(() => {
    setUserMapping(model?.user_parameter_mapping || {});
  }, [model]);

  const autoMapping = model?.parameter_mapping?.inputs || {};

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const fieldOptions = selectedNode
    ? Object.entries(selectedNode.inputs || {}).map(([field, value]) => ({
        label: `${field}  =  ${Array.isArray(value) ? '[引用]' : JSON.stringify(value)}`,
        value: field
      }))
    : [];

  const nodeOptions = nodes.map(n => ({
    label: `${n.id} · ${n.class_type}${n.title ? ` · ${n.title}` : ''}`,
    value: n.id
  }));

  const openAdd = () => {
    setEditingKey(null);
    setSelectedNodeId(null);
    form.resetFields();
    form.setFieldValue('type', 'number');
    setModalOpen(true);
  };

  const openEdit = (key) => {
    const entry = userMapping[key];
    setEditingKey(key);
    setSelectedNodeId(entry.node_id);
    form.setFieldsValue({
      param_name: key,
      node_id: entry.node_id,
      field: entry.field,
      type: entry.type || 'number',
      description: entry.description,
      default_value: entry.default_value
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const { param_name, node_id, field, type, description, default_value } = values;
    const newMapping = {
      ...userMapping,
      [param_name]: {
        node_id,
        field,
        type: type || 'number',
        description: description || param_name,
        default_value
      }
    };
    setSaving(true);
    try {
      await comfyuiService.updateUserMapping(modelId, newMapping);
      setUserMapping(newMapping);
      setModalOpen(false);
      onMappingUpdate?.(newMapping);
      message.success('映射已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key) => {
    const newMapping = { ...userMapping };
    delete newMapping[key];
    try {
      await comfyuiService.updateUserMapping(modelId, newMapping);
      setUserMapping(newMapping);
      onMappingUpdate?.(newMapping);
      message.success('已删除');
    } catch {
      message.error('删除失败');
    }
  };

  // 构建统一表格数据：自动在前，手动在后
  const autoRows = Object.entries(autoMapping).map(([key, def]) => ({
    key, source: 'auto', ...def
  }));
  const userRows = Object.entries(userMapping).map(([key, def]) => ({
    key, source: 'user', ...def
  }));
  const allRows = [...autoRows, ...userRows];

  const columns = [
    {
      title: '参数名', dataIndex: 'key', key: 'key', width: 110,
      render: v => <Text code style={{ fontSize: 11 }}>{v}</Text>
    },
    {
      title: '节点 ID', dataIndex: 'node_id', key: 'node_id', width: 80,
      render: v => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>
    },
    {
      title: '字段', dataIndex: 'field', key: 'field', width: 80,
      render: v => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>
    },
    {
      title: '默认值', dataIndex: 'default_value', key: 'default_value', width: 100,
      ellipsis: true,
      render: v => {
        if (v === undefined || v === null) return <Text type="secondary">—</Text>;
        const str = String(v);
        const MAX = 40;
        if (str.length <= MAX) return str;
        return (
          <Tooltip title={str} overlayStyle={{ maxWidth: 400 }}>
            <span style={{ cursor: 'default' }}>{str.slice(0, MAX)}…</span>
          </Tooltip>
        );
      }
    },
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 55,
      render: v => v === 'auto'
        ? <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>自动</Tag>
        : <Tag color="green" style={{ fontSize: 10, padding: '0 4px' }}>手动</Tag>
    },
    {
      title: '', key: 'action', width: 60,
      render: (_, row) => row.source === 'user' ? (
        <Space size={0}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row.key)} />
          <Popconfirm
            title="确认删除此映射？"
            onConfirm={() => handleDelete(row.key)}
            okText="删除" cancelText="取消"
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null
    }
  ];

  const tableContent = (
    <>
      <Table
        dataSource={allRows}
        columns={columns}
        size="small"
        pagination={false}
        scroll={{ x: 460 }}
        style={{ fontSize: 12 }}
      />
      <Button
        size="small"
        icon={<PlusOutlined />}
        style={{ marginTop: 8 }}
        onClick={openAdd}
      >
        添加映射
      </Button>
    </>
  );

  return (
    <>
      {embedded ? tableContent : (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
          items={[{
            key: 'mapping',
            label: <span style={{ fontSize: 12, color: '#888' }}>参数映射配置</span>,
            children: tableContent
          }]}
        />
      )}

      <Modal
        title={editingKey ? `编辑映射：${editingKey}` : '添加参数映射'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={480}
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item
            name="param_name"
            label="参数名"
            rules={[{ required: true, message: '请输入参数名' }]}
            extra="运行时使用的参数键名，如 frame_count"
          >
            <Input placeholder="例: frame_count" disabled={!!editingKey} />
          </Form.Item>

          <Form.Item
            name="node_id"
            label="节点"
            rules={[{ required: true, message: '请选择节点' }]}
          >
            <Select
              options={nodeOptions}
              placeholder="选择节点"
              showSearch
              filterOption={(input, opt) =>
                opt.label.toLowerCase().includes(input.toLowerCase())
              }
              onChange={v => {
                setSelectedNodeId(v);
                form.setFieldValue('field', undefined);
              }}
            />
          </Form.Item>

          <Form.Item
            name="field"
            label="字段"
            rules={[{ required: true, message: '请选择字段' }]}
          >
            <Select
              options={fieldOptions}
              placeholder={selectedNodeId ? '选择字段' : '请先选择节点'}
              disabled={!selectedNodeId}
              showSearch
            />
          </Form.Item>

          <Form.Item name="type" label="类型">
            <Select options={TYPE_OPTIONS} />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input placeholder="例: 视频帧数" />
          </Form.Item>

          <Form.Item name="default_value" label="默认值">
            <InputNumber style={{ width: '100%' }} placeholder="留空则无默认值" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default UserMappingPanel;
