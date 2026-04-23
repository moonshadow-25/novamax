import React, { useEffect, useState, useCallback } from 'react';
import { Drawer, Form, InputNumber, Select, Switch, Button, Space, message, Alert, Tag, Popconfirm, Divider, Typography, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { engineService, modelService } from '../../services/api';
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

function WhisperSettingsDrawer({ visible, model, onClose, onSave }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);
  const [engines, setEngines] = useState([]);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [engineActionLoading, setEngineActionLoading] = useState('');

  const latestAvailableVersion = engineInfo?.versions?.[0]?.version || null;
  const hasLatestInstalled = !!latestAvailableVersion && engines.some(v => v.version === latestAvailableVersion);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const res = await engineService.getById('whisper');
      const installedVersions = res.installed_versions || [];
      setEngineInfo(res);
      setEngines(installedVersions);
      setEngineInstalled(installedVersions.length > 0);
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

  const pollEngineTask = async (taskId) => {
    for (;;) {
      const state = await engineService.getDownloadStatus(taskId);
      if (state.status === 'completed') return;
      if (state.status === 'failed') throw new Error(state.error || '引擎任务失败');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  };

  const handleReinstall = async (version) => {
    const actionKey = `reinstall:${version}`;
    try {
      setEngineActionLoading(actionKey);
      const result = await engineService.reinstall('whisper', version);
      const taskId = result?.tasks?.[0]?.taskId;
      if (taskId) await pollEngineTask(taskId);
      message.success(`Whisper ${version} 重装完成`);
      await refreshEngineStatus();
    } catch (error) {
      message.error(error?.response?.data?.error || error?.message || '重装失败');
    } finally {
      setEngineActionLoading('');
    }
  };

  const handleUninstall = async (version) => {
    const actionKey = `uninstall:${version}`;
    try {
      setEngineActionLoading(actionKey);
      await engineService.uninstall('whisper', version);
      message.success(`Whisper ${version} 已卸载`);
      try {
        await refreshEngineStatus();
      } catch {
        message.warning('卸载完成，但刷新状态失败，请手动刷新页面确认');
      }
    } catch (error) {
      message.error(error?.response?.data?.error || error?.message || '卸载失败');
    } finally {
      setEngineActionLoading('');
    }
  };

  const handleSubmit = async () => {
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
      message.success('Whisper 配置已保存');
      onClose();
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
        title="Whisper 配置"
        placement="right"
        width={520}
        open={visible}
        onClose={onClose}
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSubmit}>保存</Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>引擎管理</div>
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
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Alert
                  type="success"
                  showIcon
                  message={`已安装 ${engines.length} 个 Whisper 版本`}
                  description={`当前默认版本：${engineInfo?.default_version || engines[0]?.version || '-'}`}
                />
                {engines.map(v => (
                  <div
                    key={v.version}
                    style={{
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      padding: '8px 10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <Space size={8}>
                      <Tag color={v.version === engineInfo?.default_version ? 'blue' : 'default'}>
                        {v.version}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        安装于 {new Date(v.installed_at).toLocaleString()}
                      </Text>
                    </Space>
                    <Space size={4}>
                      <Button
                        size="small"
                        loading={engineActionLoading === `reinstall:${v.version}`}
                        onClick={() => handleReinstall(v.version)}
                      >
                        重装
                      </Button>
                      <Popconfirm
                        title="确认卸载该版本？"
                        okText="卸载"
                        cancelText="取消"
                        onConfirm={() => handleUninstall(v.version)}
                      >
                        <Button
                          size="small"
                          danger
                          loading={engineActionLoading === `uninstall:${v.version}`}
                        >
                          卸载
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                ))}
                {hasLatestInstalled ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>已是最新版本</Text>
                ) : (
                  <Button onClick={() => setShowEngineModal(true)}>
                    安装新版本
                  </Button>
                )}
              </Space>
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

            <Form.Item
              name="enable_vad"
              valuePropName="checked"
              label={
                <span>
                  启用 VAD
                  <Tooltip title="VAD（语音活动检测）可自动过滤音频中的静默片段，提升转写准确率并减少幻听。需要提前下载 VAD 模型文件（ggml-silero-v6.2.0.bin）才能生效。">
                    <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                  </Tooltip>
                </span>
              }
            >
              <Switch />
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
