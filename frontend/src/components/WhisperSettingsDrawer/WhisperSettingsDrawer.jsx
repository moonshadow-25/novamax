import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Form, InputNumber, Select, Switch, Button, Space, message, Alert, Tag, Popconfirm, Divider, Typography, Tooltip } from 'antd';
import { QuestionCircleOutlined, DeleteOutlined, UndoOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { engineService, modelService, backendService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

const WHISPER_LANGUAGES = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'ru', label: 'Russian' },
];

function WhisperSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
  const { t } = useTranslation('home');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engines, setEngines] = useState([]);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [selectedEngineVersion, setSelectedEngineVersion] = useState(null);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const res = await engineService.getById('whisper');
      const installedVersions = res.installed_versions || [];
      const availableVersions = res.versions || [];
      const { orderedInstalledVersions, latestInstalledVersion } = resolveVersionOrder(
        availableVersions,
        installedVersions
      );
      setEngineInfo(res);
      setEngines(orderedInstalledVersions);
      setLatestEngineVersion(latestInstalledVersion);
      setEngineInstalled(installedVersions.length > 0);
      setSelectedEngineVersion(model?.engine_version || null);
    } catch {
      setEngineInfo(null);
      setEngines([]);
      setEngineInstalled(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || !model) return;

    const cfg = model.whisper_config || {};
    form.setFieldsValue({
      threads: cfg.threads ?? 8,
      language: cfg.language || 'auto',
      enable_vad: cfg.enable_vad ?? false,
      whisper_port: cfg.whisper_port ?? 18181,
      flask_port: cfg.flask_port ?? 8281,
    });
  }, [visible, model, form]);

  useEffect(() => {
    if (!visible) return;
    refreshEngineStatus();
  }, [visible, refreshEngineStatus]);

  const handleEngineVersionChange = async (version) => {
    try {
      await modelService.update(model.id, { engine_version: version || null });
      setSelectedEngineVersion(version || null);
      message.success(version ? t('settingsDrawer.switchedEngineVersion', { version }) : t('settingsDrawer.switchedDefaultLatestVersion'));
      onSave?.();
    } catch (e) {
      message.error(t('settingsDrawer.switchEngineVersionFailed'));
    }
  };

  const handleDelete = async () => {
    if (!model?.id) return;
    try {
      await modelService.delete(model.id);
      message.success(t('settingsDrawer.whisperCardDeleted'));
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message || t('settingsDrawer.deleteFailed'));
    }
  };

  const handleSubmit = async ({ closeAfter = true, successText = t('settingsDrawer.whisperConfigSaved') } = {}) => {
    if (!model?.id) return;
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload = {
        whisper_config: {
          threads: values.threads,
          language: values.language,
          enable_vad: values.enable_vad,
          whisper_port: values.whisper_port,
          flask_port: values.flask_port,
        },
      };

      await modelService.update(model.id, payload);
      message.success(successText);
      if (closeAfter) onClose();
      onSave?.();
    } catch (error) {
      if (error?.errorFields) return;
      message.error(error.response?.data?.error || error.message || t('settingsDrawer.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer
        title={`${model?.name || 'Whisper'} ${t('settingsDrawer.config')}`}
        placement="right"
        width={520}
        open={visible}
        onClose={onClose}
        extra={
          <Space>
            <Button
              icon={<UndoOutlined />}
              size="small"
              loading={saving}
              onClick={async () => {
                const defaults = model?.default_parameters || {};
                form.setFieldsValue({
                  threads: defaults.threads ?? 8,
                  language: defaults.language || 'auto',
                  enable_vad: defaults.vad ?? false,
                  whisper_port: defaults.port ?? 18181,
                  flask_port: defaults.flask_port ?? 8281,
                });
                await handleSubmit({ closeAfter: false, successText: t('settingsDrawer.defaultsRestoredAndSaved') });
              }}
            >
              {t('settingsDrawer.restoreDefaults')}
            </Button>
            <Popconfirm
              title={t('settingsDrawer.deleteCard')}
              description={t('settingsDrawer.deleteCardAndFilesDesc')}
              okText={t('settingsDrawer.delete')}
              okButtonProps={{ danger: true }}
              cancelText={t('settingsDrawer.cancel')}
              onConfirm={handleDelete}
            >
              <Button danger icon={<DeleteOutlined />} size="small">{t('settingsDrawer.deleteCard')}</Button>
            </Popconfirm>
          </Space>
        }
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>{t('settingsDrawer.cancel')}</Button>
            <Button type="primary" loading={saving} onClick={handleSubmit}>{t('settingsDrawer.save')}</Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            {!engineInstalled ? (
              <Alert
                type="warning"
                showIcon
                message={t('settingsDrawer.whisperEngineNotInstalled')}
                description={
                  <Button type="primary" size="small" onClick={() => setShowEngineModal(true)}>
                    {t('settingsDrawer.installWhisperEngine')}
                  </Button>
                }
              />
            ) : (
              <Form layout="vertical" style={{ marginTop: 8 }}>
                <Form.Item
                  label={
                    <span>
                      {t('settingsDrawer.engineVersion')}
                      <Tooltip title={t('settingsDrawer.whisperEngineVersionHint')}>
                        <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                      </Tooltip>
                    </span>
                  }
                  style={{ marginBottom: 8 }}
                >
                  <Select
                    value={selectedEngineVersion}
                    onChange={handleEngineVersionChange}
                    placeholder={t('settingsDrawer.defaultLatestVersion')}
                    allowClear
                  >
                    {engines.map((v) => (
                      <Select.Option key={v.version} value={v.version}>
                        {v.version}{v.version === latestEngineVersion ? ` ${t('settingsDrawer.latestTag')}` : ''}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Form>
            )}
          </div>

          <Divider style={{ margin: '6px 0' }} />

          <Form form={form} layout="vertical">
            <Form.Item label={t('settingsDrawer.whisperThreads')} name="threads" rules={[{ required: true, message: t('settingsDrawer.inputThreads') }]}>
              <InputNumber min={1} max={8} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label={t('settingsDrawer.defaultLanguage')} name="language" rules={[{ required: true, message: t('settingsDrawer.selectDefaultLanguage') }]}>
              <Select options={WHISPER_LANGUAGES} />
            </Form.Item>

            <Form.Item label={t('settingsDrawer.whisperPort')} name="whisper_port" rules={[{ required: true, message: t('settingsDrawer.inputWhisperPort') }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label={t('settingsDrawer.flaskPort')} name="flask_port" rules={[{ required: true, message: t('settingsDrawer.inputFlaskPort') }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>
                  {t('settingsDrawer.enableVad')}
                  <Tooltip title={t('settingsDrawer.vadHint')}>
                    <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Form.Item name="enable_vad" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </Form.Item>
          </Form>

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
        </Space>
      </Drawer>

      <EngineDownloadModal
        visible={showEngineModal}
        engineId="whisper"
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success(t('settingsDrawer.whisperEngineInstalled'));
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default WhisperSettingsDrawer;
