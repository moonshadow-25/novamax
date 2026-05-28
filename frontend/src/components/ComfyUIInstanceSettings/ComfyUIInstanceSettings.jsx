import React, { useState, useEffect, useCallback } from 'react';
import { Drawer, Form, Input, InputNumber, Button, Space, Select, message, Divider, Tooltip } from 'antd';
import { FolderOpenOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { comfyuiService, engineService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';

function ComfyUIInstanceSettings({ visible, instance, onClose, onSave, onDelete }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [engines, setEngines] = useState([]);
  const [selectedEngineVersion, setSelectedEngineVersion] = useState(null);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const res = await engineService.getById('comfyui');
      const installedVersions = res.installed_versions || [];
      const availableVersions = res.versions || [];
      const { orderedInstalledVersions, latestInstalledVersion } = resolveVersionOrder(
        availableVersions,
        installedVersions
      );
      setEngines(orderedInstalledVersions);
      setLatestEngineVersion(latestInstalledVersion);

      // 仅在用户已显式选择并保存版本时才显示固定版本
      const pinnedVersion = instance?.engine_version || null;
      if (pinnedVersion && orderedInstalledVersions.some(v => v.version === pinnedVersion)) {
        setSelectedEngineVersion(pinnedVersion);
      } else {
        setSelectedEngineVersion(null);
      }
    } catch {
      setEngines([]);
      setLatestEngineVersion(null);
    }
  }, [instance]);

  useEffect(() => {
    if (visible && instance) {
      form.setFieldsValue({
        name: instance.name,
        host: instance.host,
        port: instance.port,
        custom_args: instance.custom_args || ''
      });
    }
  }, [visible, instance, form]);

  useEffect(() => {
    if (!visible) return;
    refreshEngineStatus();
  }, [visible, refreshEngineStatus]);

  const handleEngineVersionChange = async (version) => {
    try {
      await comfyuiService.updateInstance(instance.id, { engine_version: version || null });
      setSelectedEngineVersion(version || null);
      message.success(version ? `已切换到引擎版本 ${version}` : '已切换到默认（最新）版本');
      onSave();
    } catch (error) {
      message.error(error.response?.data?.error || '切换引擎版本失败');
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await comfyuiService.updateInstance(instance.id, {
        ...values,
        engine_version: selectedEngineVersion || null
      });
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
          label={
            <span>
              引擎版本
              <Tooltip title="选择运行此实例使用的 ComfyUI 引擎版本；留空表示默认（最新版本）。">
                <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
              </Tooltip>
            </span>
          }
        >
          <Select
            value={selectedEngineVersion}
            onChange={handleEngineVersionChange}
            placeholder="默认（最新版本）"
            allowClear
          >
            {engines.map((v) => (
              <Select.Option key={v.version} value={v.version}>
                {v.version}{v.version === latestEngineVersion ? '（最新）' : ''}
              </Select.Option>
            ))}
          </Select>
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
