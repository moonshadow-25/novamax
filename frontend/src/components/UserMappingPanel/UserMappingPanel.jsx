import React, { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber,
  Space, Popconfirm, Tag, Typography, Collapse, Tooltip, message
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { comfyuiService } from '../../services/api';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const TYPE_OPTIONS = (t) => [
  { label: t('userMappingPanel.typeNumber'), value: 'number' },
  { label: t('userMappingPanel.typeString'), value: 'string' },
];

function UserMappingPanel({ modelId, model, onMappingUpdate, embedded = false }) {
  const { t } = useTranslation('home');
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
        label: `${field}  =  ${Array.isArray(value) ? `[${t('userMappingPanel.reference')}]` : JSON.stringify(value)}`,
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
      message.success(t('userMappingPanel.mappingSaved'));
    } catch {
      message.error(t('userMappingPanel.saveFailed'));
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
      message.success(t('userMappingPanel.deleted'));
    } catch {
      message.error(t('userMappingPanel.deleteFailed'));
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
      title: t('userMappingPanel.paramName'), dataIndex: 'key', key: 'key', width: 110,
      render: v => <Text code style={{ fontSize: 11 }}>{v}</Text>
    },
    {
      title: t('userMappingPanel.nodeId'), dataIndex: 'node_id', key: 'node_id', width: 80,
      render: v => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>
    },
    {
      title: t('userMappingPanel.field'), dataIndex: 'field', key: 'field', width: 80,
      render: v => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>
    },
    {
      title: t('userMappingPanel.defaultValue'), dataIndex: 'default_value', key: 'default_value', width: 100,
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
      title: t('userMappingPanel.source'), dataIndex: 'source', key: 'source', width: 55,
      render: v => v === 'auto'
        ? <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>{t('userMappingPanel.auto')}</Tag>
        : <Tag color="green" style={{ fontSize: 10, padding: '0 4px' }}>{t('userMappingPanel.manual')}</Tag>
    },
    {
      title: '', key: 'action', width: 60,
      render: (_, row) => row.source === 'user' ? (
        <Space size={0}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row.key)} />
          <Popconfirm
            title={t('userMappingPanel.confirmDeleteMapping')}
            onConfirm={() => handleDelete(row.key)}
            okText={t('settingsDrawer.delete')} cancelText={t('settingsDrawer.cancel')}
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
        {t('userMappingPanel.addMapping')}
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
            label: <span style={{ fontSize: 12, color: '#888' }}>{t('userMappingPanel.mappingConfig')}</span>,
            children: tableContent
          }]}
        />
      )}

      <Modal
        title={editingKey ? t('userMappingPanel.editMappingWithKey', { key: editingKey }) : t('userMappingPanel.addParamMapping')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText={t('settingsDrawer.save')}
        cancelText={t('settingsDrawer.cancel')}
        destroyOnClose
        width={480}
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item
            name="param_name"
            label={t('userMappingPanel.paramName')}
            rules={[{ required: true, message: t('userMappingPanel.inputParamName') }]}
            extra={t('userMappingPanel.paramNameExtra')}
          >
            <Input placeholder={t('userMappingPanel.paramNamePlaceholder')} disabled={!!editingKey} />
          </Form.Item>

          <Form.Item
            name="node_id"
            label={t('userMappingPanel.node')}
            rules={[{ required: true, message: t('userMappingPanel.selectNode') }]}
          >
            <Select
              options={nodeOptions}
              placeholder={t('userMappingPanel.selectNode')}
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
            label={t('userMappingPanel.field')}
            rules={[{ required: true, message: t('userMappingPanel.selectField') }]}
          >
            <Select
              options={fieldOptions}
              placeholder={selectedNodeId ? t('userMappingPanel.selectField') : t('userMappingPanel.selectNodeFirst')}
              disabled={!selectedNodeId}
              showSearch
            />
          </Form.Item>

          <Form.Item name="type" label={t('userMappingPanel.type')}>
            <Select options={TYPE_OPTIONS(t)} />
          </Form.Item>

          <Form.Item name="description" label={t('userMappingPanel.description')}>
            <Input placeholder={t('userMappingPanel.descriptionPlaceholder')} />
          </Form.Item>

          <Form.Item name="default_value" label={t('userMappingPanel.defaultValue')}>
            <InputNumber style={{ width: '100%' }} placeholder={t('userMappingPanel.defaultValuePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default UserMappingPanel;
