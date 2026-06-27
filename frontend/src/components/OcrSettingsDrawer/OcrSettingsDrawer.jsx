import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Form, InputNumber, Button, Space, message, Alert, Popconfirm, Divider, Typography } from 'antd';
import { DeleteOutlined, UndoOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { engineService, modelService, backendService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

function OcrSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
  const { t } = useTranslation('home');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);
  const [engineUpdateAvailable, setEngineUpdateAvailable] = useState(false);
  const [latestAvailableVersion, setLatestAvailableVersion] = useState(null);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const engineId = model?.engine_id || model?.engine_type || 'ocr';
      const res = await engineService.getById(engineId);
      const installedVersions = res.installed_versions || [];
      // 版本在 variants[].versions 中，需要 flatten
      const availableVersions = (res.variants || []).flatMap(v =>
        (v.versions || []).map(v2 => ({ ...v2, variant_id: v.id }))
      );
      const { latestInstalledVersion } = resolveVersionOrder(
        availableVersions,
        installedVersions
      );
      setEngineInfo(res);
      setLatestEngineVersion(latestInstalledVersion);
      setEngineInstalled(installedVersions.length > 0);

      if (availableVersions.length > 0 && installedVersions.length > 0) {
        const latest = availableVersions[0].version;
        setLatestAvailableVersion(latest);
        setEngineUpdateAvailable(latest !== latestInstalledVersion);
      }
    } catch {
      setEngineInfo(null);
      setEngineInstalled(false);
    }
  }, [model]);

  useEffect(() => {
    if (!visible) return;
    refreshEngineStatus();
  }, [visible, refreshEngineStatus]);

  useEffect(() => {
    if (!visible || !model) return;
    const cfg = model.ocr_config || {};
    form.setFieldsValue({
      idle_timeout_min: cfg.idle_timeout_min ?? 5,
    });
  }, [visible, model, form]);

  const handleDelete = async () => {
    if (!model?.id) return;
    try {
      await modelService.delete(model.id);
      message.success(t('settingsDrawer.cardDeleted'));
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message || t('settingsDrawer.deleteFailed'));
    }
  };

  const handleSubmit = async ({ closeAfter = true, successText = 'OCR 配置已保存' } = {}) => {
    if (!model?.id) return;
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload = {
        ocr_config: {
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
        title={`${model?.name || 'OCR'} ${t('settingsDrawer.config')}`}
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
                await handleSubmit({ closeAfter: false, successText: '已恢复默认设置并保存' });
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
          {/* 引擎版本 */}
          <div>
            <Text strong>引擎版本</Text>
            {!engineInstalled ? (
              <Alert type="warning" showIcon message="OCR 引擎未安装，请先安装引擎" style={{ marginTop: 8 }}
                action={<Button size="small" type="primary" onClick={() => setShowEngineModal(true)}>安装 OCR 引擎</Button>} />
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

          {/* 闲置自动关闭（暂时隐藏）
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
            </Form.Item>
          </Form>
          */}

          <Divider />

          {/* 引擎端口说明 */}
          <Alert
            type="info"
            showIcon
            message="引擎端口由系统动态分配，无需手动配置"
            style={{ fontSize: 12 }}
          />

          {/* 打开日志文件夹 */}
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
        engineId={model?.engine_id || model?.engine_type || 'ocr'}
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success('OCR 引擎安装完成');
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default OcrSettingsDrawer;
