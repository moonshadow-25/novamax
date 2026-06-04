import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Form, InputNumber, Select, Switch, Button, Space, message, Alert, Tag, Popconfirm, Divider, Typography, Tooltip } from 'antd';
import { DeleteOutlined, UndoOutlined, QuestionCircleOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { engineService, modelService, backendService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

function TtsSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
  const { t } = useTranslation('home');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engines, setEngines] = useState([]);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [selectedEngineVersion, setSelectedEngineVersion] = useState(null);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);

  const inferVariantMarker = useCallback(() => {
    const candidate = String(
      model?.engine_version ||
      model?.remote_snapshot?.engine_version ||
      model?.id || ''
    ).toLowerCase();

    if (candidate.includes('1.5') || candidate.includes('tts1.5')) return 'index-tts1.5';
    if (candidate.includes('tts2') || candidate.includes('index_tts2') || candidate.includes('index-tts2')) return 'index-tts2';
    return null;
  }, [model]);

  const filterVersionsByVariant = useCallback((versions) => {
    const marker = inferVariantMarker();
    if (!marker) return versions || [];
    return (versions || []).filter(v => String(v.version || '').toLowerCase().includes(marker));
  }, [inferVariantMarker]);

  const buildVariantEngineInfo = useCallback((raw) => {
    if (!raw) return null;
    const marker = inferVariantMarker();
    if (!marker) return raw;

    const matchedVariants = Array.isArray(raw.variants)
      ? raw.variants.filter(v => String(v.id || '').toLowerCase() === marker.replace('index-', 'index'))
      : [];

    if (matchedVariants.length > 0) {
      return {
        ...raw,
        variants: matchedVariants
      };
    }

    return {
      ...raw,
      variants: [{
        id: marker.replace('index-', 'index'),
        name: marker.includes('1.5') ? 'IndexTTS 1.5' : 'IndexTTS 2.0',
        versions: (raw.versions || []).filter(v => String(v.version || '').toLowerCase().includes(marker))
      }]
    };
  }, [inferVariantMarker]);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const res = await engineService.getById('tts');
      const installedVersions = filterVersionsByVariant(res.installed_versions || []);
      const availableVersions = filterVersionsByVariant(
        Array.isArray(res.versions) && res.versions.length > 0
          ? res.versions
          : (res.variants || []).flatMap(variant => variant.versions || [])
      );
      const { orderedInstalledVersions, latestInstalledVersion } = resolveVersionOrder(
        availableVersions,
        installedVersions
      );
      setEngineInfo(buildVariantEngineInfo(res));
      setEngines(orderedInstalledVersions);
      setLatestEngineVersion(latestInstalledVersion);
      setEngineInstalled(installedVersions.length > 0);

      const pinnedVersion = model?.engine_version || null;
      if (pinnedVersion && orderedInstalledVersions.some(v => v.version === pinnedVersion)) {
        setSelectedEngineVersion(pinnedVersion);
      } else {
        setSelectedEngineVersion(null);
      }
    } catch {
      setEngineInfo(null);
      setEngines([]);
      setEngineInstalled(false);
    }
  }, [buildVariantEngineInfo, filterVersionsByVariant, model]);

  useEffect(() => {
    if (!visible || !model) return;
    const defaults = model.parameters || model.default_parameters || {};
    const cfg = model.tts_config || {};
    form.setFieldsValue({
      api_port: cfg.api_port ?? defaults['api-port'] ?? 7863,
      webui_port: cfg.webui_port ?? defaults['webui-port'] ?? 7864,
      workers: cfg.workers ?? defaults.workers ?? 1,
      fp16: cfg.fp16 ?? defaults.fp16 ?? false,
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
      message.success(t('settingsDrawer.ttsCardDeleted'));
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message || t('settingsDrawer.deleteFailed'));
    }
  };

  const handleSubmit = async ({ closeAfter = true, successText = t('settingsDrawer.ttsConfigSaved') } = {}) => {
    if (!model?.id) return;
    try {
      const values = await form.validateFields();
      setSaving(true);

      await modelService.update(model.id, {
        tts_config: {
          api_port: values.api_port,
          webui_port: values.webui_port,
          workers: values.workers,
          fp16: values.fp16,
        }
      });

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
        title={`${model?.name || 'TTS'} ${t('settingsDrawer.config')}`}
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
                const defaults = model?.parameters || model?.default_parameters || {};
                form.setFieldsValue({
                  api_port: defaults['api-port'] ?? 7863,
                  webui_port: defaults['webui-port'] ?? 7864,
                  workers: defaults.workers ?? 1,
                  fp16: defaults.fp16 ?? false,
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
                message={t('settingsDrawer.ttsEngineNotInstalled')}
                description={
                  <Button type="primary" size="small" onClick={() => setShowEngineModal(true)}>
                    {t('settingsDrawer.installTtsEngine')}
                  </Button>
                }
              />
            ) : (
              <Form layout="vertical" style={{ marginTop: 8 }}>
                <Form.Item
                  label={
                    <span>
                      {t('settingsDrawer.engineVersion')}
                      <Tooltip title={t('settingsDrawer.ttsEngineVersionHint')}>
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
            <Form.Item label={t('settingsDrawer.apiPort')} name="api_port" rules={[{ required: true, message: t('settingsDrawer.inputApiPort') }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label={t('settingsDrawer.webuiPort')} name="webui_port" rules={[{ required: true, message: t('settingsDrawer.inputWebuiPort') }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label="Workers" name="workers" rules={[{ required: true, message: t('settingsDrawer.inputWorkers') }]}>
              <InputNumber min={1} max={8} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>
                  {t('settingsDrawer.enableFp16')}
                  <Tooltip title={t('settingsDrawer.fp16Hint')}>
                    <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Form.Item name="fp16" valuePropName="checked" noStyle>
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
        engineId="tts"
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success(t('settingsDrawer.ttsEngineInstalled'));
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default TtsSettingsDrawer;
