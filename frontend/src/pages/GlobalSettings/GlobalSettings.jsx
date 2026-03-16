import React, { useState, useEffect } from 'react';
import { Layout, Menu, Card, Form, Input, Switch, Select, Button, Space, message, List, Tag, Progress, Drawer, Popconfirm, Typography, Alert, Table, Checkbox, Tooltip, Spin } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, DownloadOutlined, CheckCircleOutlined, SettingOutlined, AppstoreOutlined, SyncOutlined, DeleteOutlined, HistoryOutlined, ExportOutlined, CopyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { configService, updateService, engineService, modelService } from '../../services/api';
const { Header, Content, Sider } = Layout;
const { Option } = Select;
const { Text } = Typography;

/**
 * 全局设置页面
 * 包含：引擎管理、端口配置、更新设置
 */
const GlobalSettings = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState('engines');

  // 更新相关状态
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // 引擎相关状态
  const [engines, setEngines] = useState({});
  const [versionDrawerVisible, setVersionDrawerVisible] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState(null);

  // 从 engines.app 派生下载状态，天然支持刷新恢复
  const appDownloadState = engines['app']?.download_state || null;
  const downloading = appDownloadState?.status === 'downloading';
  const unpacking = appDownloadState?.status === 'unpacking';
  const downloadProgress = appDownloadState?.progress || 0;

  // 导出配置相关状态
  const [exportModels, setExportModels] = useState([]);
  const [exportFileVersion, setExportFileVersion] = useState('1.0');
  const [exportUpdatedAt, setExportUpdatedAt] = useState('');
  const [exportTypes, setExportTypes] = useState(['llm', 'comfyui']);
  const [exportVersionMap, setExportVersionMap] = useState({});
  const [exportJson, setExportJson] = useState('');

  useEffect(() => {
    loadSettings();
    loadEngines();
    loadExportModels();

    // SSE 监听下载进度
    const es = new EventSource('/api/events');
    es.addEventListener('download-progress', () => loadEngines());

    return () => es.close();
  }, []);

  // 有下载进行中时，每 2 秒轮询一次，防止 SSE 事件丢失
  useEffect(() => {
    const hasActiveDownload = Object.values(engines).some(
      e => e.download_state && ['downloading', 'unpacking', 'installing'].includes(e.download_state.status)
    );
    if (!hasActiveDownload) return;

    const timer = setInterval(() => loadEngines(), 2000);
    return () => clearInterval(timer);
  }, [engines]);

  // 监听 app 下载状态变化
  useEffect(() => {
    if (!appDownloadState) return;
    if (appDownloadState.status === 'completed') {
      setUpdateReady(true);
    } else if (appDownloadState.status === 'failed') {
      message.error(`下载失败: ${appDownloadState.error || '未知错误'}`);
    }
  }, [appDownloadState?.status]);

  const loadSettings = async () => {
    try {
      const updateResult = await configService.getUpdateSettings();
      const s = updateResult.updateSettings || {};
      form.setFieldsValue({
        auto_check: s.auto_check ?? true,
        channel: s.channel || 'stable',
        server_url: s.server_url || ''
      });
    } catch (error) {
      message.error('加载设置失败');
      console.error('Failed to load settings:', error);
    }
  };

  const loadEngines = async () => {
    try {
      const result = await engineService.getAll();
      setEngines(result);
    } catch (error) {
      message.error('加载引擎列表失败');
      console.error('Failed to load engines:', error);
    }
  };

  const loadExportModels = async () => {
    try {
      const result = await modelService.getAll();
      const models = (result.models || []).filter(m => m.type === 'llm' || m.type === 'comfyui');
      setExportModels(models);
      const now = new Date().toISOString().slice(0, 19) + 'Z';
      setExportUpdatedAt(now);
      const vmap = {};
      models.forEach(m => { vmap[m.id] = '1.0'; });
      setExportVersionMap(vmap);
    } catch (e) {
      console.error('Failed to load models for export:', e);
    }
  };

  const REMOTE_FIELDS = ['name', 'description', 'modelscope_id', 'quantizations',
    'required_models', 'workflow', 'parameter_mapping'];

  const buildExportJson = () => {
    const filtered = exportModels.filter(m => exportTypes.includes(m.type));
    const llm = filtered.filter(m => m.type === 'llm');
    const comfyui = filtered.filter(m => m.type === 'comfyui');

    const toExportModel = (m) => {
      const out = { id: m.id, version: exportVersionMap[m.id] || '1.0' };
      REMOTE_FIELDS.forEach(f => { if (m[f] !== undefined) out[f] = m[f]; });
      // 用户实际配置的参数 → 远端 default_parameters
      const params = m.user_parameters ?? m.parameters;
      if (params !== undefined) out.default_parameters = params;
      // 用户自定义参数映射
      if (m.user_parameter_mapping !== undefined) out.user_parameters = m.user_parameter_mapping;
      return out;
    };

    const result = {
      version: exportFileVersion || '1.0',
      updated_at: exportUpdatedAt,
      models: {}
    };
    if (exportTypes.includes('llm')) result.models.llm = llm.map(toExportModel);
    if (exportTypes.includes('comfyui')) result.models.comfyui = comfyui.map(toExportModel);

    const json = JSON.stringify(result, null, 2);
    setExportJson(json);
    return json;
  };

  const handleCopyExport = () => {
    const json = exportJson || buildExportJson();
    navigator.clipboard.writeText(json).then(() => message.success('已复制到剪贴板'));
  };

  const handleDownloadExport = () => {
    const json = exportJson || buildExportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'models.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      // 保存更新设置
      await configService.setUpdateSettings({
        auto_check: values.auto_check,
        channel: values.channel,
        server_url: values.server_url,
        last_check: null
      });

      message.success('设置已保存');
    } catch (error) {
      message.error('保存设置失败');
      console.error('Failed to save settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckUpdate = async () => {
    try {
      setChecking(true);
      const result = await updateService.check();
      setUpdateInfo(result);
      if (result.hasUpdate) {
        message.info(`发现新版本: ${result.latestVersion}`);
      } else {
        message.success(`已是最新版本 (${result.currentVersion})`);
      }
    } catch (error) {
      message.error('检查更新失败');
      console.error('Failed to check update:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!updateInfo?.engineId || !updateInfo?.version) return;
    try {
      await engineService.download(updateInfo.engineId, updateInfo.version);
      // 进度由 engines.app.download_state 驱动，SSE + 轮询已在 useEffect 中处理
    } catch (err) {
      message.error('启动下载失败');
    }
  };

  const handleApplyUpdate = async () => {
    try {
      await updateService.apply();
      setRestarting(true);
      const poll = setInterval(async () => {
        try {
          await fetch('/api/health');
          clearInterval(poll);
          window.location.reload();
        } catch {}
      }, 2000);
    } catch (err) {
      message.error('应用更新失败');
    }
  };

  const handleDownloadEngine = async (engineId) => {
    try {
      const engine = engines[engineId];
      const latestVersion = engine.versions[0].version;
      await engineService.download(engineId, latestVersion);
      // 下载已在后端启动，SSE 会触发 loadEngines 刷新状态
    } catch (error) {
      message.error('启动下载失败');
      console.error('Failed to start download:', error);
    }
  };

  const handleUninstall = async (engineId, version) => {
    try {
      await engineService.uninstall(engineId, version);
      message.success(`已卸载 ${version}`);
      await loadEngines();
      const updated = await engineService.getById(engineId);
      setSelectedEngine({ ...engines[engineId], ...updated });
    } catch (error) {
      message.error('卸载失败');
      console.error('Failed to uninstall:', error);
    }
  };

  const handleReinstall = async (engineId, version) => {
    try {
      const result = await engineService.reinstall(engineId, version);
      message.info(`正在重新安装 ${version}...`);
      // 复用下载进度轮询逻辑
      pollReinstallProgress(result.tasks, engineId);
    } catch (error) {
      message.error('重新安装失败');
      console.error('Failed to reinstall:', error);
    }
  };

  const pollReinstallProgress = (tasks, engineId) => {
    const interval = setInterval(async () => {
      try {
        const statuses = await Promise.all(
          tasks.map(t => engineService.getDownloadStatus(t.taskId))
        );
        const done = statuses.every(s => s.status === 'completed' || s.status === 'failed');
        if (done) {
          clearInterval(interval);
          const anyFailed = statuses.some(s => s.status === 'failed');
          if (anyFailed) {
            message.error('重新安装失败');
          } else {
            message.success('重新安装完成');
          }
          await loadEngines();
          const updated = await engineService.getById(engineId);
          setSelectedEngine({ ...engines[engineId], ...updated });
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 1500);
  };

  const openVersionDrawer = (engine) => {
    setSelectedEngine(engine);
    setVersionDrawerVisible(true);
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const renderEnginesContent = () => (
    <Card title="引擎管理" extra={<Button icon={<SyncOutlined />} onClick={loadEngines}>刷新</Button>}>
      <List
        dataSource={Object.values(engines).filter(e => e.category !== 'app')}
        renderItem={engine => {
          const downloadState = engine.download_state;
          const latestVersion = engine.versions?.[0];
          const isDownloading = downloadState && ['downloading', 'unpacking', 'installing'].includes(downloadState.status);

          return (
            <List.Item
              actions={[
                isDownloading ? (
                  <Progress
                    type="circle"
                    percent={downloadState.progress || 0}
                    width={40}
                    status={downloadState.status === 'failed' ? 'exception' : 'active'}
                  />
                ) : engine.installed ? (
                  <Space>
                    <Tag icon={<CheckCircleOutlined />} color="success">已安装</Tag>
                    <Button
                      icon={<HistoryOutlined />}
                      onClick={() => openVersionDrawer(engine)}
                    >
                      管理版本
                    </Button>
                  </Space>
                ) : (
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownloadEngine(engine.id)}
                  >
                    下载
                  </Button>
                )
              ]}
            >
              <List.Item.Meta
                title={<Space>
                  {engine.name}
                  {engine.default_version && <Tag color="blue">v{engine.default_version}</Tag>}
                </Space>}
                description={
                  <div>
                    <div>{engine.description}</div>
                    {latestVersion && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                        最新版本: {latestVersion.version} ({formatBytes(latestVersion.size)})
                      </div>
                    )}
                    {engine.dependencies?.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                        依赖: {engine.dependencies.join(', ')}
                      </div>
                    )}
                    {engine.installed_versions?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <Space size={4}>
                          {engine.installed_versions.map(v => (
                            <Tag key={v.version} color={v.is_default ? 'blue' : 'default'}>
                              {v.version}
                            </Tag>
                          ))}
                        </Space>
                      </div>
                    )}
                    {isDownloading && (
                      <div style={{ marginTop: 8 }}>
                        <Progress
                          percent={downloadState.progress || 0}
                          size="small"
                          status={downloadState.status === 'unpacking' ? 'active' : 'normal'}
                        />
                        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                          {downloadState.status === 'downloading' && '下载中...'}
                          {downloadState.status === 'unpacking' && '解压中...'}
                          {downloadState.status === 'installing' && '安装中...'}
                          {downloadState.speed > 0 && ` ${formatBytes(downloadState.speed)}/s`}
                        </div>
                      </div>
                    )}
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );

  const renderExportContent = () => {
    const visibleModels = exportModels.filter(m => exportTypes.includes(m.type));

    const columns = [
      {
        title: '模型名称',
        dataIndex: 'name',
        ellipsis: true,
        render: (name, record) => (
          <Tooltip title={record.id}>
            <span>{name}</span>
          </Tooltip>
        )
      },
      {
        title: '类型',
        dataIndex: 'type',
        width: 90,
        render: t => <Tag color={t === 'llm' ? 'blue' : 'purple'}>{t.toUpperCase()}</Tag>
      },
      {
        title: '版本号',
        width: 120,
        render: (_, record) => (
          <Input
            size="small"
            value={exportVersionMap[record.id] || '1.0'}
            onChange={e => {
              setExportVersionMap(prev => ({ ...prev, [record.id]: e.target.value }));
              setExportJson('');
            }}
            style={{ width: 100 }}
          />
        )
      }
    ];

    return (
      <Card title="导出配置" style={{ maxWidth: 900 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">

          {/* 基本信息 */}
          <Card size="small" title="导出信息">
            <Space wrap>
              <Form layout="inline">
                <Form.Item label="文件版本">
                  <Input
                    value={exportFileVersion}
                    onChange={e => { setExportFileVersion(e.target.value); setExportJson(''); }}
                    style={{ width: 100 }}
                    placeholder="1.0"
                  />
                </Form.Item>
                <Form.Item label="更新时间">
                  <Input
                    value={exportUpdatedAt}
                    onChange={e => { setExportUpdatedAt(e.target.value); setExportJson(''); }}
                    style={{ width: 200 }}
                  />
                </Form.Item>
                <Form.Item label="导出范围">
                  <Checkbox.Group
                    value={exportTypes}
                    onChange={v => { setExportTypes(v); setExportJson(''); }}
                    options={[
                      { label: 'LLM', value: 'llm' },
                      { label: 'ComfyUI', value: 'comfyui' }
                    ]}
                  />
                </Form.Item>
              </Form>
            </Space>
          </Card>

          {/* 模型版本号表格 */}
          <Card size="small" title={`模型列表（${visibleModels.length} 个）`}>
            <Table
              dataSource={visibleModels}
              columns={columns}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ y: 300 }}
            />
          </Card>

          {/* 操作按钮 */}
          <Space>
            <Button type="primary" icon={<ExportOutlined />} onClick={buildExportJson}>
              生成预览
            </Button>
            {exportJson && (
              <>
                <Button icon={<CopyOutlined />} onClick={handleCopyExport}>复制</Button>
                <Button icon={<DownloadOutlined />} onClick={handleDownloadExport}>下载 models.json</Button>
              </>
            )}
          </Space>

          {/* JSON 预览 */}
          {exportJson && (
            <Card size="small" title="预览">
              <textarea
                readOnly
                value={exportJson}
                style={{
                  width: '100%',
                  height: 360,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                  padding: 8,
                  resize: 'vertical',
                  background: '#fafafa'
                }}
              />
            </Card>
          )}
        </Space>
      </Card>
    );
  };

  const renderUpdateContent = () => (
    <Card title="更新设置">
      <Form form={form} layout="vertical">
        <Form.Item
          label="自动检查更新"
          name="auto_check"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          label="更新通道"
          name="channel"
          rules={[{ required: true }]}
        >
          <Select style={{ width: 200 }}>
            <Option value="stable">稳定版</Option>
            <Option value="beta">测试版</Option>
            <Option value="dev">开发版</Option>
          </Select>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button onClick={handleCheckUpdate} loading={checking}>
              检查更新
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
            >
              保存设置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {updateInfo && (
        <div style={{ marginTop: 16 }}>
          {updateInfo.hasUpdate ? (
            <Alert
              type="info"
              showIcon
              message={`发现新版本 ${updateInfo.latestVersion}`}
              description={
                <Space direction="vertical" style={{ width: '100%' }}>
                  {updateInfo.releaseNotes && <div>{updateInfo.releaseNotes}</div>}
                  {downloading && (
                    <Progress percent={downloadProgress} status="active" />
                  )}
                  {!updateReady && !downloading && (
                    <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadUpdate}>
                      下载更新
                    </Button>
                  )}
                  {updateReady && (
                    <Button type="primary" danger onClick={handleApplyUpdate}>
                      重启以应用更新
                    </Button>
                  )}
                </Space>
              }
            />
          ) : (
            <Alert type="success" showIcon message={`当前已是最新版本 (${updateInfo.currentVersion})`} />
          )}
        </div>
      )}
    </Card>
  );

  const renderContent = () => {
    switch (selectedMenu) {
      case 'engines': return renderEnginesContent();
      case 'export':  return renderExportContent();
      case 'update':  return renderUpdateContent();
      default:        return null;
    }
  };

  const renderVersionDrawer = () => (
    <Drawer
      title={`${selectedEngine?.name} - 版本管理`}
      placement="right"
      width={600}
      open={versionDrawerVisible}
      onClose={() => setVersionDrawerVisible(false)}
    >
      {selectedEngine && (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 已安装版本列表 */}
          <Card size="small" title="已安装版本">
            <Alert
              message="版本说明"
              description="默认使用最新安装的版本。如需使用特定版本，请在模型设置中配置。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <List
              dataSource={[
                ...(selectedEngine.installed_versions || []).map(v => ({ ...v, broken: false })),
                ...(selectedEngine.broken_versions || []).map(v => ({ ...v, broken: true }))
              ]}
              locale={{ emptyText: '暂无已安装版本' }}
              renderItem={(version, index) => (
                <List.Item
                  actions={[
                    version.broken ? (
                      <Tag color="error">安装不完整</Tag>
                    ) : index === 0 ? (
                      <Tag color="green">最新版本</Tag>
                    ) : null,
                    <Button
                      size="small"
                      icon={<SyncOutlined />}
                      onClick={() => handleReinstall(selectedEngine.id, version.version)}
                    >
                      重装
                    </Button>,
                    <Popconfirm
                      title="确认卸载"
                      description={`确定要卸载版本 ${version.version} 吗？`}
                      onConfirm={() => handleUninstall(selectedEngine.id, version.version)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button danger size="small" icon={<DeleteOutlined />}>卸载</Button>
                    </Popconfirm>
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    title={<Text strong>{version.version}</Text>}
                    description={
                      <Space direction="vertical" size={0}>
                        {version.installed_at && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            安装时间: {new Date(version.installed_at).toLocaleString('zh-CN')}
                          </Text>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          路径: {version.path}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 下载新版本 */}
          <Card size="small" title="可用版本">
            <List
              dataSource={selectedEngine.versions || []}
              renderItem={version => {
                const isInstalled = selectedEngine.installed_versions?.some(
                  v => v.version === version.version
                );
                return (
                  <List.Item
                    actions={[
                      isInstalled ? (
                        <Tag color="success">已安装</Tag>
                      ) : (
                        <Button
                          type="primary"
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => {
                            handleDownloadEngine(selectedEngine.id);
                            setVersionDrawerVisible(false);
                          }}
                        >
                          下载
                        </Button>
                      )
                    ]}
                  >
                    <List.Item.Meta
                      title={version.version}
                      description={`大小: ${formatBytes(version.size)}`}
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Space>
      )}
    </Drawer>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {(restarting || unpacking) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16
        }}>
          <Spin size="large" />
          <span style={{ color: '#fff', fontSize: 16 }}>
            {restarting ? '正在更新重启中，请稍候...' : '正在解压安装，即将重启...'}
          </span>
        </div>
      )}
      <Header style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid #f0f0f0'
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
          style={{ marginRight: 16 }}
        >
          返回
        </Button>
        <h2 style={{ margin: 0 }}>全局设置</h2>
      </Header>

      <Layout>
        <Sider width={200} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedMenu]}
            onClick={({ key }) => setSelectedMenu(key)}
            style={{ height: '100%', borderRight: 0 }}
            items={[
              { key: 'engines', icon: <AppstoreOutlined />, label: '引擎管理' },
              { key: 'export',  icon: <ExportOutlined />,   label: '导出配置' },
              { key: 'update',  icon: <SyncOutlined />,     label: '更新设置' }
            ]}
          />
        </Sider>

        <Content style={{ padding: 24, minHeight: 280 }}>
          {renderContent()}
        </Content>
      </Layout>

      {renderVersionDrawer()}
    </Layout>
  );
};

export default GlobalSettings;
