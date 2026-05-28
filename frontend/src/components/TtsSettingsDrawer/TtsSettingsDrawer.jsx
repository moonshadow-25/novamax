import React, { useEffect, useState, useCallback } from 'react';
import { Drawer, Select, Button, Space, message, Alert, Popconfirm, Typography, InputNumber, Slider } from 'antd';
import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { engineService, modelService, backendService, ttsStudioService } from '../../services/api';
import { resolveVersionOrder } from '../../services/engineVersionOrder';
import { normalizeEngineType } from '../../utils/engineType';
import EngineDownloadModal from '../EngineDownloadModal/EngineDownloadModal';

const { Text } = Typography;

function resolveModelVariant(model, variants) {
  const candidate = normalizeEngineType(
    model?.engine_version ||
    model?.remote_snapshot?.engine_version ||
    model?.id || ''
  );

  if (variants && variants.length > 0) {
    const matched = variants.find(v => {
      const id = v?.id || v?.engine_type;
      if (!id) return false;
      const vNorm = normalizeEngineType(id);
      return vNorm === candidate || vNorm.includes(candidate) || candidate.includes(vNorm);
    });
    if (matched) return matched.id || matched.engine_type;
  }

  return candidate;
}

function TtsSettingsDrawer({ visible, model, onClose, onSave, onDelete }) {
  const [engineInfo, setEngineInfo] = useState(null);
  const [engines, setEngines] = useState([]);
  const [engineInstalled, setEngineInstalled] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [latestEngineVersion, setLatestEngineVersion] = useState(null);
  const [idleTimeout, setIdleTimeout] = useState(5);
  const [runtimeItems, setRuntimeItems] = useState([]);
  const [runtimeValues, setRuntimeValues] = useState({});
  const runtimeEngineTypeRef = React.useRef(null);
  const [selectedRuntime, setSelectedRuntime] = useState(null);
  const [availableRuntimes, setAvailableRuntimes] = useState([]);
  const [engineUpdateAvailable, setEngineUpdateAvailable] = useState(false);
  const [latestAvailableVersion, setLatestAvailableVersion] = useState(null);

  const refreshEngineStatus = useCallback(async () => {
    try {
      const res = await engineService.getById('tts');
      const modelVariant = resolveModelVariant(model, res.variants);
      const variantVersions = (res.variants || [])
        .filter(v => modelVariant ? normalizeEngineType(v.id) === normalizeEngineType(modelVariant) : true)
        .flatMap(v => v.versions || []);
      const variantVersionSet = new Set(variantVersions.map(v => v.version));
      const variantInstalled = (res.installed_versions || []).filter(v => variantVersionSet.has(v.version));
      const { orderedInstalledVersions, latestInstalledVersion } = resolveVersionOrder(
        variantVersions, variantInstalled
      );
      setEngineInfo(buildVariantEngineInfo(res, model));
      setEngines(orderedInstalledVersions);
      setLatestEngineVersion(latestInstalledVersion);
      setEngineInstalled(variantInstalled.length > 0);

      // 检测引擎更新
      if (variantVersions.length > 0 && variantInstalled.length > 0) {
        const sorted = [...variantVersions].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
        const latest = sorted[0].version;
        setLatestAvailableVersion(latest);
        setEngineUpdateAvailable(latest !== latestInstalledVersion);
      }

      // 获取运行时选项
      const matchedVariant = (res.variants || []).find(v =>
        modelVariant ? normalizeEngineType(v.id) === normalizeEngineType(modelVariant) : true
      );
      const runtimes = matchedVariant?.runtimes || [];
      setAvailableRuntimes(runtimes);
      if (runtimes.length > 0 && !selectedRuntime) {
        setSelectedRuntime(runtimes[0].id);
      }
    } catch {
      setEngineInfo(null); setEngines([]); setEngineInstalled(false);
    }
  }, [model]);

  useEffect(() => {
    if (!visible || !model) return;
    refreshEngineStatus();
    ttsStudioService.getTtsConfig().then(c => setIdleTimeout(c.idle_timeout_minutes ?? 5)).catch(() => {});
    // 加载 runtime_config（按 model variant 过滤）
    ttsStudioService.getEngineContracts().then(contracts => {
      const mv = resolveModelVariant(model, contracts);
      const match = contracts.find(c => normalizeEngineType(c.engine_type) === normalizeEngineType(mv)) || contracts[0];
      const ct = match?.contract;
      const rc = ct?.runtime_config || {};
      const items = Object.entries(rc).map(([key, def]) => ({ key, ...def }));
      setRuntimeItems(items);
      const et = match?.engine_type;
      if (et) runtimeEngineTypeRef.current = et;
      if (items.length > 0 && et) {
        ttsStudioService.getEngineRuntimeConfig(et).then(vals => {
          const merged = {};
          items.forEach(it => { merged[it.key] = vals[it.key] ?? it.default; });
          setRuntimeValues(merged);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [visible, refreshEngineStatus]);

  const handleIdleTimeoutChange = async (val) => {
    setIdleTimeout(val);
    try { await ttsStudioService.setTtsConfig({ idle_timeout_minutes: val }); } catch {}
  };

  const handleDelete = async () => {
    if (!model?.id) return;
    try {
      await modelService.delete(model.id);
      message.success('TTS 卡片已删除');
      onClose();
      onDelete?.();
      onSave?.();
    } catch (error) { message.error(error.response?.data?.error || error.message || '删除失败'); }
  };

  return (
    <>
      <Drawer
        title={`${model?.name || 'TTS'} 配置`}
        placement="right" width={480} open={visible} onClose={onClose}
        extra={
          <Popconfirm title="删除卡片" description="将删除此卡片配置，此操作不可撤销。"
            okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={handleDelete}>
            <Button danger icon={<DeleteOutlined />} size="small">删除卡片</Button>
          </Popconfirm>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 引擎版本 */}
          <div>
            <Text strong>引擎版本</Text>
            {!engineInstalled ? (
              <Alert type="warning" showIcon message="未检测到已安装的 TTS 引擎" style={{ marginTop: 8 }}
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

          {/* 运行时环境选择 */}
          {engineInstalled && availableRuntimes.length > 0 && (
            <div>
              <Text strong>运行时环境</Text>
              <Select
                value={selectedRuntime}
                onChange={setSelectedRuntime}
                style={{ width: '100%', marginTop: 4 }}
              >
                {availableRuntimes.map(rt => (
                  <Select.Option key={rt.id} value={rt.id}>
                    {rt.name}{rt.description ? ` — ${rt.description}` : ''}
                  </Select.Option>
                ))}
              </Select>
              <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                如需切换运行时，请重新安装引擎
              </div>
            </div>
          )}

          {/* 运行时配置 */}
          {runtimeItems.length > 0 && (
            <div>
              <Text strong>运行时配置</Text>
              {runtimeItems.map(item => (
                <div key={item.key} style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                    {item.label}{item.description && <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>{item.description}</Text>}
                  </div>
                  <Slider min={item.min} max={item.max} step={item.step}
                    value={runtimeValues[item.key] ?? item.default}
                    onChange={val => setRuntimeValues(prev => ({ ...prev, [item.key]: val }))}
                    onAfterChange={val => {
                      const et = runtimeEngineTypeRef.current;
                      if (et) ttsStudioService.setEngineRuntimeConfig(et, item.key, val).catch(() => {});
                    }}
                    marks={{ [item.min]: item.min, [item.default]: item.default, [item.max]: item.max }} />
                </div>
              ))}
            </div>
          )}

          {/* 闲置自动关闭 */}
          <div>
            <Text strong>闲置自动关闭</Text>
            <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>引擎收到外部请求时会自动启动，此设置不影响外部调用。</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span>闲置</span>
              <InputNumber min={3} max={30} step={1} value={idleTimeout} onChange={handleIdleTimeoutChange} style={{ width: 72 }} />
              <span>分钟后自动关闭以节约资源</span>
            </div>
          </div>

          <Button icon={<FolderOpenOutlined />} onClick={async () => {
            try { await backendService.openLogsFolder(); message.success('已打开日志文件夹'); }
            catch { message.error('打开失败'); }
          }} block>打开日志文件夹</Button>
        </Space>
      </Drawer>

      <EngineDownloadModal visible={showEngineModal} engineId="tts" engineInfo={engineInfo}
        onComplete={async () => { setShowEngineModal(false); await refreshEngineStatus(); message.success('TTS 引擎安装完成'); }}
        onCancel={() => setShowEngineModal(false)} />
    </>
  );
}

function buildVariantEngineInfo(raw, model) {
  if (!raw || !Array.isArray(raw.variants)) return raw;
  const mv = resolveModelVariant(model, raw.variants);
  const mvNorm = normalizeEngineType(mv);
  const matched = raw.variants.filter(v => normalizeEngineType(v.id) === mvNorm);
  if (matched.length === 0) return raw;
  return { ...raw, variants: matched };
}

export default TtsSettingsDrawer;
