import React, { useState, useEffect, useCallback } from 'react';
import { Drawer, Form, Input, InputNumber, Button, Space, Select, message, Divider, Tooltip, Modal } from 'antd';
import { FolderOpenOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { comfyuiService, engineService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import { useTranslation } from 'react-i18next';

function ComfyUIInstanceSettings({ visible, instance, onClose, onSave, onDelete }) {
  const { t } = useTranslation('home');
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
        custom_args: instance.custom_args || '',
        env_vars: instance.env_vars || ''
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
      message.success(version
        ? t('comfyuiInstanceSettings.switchVersionSuccessWithVersion', { version })
        : t('comfyuiInstanceSettings.switchVersionSuccessDefault'));
      onSave();
    } catch (error) {
      message.error(error.response?.data?.error || t('comfyuiInstanceSettings.switchVersionFailed'));
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
      message.success(t('comfyuiInstanceSettings.saveSuccess'));
      onSave();
      onClose();
    } catch (error) {
      if (error.response) {
        message.error(error.response?.data?.error || t('comfyuiInstanceSettings.saveFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    Modal.confirm({
      title: t('comfyuiInstanceSettings.deleteInstance'),
      content: t('comfyuiInstanceSettings.confirmDeleteInstance'),
      okText: t('settingsDrawer.confirm'),
      cancelText: t('settingsDrawer.cancel'),
      okButtonProps: { danger: true, loading },
      onOk: async () => {
        try {
          setLoading(true);
          await comfyuiService.deleteInstance(instance.id);
          message.success(t('comfyuiInstanceSettings.deleted'));
          onDelete();
          onClose();
        } catch (error) {
          message.error(error.response?.data?.error || t('comfyuiInstanceSettings.deleteFailed'));
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleOpenFolder = async () => {
    try {
      await comfyuiService.openInstanceFolder(instance.id);
      message.success(t('comfyuiInstanceSettings.openFolderSuccess'));
    } catch (error) {
      message.error(error.response?.data?.error || t('comfyuiInstanceSettings.openFolderFailed'));
    }
  };

  return (
    <Drawer
      title={t('comfyuiInstanceSettings.title')}
      placement="right"
      width={480}
      open={visible}
      onClose={onClose}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button danger onClick={handleDelete} loading={loading}>
            {t('comfyuiInstanceSettings.deleteInstance')}
          </Button>
          <Space>
            <Button onClick={onClose}>{t('settingsDrawer.cancel')}</Button>
            <Button type="primary" onClick={handleSave} loading={loading}>
              {t('settingsDrawer.save')}
            </Button>
          </Space>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={t('comfyuiInstanceSettings.instanceNameLabel')}
          name="name"
          rules={[{ required: true, message: t('comfyuiInstanceSettings.instanceNameRequired') }]}
        >
          <Input placeholder={t('comfyuiInstanceSettings.instanceNamePlaceholder')} />
        </Form.Item>

        <Form.Item
          label={
            <span>
              {t('comfyuiInstanceSettings.engineVersionLabel')}
              <Tooltip title={t('comfyuiInstanceSettings.engineVersionTooltip')}>
                <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
              </Tooltip>
            </span>
          }
        >
          <Select
            value={selectedEngineVersion}
            onChange={handleEngineVersionChange}
            placeholder={t('comfyuiInstanceSettings.defaultLatest')}
            allowClear
          >
            {engines.map((v) => (
              <Select.Option key={v.version} value={v.version}>
                {v.version}{v.version === latestEngineVersion ? ` (${t('comfyuiInstanceSettings.latest')})` : ''}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label={t('comfyuiInstanceSettings.hostLabel')}
          name="host"
          rules={[{ required: true, message: t('comfyuiInstanceSettings.hostRequired') }]}
        >
          <Input placeholder="0.0.0.0" />
        </Form.Item>

        <Form.Item
          label={t('comfyuiInstanceSettings.portLabel')}
          name="port"
          rules={[{ required: true, message: t('comfyuiInstanceSettings.portRequired') }]}
        >
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          label={t('comfyuiInstanceSettings.customArgsLabel')}
          name="custom_args"
          tooltip={t('comfyuiInstanceSettings.customArgsTooltip')}
        >
          <Input.TextArea
            rows={4}
            placeholder="--preview-method auto --fp8_e4m3fn"
          />
        </Form.Item>

        <Form.Item
          label={t('comfyuiInstanceSettings.envVarsLabel')}
          name="env_vars"
          tooltip={t('comfyuiInstanceSettings.envVarsTooltip')}
        >
          <Input.TextArea
            rows={5}
            placeholder={'CUDA_VISIBLE_DEVICES=0\nPYTORCH_CUDA_ALLOC_CONF=backend:cudaMallocAsync'}
          />
        </Form.Item>

        <Divider />

        <Button
          icon={<FolderOpenOutlined />}
          onClick={handleOpenFolder}
          block
          style={{ marginBottom: 8 }}
        >
          {t('comfyuiInstanceSettings.openFolder')}
        </Button>
      </Form>
    </Drawer>
  );
}

export default ComfyUIInstanceSettings;
