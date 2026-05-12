import React, { useEffect, useState, useCallback } from 'react';
import { Drawer, Form, InputNumber, Select, Switch, Button, Space, message, Alert, Tag, Popconfirm, Divider, Typography, Tooltip } from 'antd';
import { QuestionCircleOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import { engineService, modelService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

const WHISPER_LANGUAGES = [
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

function WhisperSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
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
      message.success('Whisper 卡片已删除');
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message || '删除失败');
    }
  };

  const handleSubmit = async ({ closeAfter = true, successText = 'Whisper 配置已保存' } = {}) => {
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
      message.error(error.response?.data?.error || error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer
        title={`${model?.name || 'Whisper'} 配置`}
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
                message="未检测到已安装的 Whisper 引擎"
                description={
                  <Button type="primary" size="small" onClick={() => setShowEngineModal(true)}>
                    安装 Whisper 引擎
                  </Button>
                }
              />
            ) : (
              <Form layout="vertical" style={{ marginTop: 8 }}>
                <Form.Item
                  label={
                    <span>
                      引擎版本
                      <Tooltip title="选择运行此卡片使用的 Whisper 引擎版本；留空表示默认（最新版本）。">
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
                    {engines.map((v) => (
                      <Select.Option key={v.version} value={v.version}>
                        {v.version}{v.version === latestEngineVersion ? '（最新）' : ''}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Form>
            )}
          </div>

          <Divider style={{ margin: '6px 0' }} />

          <Form form={form} layout="vertical">
            <Form.Item label="线程数" name="threads" rules={[{ required: true, message: '请输入线程数' }]}>
              <InputNumber min={1} max={8} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label="默认语言" name="language" rules={[{ required: true, message: '请选择默认语言' }]}>
              <Select options={WHISPER_LANGUAGES} />
            </Form.Item>

            <Form.Item label="Whisper 端口" name="whisper_port" rules={[{ required: true, message: '请输入 Whisper 端口' }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item label="Flask 端口" name="flask_port" rules={[{ required: true, message: '请输入 Flask 端口' }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>
                  启用 VAD
                  <Tooltip title="VAD（语音活动检测）可自动过滤音频中的静默片段，提升转写准确率并减少幻听。需要提前下载 VAD 模型文件（ggml-silero-v6.2.0.bin）才能生效。">
                    <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Form.Item name="enable_vad" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </Form.Item>
          </Form>
        </Space>
      </Drawer>

      <EngineDownloadModal
        visible={showEngineModal}
        engineId="whisper"
        engineInfo={engineInfo}
        onComplete={async () => {
          setShowEngineModal(false);
          await refreshEngineStatus();
          message.success('Whisper 引擎安装完成');
        }}
        onCancel={() => setShowEngineModal(false)}
      />
    </>
  );
}

export default WhisperSettingsDrawer;
