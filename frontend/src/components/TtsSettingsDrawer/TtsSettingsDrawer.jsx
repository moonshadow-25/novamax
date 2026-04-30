import React, { useEffect, useState, useCallback } from 'react';
import { Drawer, Form, InputNumber, Select, Switch, Button, Space, message, Alert, Tag, Popconfirm, Divider, Typography, Tooltip } from 'antd';
import { DeleteOutlined, UndoOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { engineService, modelService } from '../../services/api';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

function TtsSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engines, setEngines] = useState([]);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [selectedEngineVersion, setSelectedEngineVersion] = useState(null);

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
      setEngineInfo(buildVariantEngineInfo(res));
      setEngines(installedVersions);
      setEngineInstalled(installedVersions.length > 0);

      const pinnedVersion = model?.engine_version || null;
      if (pinnedVersion && installedVersions.some(v => v.version === pinnedVersion)) {
        setSelectedEngineVersion(pinnedVersion);
      } else {
        setSelectedEngineVersion(installedVersions[0]?.version || null);
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
      message.success('TTS 卡片已删除');
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message || '删除失败');
    }
  };

  const handleSubmit = async ({ closeAfter = true, successText = 'TTS 配置已保存' } = {}) => {
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
      message.error(error.response?.data?.error || error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer
        title={`${model?.name || 'TTS'} 配置`}
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
          <div>
            {!engineInstalled ? (
              <Alert
                type="warning"
                showIcon
                message="未检测到已安装的 TTS 引擎"
                description={
                  <Button type="primary" size="small" onClick={() => setShowEngineModal(true)}>
                    安装 TTS 引擎
                  </Button>
                }
              />
            ) : (
              <Form layout="vertical" style={{ marginTop: 8 }}>
                <Form.Item
                  label={
                    <span>
                      引擎版本
                      <Tooltip title="选择运行此卡片使用的 TTS 引擎版本；留空表示默认（最新版本）。">
                        <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                      </Tooltip>
                    </span>
                  }
                  style={{ marginBottom: 8 }}
                >
                  <Select
                    value={selectedEngineVersion}
                    onChange={handleEngineVersionChange}
                    placeholder="默认（最新版本）"
                    allowClear
                  >
                    {engines.map((v, index) => (
                      <Select.Option key={v.version} value={v.version}>
                        {v.version}{index === 0 ? '（最新）' : ''}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Form>
            )}
          </div>

          <Divider style={{ margin: '6px 0' }} />

          <Form form={form} layout="vertical">
            <Form.Item label="API 端口" name="api_port" rules={[{ required: true, message: '请输入 API 端口' }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label="WebUI 端口" name="webui_port" rules={[{ required: true, message: '请输入 WebUI 端口' }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label="Workers" name="workers" rules={[{ required: true, message: '请输入 workers 数' }]}>
              <InputNumber min={1} max={8} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>
                  启用 FP16
                  <Tooltip title="启用后使用半精度推理，通常可降低显存占用并提升速度，可能对音质稳定性有轻微影响。">
                    <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Form.Item name="fp16" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </Form.Item>
          </Form>
        </Space>
      </Drawer>

      <EngineDownloadModal
        visible={showEngineModal}
        engineId="tts"
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success('TTS 引擎安装完成');
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default TtsSettingsDrawer;
