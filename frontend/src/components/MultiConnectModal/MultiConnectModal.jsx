import React, { useState, useEffect } from 'react';
import {
  Modal, Button, Space, Alert, InputNumber, Spin,
  Divider, Tag, Typography, message
} from 'antd';
import {
  WifiOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, ExclamationCircleOutlined
} from '@ant-design/icons';
import { multiConnectService } from '../../services/api';

const { Text } = Typography;

const STORAGE_KEY = 'slaveModeConfig';
const DEFAULT_PORT = 50052;
const DEFAULT_SUFFIX = 101;
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function clampInteger(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function parseIpSuffix(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const suffix = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(suffix)) return null;
  return suffix;
}

/**
 * 从机模式设置弹窗
 * 允许用户将本机配置为 RPC 从机节点
 */
function MultiConnectModal({ visible, onClose }) {
  const [checking, setChecking] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [adapters, setAdapters] = useState([]);
  const [usbConnected, setUsbConnected] = useState(null); // null | true | false
  const [status, setStatus] = useState(null); // null | 'enabled' | 'disabled'
  const [enabledConfig, setEnabledConfig] = useState(null); // { ip, port } | null
  const [slavePort, setSlavePort] = useState(DEFAULT_PORT);
  const [ipSuffix, setIpSuffix] = useState(DEFAULT_SUFFIX);

  useEffect(() => {
    if (visible) {
      initOnOpen();
    }
  }, [visible]);

  const initOnOpen = async () => {
    loadCachedConfig();
    await checkStatus();
    await checkUSB4();
  };

  const loadCachedConfig = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setSlavePort(DEFAULT_PORT);
        setIpSuffix(DEFAULT_SUFFIX);
        return;
      }

      const data = JSON.parse(raw);
      if (!data?.timestamp || Date.now() - data.timestamp > CACHE_MAX_AGE) {
        localStorage.removeItem(STORAGE_KEY);
        setSlavePort(DEFAULT_PORT);
        setIpSuffix(DEFAULT_SUFFIX);
        return;
      }

      const cachedPort = clampInteger(data.port, 1024, 65535, DEFAULT_PORT);
      let cachedSuffix = DEFAULT_SUFFIX;

      if (typeof data.ip === 'string') {
        cachedSuffix = clampInteger(parseIpSuffix(data.ip), 101, 254, DEFAULT_SUFFIX);
      } else {
        cachedSuffix = clampInteger(data.ip, 101, 254, DEFAULT_SUFFIX);
      }

      setSlavePort(cachedPort);
      setIpSuffix(cachedSuffix);
    } catch {
      setSlavePort(DEFAULT_PORT);
      setIpSuffix(DEFAULT_SUFFIX);
    }
  };

  const checkStatus = async () => {
    try {
      const s = await multiConnectService.getStatus();
      const isEnabled = s?.status === 'enabled' || s?.status === 1 || s?.status === true;
      setStatus(isEnabled ? 'enabled' : 'disabled');

      if (isEnabled) {
        const realPort = clampInteger(s?.port, 1024, 65535, DEFAULT_PORT);
        const realSuffix = clampInteger(parseIpSuffix(s?.ip), 101, 254, ipSuffix);
        const realIp = s?.ip || `169.254.30.${realSuffix}`;

        setSlavePort(realPort);
        setIpSuffix(realSuffix);
        setEnabledConfig({ ip: realIp, port: realPort });
      } else {
        setEnabledConfig(null);
      }
    } catch (e) {
      console.error('获取从机状态失败:', e);
      setStatus('disabled');
      setEnabledConfig(null);
    }
  };

  const checkUSB4 = async () => {
    setChecking(true);
    try {
      const result = await multiConnectService.checkUSB4();
      const list = Array.isArray(result?.adapters) ? result.adapters : [];
      const connected = typeof result?.connected === 'boolean'
        ? result.connected
        : list.length > 0;

      setAdapters(list);
      setUsbConnected(connected);
    } catch {
      message.error('检测 USB4 网卡失败');
      setAdapters([]);
      setUsbConnected(false);
    } finally {
      setChecking(false);
    }
  };

  const normalizeInputs = () => {
    const normalizedSuffix = clampInteger(ipSuffix, 101, 254, DEFAULT_SUFFIX);
    const normalizedPort = clampInteger(slavePort, 1024, 65535, DEFAULT_PORT);
    setIpSuffix(normalizedSuffix);
    setSlavePort(normalizedPort);
    return { normalizedSuffix, normalizedPort };
  };

  const handleEnable = async () => {
    const { normalizedSuffix, normalizedPort } = normalizeInputs();

    if (!Number.isInteger(normalizedSuffix) || normalizedSuffix < 101 || normalizedSuffix > 254) {
      message.error('IP 后缀需在 101-254 之间');
      return;
    }
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1024 || normalizedPort > 65535) {
      message.error('端口需在 1024-65535 之间');
      return;
    }

    setEnabling(true);
    try {
      const ip = `169.254.30.${normalizedSuffix}`;
      const result = await multiConnectService.enable(normalizedPort, ip);
      const realPort = clampInteger(result?.port, 1024, 65535, normalizedPort);
      setStatus('enabled');
      setEnabledConfig({ ip, port: realPort });

      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ip,
        port: realPort,
        timestamp: Date.now()
      }));

      window.dispatchEvent(new CustomEvent('slaveModeEnabled', {
        detail: { ip, port: realPort }
      }));

      message.success(`从机模式已启用，RPC 地址: ${ip}:${realPort}`);
    } catch (e) {
      message.error(e.response?.data?.error || '设置失败');
    } finally {
      setEnabling(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    try {
      await multiConnectService.disable();
      setStatus('disabled');
      setEnabledConfig(null);
      localStorage.removeItem(STORAGE_KEY);
      message.success('从机模式已关闭');
    } catch {
      message.error('关闭失败');
    } finally {
      setDisabling(false);
    }
  };

  const requestDisableConfirm = () => {
    Modal.confirm({
      title: '确认退出从机模式？',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          退出后将停止 RPC 服务，主机将无法连接到此设备。<br />
          请确保主机已断开连接，避免任务中断。
        </div>
      ),
      okText: '确认退出',
      cancelText: '取消',
      okButtonProps: { danger: true, loading: disabling },
      onOk: handleDisable,
      centered: true,
      maskClosable: false
    });
  };

  const isEnabled = status === 'enabled';
  const busy = checking || enabling || disabling;
  const showEnableButton = isEnabled || usbConnected === true;
  const rpcAddress = isEnabled
    ? `${enabledConfig?.ip || `169.254.30.${ipSuffix}`}:${enabledConfig?.port || slavePort}`
    : `169.254.30.${ipSuffix}:${slavePort}`;

  return (
    <Modal
      title={
        <Space direction="vertical" size={0}>
          <Space>
            <WifiOutlined />
            <span>{isEnabled ? '从机模式已启用' : '多机互联设置'}</span>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isEnabled ? '设备正在作为 RPC 从机节点运行' : '将此设备设置为 RPC 从机节点'}
          </Text>
        </Space>
      }
      open={visible}
      onCancel={() => {
        if (!isEnabled) onClose();
      }}
      footer={null}
      width={520}
      maskClosable={false}
      keyboard={!isEnabled}
      closable={!isEnabled}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {!isEnabled && (
          <Alert
            type="info"
            message="注意事项"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>设置后将关闭所有运行中的模块</li>
                <li>确保设备已通过 Type-C/USB4 接口连接主机</li>
                <li>设置前请关闭其他占用 GPU 的程序，避免冲突</li>
              </ul>
            }
          />
        )}

        {isEnabled && (
          <Alert
            type="info"
            message="运行注意事项"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>请勿启动其他模块，以免与 RPC 服务冲突</li>
                <li>确保保持网络连接稳定，避免主机连接中断</li>
                <li>退出从机模式前，请确认主机已断开连接</li>
              </ul>
            }
          />
        )}

        {!isEnabled && (
          <>
            {/* USB4 连接状态 */}
            <div>
              <Space>
                <Text type="secondary">连接状态：</Text>
                {checking ? (
                  <Tag icon={<LoadingOutlined />}>检查中...</Tag>
                ) : usbConnected === true ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>已连接</Tag>
                ) : usbConnected === false ? (
                  <Tag color="error" icon={<CloseCircleOutlined />}>未连接主机</Tag>
                ) : (
                  <Spin size="small" />
                )}
                <Button
                  size="small"
                  onClick={checkUSB4}
                  loading={checking}
                  disabled={enabling || disabling}
                >
                  {checking ? '检查中...' : (usbConnected ? '刷新' : '检查连接')}
                </Button>
              </Space>
            </div>

            <Divider style={{ margin: '4px 0' }} />

            {/* 配置 */}
            <Space align="center">
              <Text>IP地址：</Text>
              <Text code>169.254.30.</Text>
              <InputNumber
                min={101}
                max={254}
                value={ipSuffix}
                onChange={(v) => setIpSuffix(v ?? DEFAULT_SUFFIX)}
                onBlur={normalizeInputs}
                style={{ width: 90 }}
                disabled={busy}
              />
              <Text type="secondary">101-254</Text>
            </Space>
            <Space align="center">
              <Text>服务端口：</Text>
              <InputNumber
                min={1024}
                max={65535}
                value={slavePort}
                onChange={(v) => setSlavePort(v ?? DEFAULT_PORT)}
                onBlur={normalizeInputs}
                style={{ width: 120 }}
                disabled={busy}
              />
              <Text type="secondary">1024-65535</Text>
            </Space>

            {usbConnected === false && (
              <Alert
                type="warning"
                message="请先确保连接到主机"
              />
            )}

            {/* 操作按钮（设置态） */}
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={onClose} disabled={busy}>关闭</Button>
              {showEnableButton ? (
                <Button type="primary" onClick={handleEnable} loading={enabling} disabled={checking}>
                  进入从机模式
                </Button>
              ) : null}
            </Space>
          </>
        )}

        {isEnabled && (
          <>
            <Alert
              type="success"
              message="从机模式已启用"
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text type="secondary">设备正在作为 RPC 从机节点运行</Text>
                  <Divider style={{ margin: '8px 0' }} />
                  <span>主机添加命令：</span>
                  <Text code copyable style={{ fontSize: 16 }}>
                    {rpcAddress}
                  </Text>
                </Space>
              }
            />

            {/* 操作按钮（锁定态，仅保留一个） */}
            <Button
              danger
              type="primary"
              size="large"
              block
              onClick={requestDisableConfirm}
              loading={disabling}
            >
              退出从机模式
            </Button>
          </>
        )}
      </Space>
    </Modal>
  );
}

export default MultiConnectModal;
