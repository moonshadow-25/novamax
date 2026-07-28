import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Form, InputNumber, Select, Button, Space, message, Alert, Popconfirm, Divider, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined, DeleteOutlined, UndoOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { engineService, modelService, backendService, asrStudioService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import { normalizeEngineType } from '../../utils/engineType';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

const ASR_LANGUAGES = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'ru', label: 'Russian' },
];

function resolveAsrVariant(model) {
  // model.engine_id 可能是具体的 variant ID（'whisper', 'qwen3-asr'）或父引擎 ID（'asr'）
  const rawId = model?.engine_id || model?.engine_type || '';
  if (rawId && rawId !== 'asr') return rawId;
  return 'whisper'; // 兜底：向后兼容旧模型（默认 whisper）
}

function AsrSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
  const { t } = useTranslation('home');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engines, setEngines] = useState([]);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [selectedEngineVersion, setSelectedEngineVersion] = useState(null);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);
  const [engineUpdateAvailable, setEngineUpdateAvailable] = useState(false);
  const [latestAvailableVersion, setLatestAvailableVersion] = useState(null);
  const [idleInfo, setIdleInfo] = useState(null);
  const engineName = engineInfo?.name || resolveAsrVariant(model);

  // 引擎空闲倒计时（每秒轮询）
  useEffect(() => {
    if (!visible || !model?.id) return;
    let timer;
    const poll = async () => {
      try {
        const info = await asrStudioService.getEngineIdleInfo(model.id);
        setIdleInfo(info);
      } catch { setIdleInfo(null); }
    };
    poll();
    timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [visible, model]);

  const formatCountdown = (ms) => {
    if (!ms || ms <= 0) return '即将关闭';
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
  };

  const refreshEngineStatus = useCallback(async () => {
    try {
      const variantId = resolveAsrVariant(model);
      const parentEngineId = 'asr';

      // 获取父引擎（含所有 variant 的完整信息）
      const res = await engineService.getById(parentEngineId);

      // 找到对应的 variant
      const variant = (res.variants || []).find(v =>
        String(v.id || '').toLowerCase() === String(variantId).toLowerCase()
      );

      let availableVersions, installedVersions;
      if (variant) {
        // 仅该 variant 的可用版本
        availableVersions = (variant.versions || []).map(v => ({
          ...v, variant_id: variant.id, variant_name: variant.name
        }));
        // 仅该 variant 的已安装版本
        const variantIdLower = String(variant.id).toLowerCase();
        const variantVersionSet = new Set((variant.versions || []).map(v => v.version));
        const variantNorm = normalizeEngineType(variant.id);
        installedVersions = (res.installed_versions || []).filter(v => {
          if (v.variant_id && String(v.variant_id).toLowerCase() === variantIdLower) return true;
          if (variantVersionSet.has(v.version)) return true;
          return normalizeEngineType(v.version).includes(variantNorm);
        });
      } else {
        availableVersions = res.versions || [];
        installedVersions = res.installed_versions || [];
      }

      const { orderedInstalledVersions, latestInstalledVersion } = resolveVersionOrder(
        availableVersions, installedVersions
      );

      setEngineInfo({
        ...res,
        variants: variant ? [variant] : res.variants,
        name: variant ? `${variant.name}` : res.name
      });
      setEngines(orderedInstalledVersions);
      setLatestEngineVersion(latestInstalledVersion);
      setEngineInstalled(installedVersions.length > 0);
      setSelectedEngineVersion(model?.engine_version || null);

      // 检测更新：availableVersions 按 engines.json 顺序排列，index 0 即最新
      if (availableVersions.length > 0 && installedVersions.length > 0) {
        const latest = availableVersions[0].version;
        setLatestAvailableVersion(latest);
        setEngineUpdateAvailable(latest !== latestInstalledVersion);
      }
    } catch {
      setEngineInfo(null);
      setEngines([]);
      setEngineInstalled(false);
    }
  }, [model]);

  useEffect(() => {
    if (!visible || !model) return;

    const cfg = model.asr_config || model.whisper_config || {};
    form.setFieldsValue({
      idle_timeout_min: cfg.idle_timeout_min ?? 5,
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

      // 仅保留需要用户配置的字段，其余由引擎自动管理
      const payload = {
        asr_config: {
          idle_timeout_min: values.idle_timeout_min,
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
        title={`${model?.name || 'ASR'} ${t('settingsDrawer.config')}`}
        placement="right"
        width={480}
        open={visible}
        onClose={onClose}
        extra={
          <Space>
            <Button
              icon={<UndoOutlined />}
              size="small"
              loading={saving}
              onClick={async () => {
                form.setFieldsValue({ idle_timeout_min: 5 });
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
          {/* 引擎版本（只读，始终使用最新版） */}
          <div>
            <Text strong>引擎版本</Text>
            {!engineInstalled ? (
              <Alert type="warning" showIcon message={t('settingsDrawer.engineNotInstalled', { engineName })} style={{ marginTop: 8 }}
                action={<Button size="small" type="primary" onClick={() => setShowEngineModal(true)}>{t('settingsDrawer.installEngine', { engineName })}</Button>} />
            ) : engineUpdateAvailable ? (
              <Alert type="info" showIcon message={`新版本可用: ${latestAvailableVersion}（当前: ${latestEngineVersion}）`} style={{ marginTop: 8 }}
                action={<Button size="small" type="primary" onClick={() => setShowEngineModal(true)}>更新引擎</Button>} />
            ) : (
              <div style={{ marginTop: 4 }}>
                <Text>{latestEngineVersion || '—'}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>(最新版本)</Text>
              </div>
            )}
          </div>

          <Divider style={{ margin: '6px 0' }} />

          <Form form={form} layout="vertical">
            <Form.Item label="闲置自动关闭" style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>引擎收到请求时会自动启动，此设置不影响外部调用。</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>闲置</span>
                <Form.Item name="idle_timeout_min" rules={[{ required: true }]} noStyle>
                  <InputNumber min={3} max={30} step={1} style={{ width: 72 }} />
                </Form.Item>
                <span>分钟后自动关闭以节约资源</span>
              </div>
              {idleInfo && idleInfo.status === 'running' && idleInfo.activeTasks === 0 && (
                <div style={{ marginTop: 6, fontSize: 13, color: idleInfo.remainingMs < 60000 ? '#ff4d4f' : '#52c41a' }}>
                  {idleInfo.remainingMs <= 0 ? '即将自动关闭...' : `${formatCountdown(idleInfo.remainingMs)} 后自动关闭`}
                </div>
              )}
            </Form.Item>
          </Form>

          <Divider />

          <Alert
            type="info"
            showIcon
            message="引擎端口由系统动态分配，无需手动配置"
            style={{ fontSize: 12 }}
          />

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
        engineId="asr"
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success(t('settingsDrawer.engineInstalled', { engineName }));
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default AsrSettingsDrawer;
