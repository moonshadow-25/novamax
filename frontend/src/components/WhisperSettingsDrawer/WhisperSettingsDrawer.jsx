import React, { useEffect, useState, useCallback } from 'react';
import { Drawer, Form, InputNumber, Select, Button, Space, message, Alert, Popconfirm, Divider, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined, DeleteOutlined, UndoOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { engineService, modelService, backendService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const ASR_LANGUAGES = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
];

const { Text } = Typography;

function WhisperSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
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

  const refreshEngineStatus = useCallback(async () => {
    try {
      const engineId = model?.engine_id || model?.engine_type || 'asr';
      const res = await engineService.getById(engineId);
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

      // 检测更新（同 TTS）
      if (availableVersions.length > 0 && installedVersions.length > 0) {
        const sorted = [...availableVersions].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
        const latest = sorted[0].version;
        setLatestAvailableVersion(latest);
        setEngineUpdateAvailable(latest !== latestInstalledVersion);
      }
    } catch {
      setEngineInfo(null);
      setEngines([]);
      setEngineInstalled(false);
    }
  }, []);

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
      message.success(version ? `已切换到引擎版本 ${version}` : '已切换到默认（最新）版本');
      onSave?.();
    } catch (e) {
      message.error('切换引擎版本失败');
    }
  };

  const handleDelete = async () => {
    if (!model?.id) return;
    try {
      await modelService.delete(model.id);
      message.success('ASR 卡片已删除');
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message || '删除失败');
    }
  };

  const handleSubmit = async ({ closeAfter = true, successText = 'ASR 配置已保存' } = {}) => {
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
      message.error(error.response?.data?.error || error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer
        title={`${model?.name || 'ASR'} 配置`}
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
                form.setFieldsValue({ threads: 8, language: 'auto' });
                await handleSubmit({ closeAfter: false, successText: '已恢复默认参数并保存' });
              }}
            >
              恢复默认
            </Button>
            <Popconfirm
              title="删除卡片"
              description="将删除此卡片配置及所有已下载的模型文件，此操作不可撤销。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={handleDelete}
            >
              <Button danger icon={<DeleteOutlined />} size="small">删除卡片</Button>
            </Popconfirm>
          </Space>
        }
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSubmit}>保存</Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {/* 引擎版本（只读，始终使用最新版） */}
          <div>
            <Text strong>引擎版本</Text>
            {!engineInstalled ? (
              <Alert type="warning" showIcon message="未检测到已安装的 ASR 引擎" style={{ marginTop: 8 }}
                action={<Button size="small" type="primary" onClick={() => setShowEngineModal(true)}>安装引擎</Button>} />
            ) : engineUpdateAvailable ? (
              <Alert type="info" showIcon message={`新版本可用: ${latestAvailableVersion}（当前: ${latestEngineVersion}）`} style={{ marginTop: 8 }}
                action={<Button size="small" type="primary" onClick={() => setShowEngineModal(true)}>更新引擎</Button>} />
            ) : (
              <div style={{ marginTop: 4 }}>
                <Text>{latestEngineVersion || '—'}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>（最新版本）</Text>
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
                message.success('已打开日志文件夹');
              } catch {
                message.error('打开失败');
              }
            }}
            block
          >
            打开日志文件夹
          </Button>
        </Space>
      </Drawer>

      <EngineDownloadModal
        visible={showEngineModal}
        engineId={model?.engine_id || model?.engine_type || 'asr'}
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success('ASR 引擎安装完成');
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default WhisperSettingsDrawer;
