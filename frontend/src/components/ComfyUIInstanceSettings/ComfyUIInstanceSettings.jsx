import React, { useState, useEffect } from 'react';
import { Drawer, Form, Input, InputNumber, Button, Space, Select, message, Divider } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { comfyuiService, engineService } from '../../services/api';

function ComfyUIInstanceSettings({ visible, instance, onClose, onSave, onDelete }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [engines, setEngines] = useState([]);

  useEffect(() => {
    if (visible && instance) {
      form.setFieldsValue({
        name: instance.name,
        host: instance.host,
        port: instance.port,
        engine_version: instance.engine_version || undefined,
        custom_args: instance.custom_args || ''
      });
    }
  }, [visible, instance, form]);

  useEffect(() => {
    // 加载已安装的 ComfyUI 引擎版本
    engineService.getById('comfyui').then(res => {
      if (res.installed_versions) {
        setEngines(res.installed_versions);
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await comfyuiService.updateInstance(instance.id, values);
      message.success('保存成功');
      onSave();
      onClose();
    } catch (error) {
      if (error.response) {
        message.error(error.response?.data?.error || '保存失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('确定要删除此实例吗？')) return;
    try {
      setLoading(true);
      await comfyuiService.deleteInstance(instance.id);
      message.success('已删除');
      onDelete();
      onClose();
    } catch (error) {
      message.error(error.response?.data?.error || '删除失败');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await comfyuiService.openInstanceFolder(instance.id);
      message.success('已打开文件夹');
    } catch (error) {
      message.error(error.response?.data?.error || '打开失败');
    }
  };

  return (
    <Drawer
      title="ComfyUI 实例设置"
      placement="right"
      width={480}
      open={visible}
      onClose={onClose}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button danger onClick={handleDelete} loading={loading}>
            删除此实例
          </Button>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSave} loading={loading}>
              保存
            </Button>
          </Space>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="实例名称"
          name="name"
          rules={[{ required: true, message: '请输入实例名称' }]}
        >
          <Input placeholder="例如：默认实例" />
        </Form.Item>

        <Form.Item
          label="引擎版本"
          name="engine_version"
          tooltip="留空则使用最新版本"
        >
          <Select
            placeholder="选择 ComfyUI 版本"
            allowClear
            options={engines.map(e => ({ label: e.version, value: e.version }))}
          />
        </Form.Item>

        <Form.Item
          label="监听地址"
          name="host"
          rules={[{ required: true, message: '请输入监听地址' }]}
        >
          <Input placeholder="0.0.0.0" />
        </Form.Item>

        <Form.Item
          label="端口"
          name="port"
          rules={[{ required: true, message: '请输入端口' }]}
        >
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          label="启动参数"
          name="custom_args"
          tooltip="直接输入命令行参数，例如：--preview-method auto --fp8_e4m3fn"
        >
          <Input.TextArea
            rows={4}
            placeholder="--preview-method auto --fp8_e4m3fn"
          />
        </Form.Item>

        <Divider />

        <Button
          icon={<FolderOpenOutlined />}
          onClick={handleOpenFolder}
          block
          style={{ marginBottom: 8 }}
        >
          打开 ComfyUI 文件夹
        </Button>
      </Form>
    </Drawer>
  );
}

export default ComfyUIInstanceSettings;
