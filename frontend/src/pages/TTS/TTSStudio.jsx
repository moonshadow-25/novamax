import React, { useState, useEffect, useCallback } from 'react';
import { Button, Space, Typography, message, Spin, Modal, Form, Input, Select, Empty, Collapse } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import WorkspaceCard from '../../components/WorkspaceCard/WorkspaceCard';
import ModelCard from '../../components/ModelCard/ModelCard';
import DynamicParamPanel from '../../components/DynamicParamPanel';
import { ttsStudioService, modelService, engineService } from '../../services/api';
import { normalizeEngineType } from '../../utils/engineType';
import FfmpegRequiredModal from '../../components/FfmpegRequiredModal/FfmpegRequiredModal';
import './TTS.css';

const { Title } = Typography;

function TTSStudio() {
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState(null);
  const [createForm] = Form.useForm();
  const [cloneForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [ffmpegModalOpen, setFfmpegModalOpen] = useState(false);
  const [contracts, setContracts] = useState([]);
  const [createEngineParams, setCreateEngineParams] = useState([]);
  const [createParamValues, setCreateParamValues] = useState({});

  const loadModels = useCallback(async () => {
    try { const data = await modelService.getByType('tts'); setModels(data.models || []); }
    catch { setModels([]); }
    finally { setModelsLoading(false); }
  }, []);

  const loadContracts = useCallback(async () => {
    try { const c = await ttsStudioService.getEngineContracts(); setContracts(c || []); } catch { setContracts([]); }
  }, []);

  const loadWorkspaces = useCallback(async () => {
    try { const d = await ttsStudioService.getWorkspaces(); setWorkspaces(Array.isArray(d) ? d : []); }
    catch { setWorkspaces([]); }
    finally { setWorkspacesLoading(false); }
  }, []);

  useEffect(() => { loadModels(); loadContracts(); loadWorkspaces(); const t = setInterval(loadWorkspaces, 10000); return () => clearInterval(t); }, []);
  useEffect(() => { engineService.getAll().then(engines => { if (!engines?.ffmpeg?.installed) setFfmpegModalOpen(true); }).catch(() => {}); }, []);

  // 引擎选择变化时加载对应合约参数
  const handleEngineChange = useCallback((engineVal) => {
    if (!engineVal) { setCreateEngineParams([]); setCreateParamValues({}); return; }
    const norm = normalizeEngineType(engineVal);
    const match = contracts.find(c => normalizeEngineType(c.engine_type) === norm);
    const defs = match?.contract?.parameters || [];
    const flat = Array.isArray(defs) ? defs : (defs.flat || []);
    setCreateEngineParams(flat);
    // 用合约默认值初始化
    const defaults = {};
    flat.forEach(d => { if (d.default !== undefined) defaults[d.key] = d.default; });
    setCreateParamValues(defaults);
  }, [contracts]);

  const handleCreate = useCallback(async (values) => {
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', values.name);
      fd.append('engine_type', values.engine_type);
      if (createEngineParams.length > 0) {
        fd.append('params', JSON.stringify(createParamValues));
      }
      await ttsStudioService.createWorkspace(fd);
      message.success('工作区创建成功'); setCreateOpen(false); createForm.resetFields();
      setCreateEngineParams([]); setCreateParamValues({}); loadWorkspaces();
    } catch (e) { message.error(e?.response?.data?.error || e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  }, [createForm, loadWorkspaces, createEngineParams, createParamValues]);

  const openCloneModal = useCallback((ws) => { setCloneSource(ws); cloneForm.setFieldsValue({ name: ws.name + '(副本)', engine_type: ws.engine_type }); setCloneOpen(true); }, [cloneForm]);
  const openCreateModal = useCallback(() => { createForm.resetFields(); setCreateEngineParams([]); setCreateParamValues({}); setCreateOpen(true); }, [createForm]);

  const handleClone = useCallback(async (values) => {
    setSubmitting(true);
    try { await ttsStudioService.cloneWorkspace(cloneSource.id, values); message.success('克隆成功'); setCloneOpen(false); cloneForm.resetFields(); loadWorkspaces(); }
    catch (e) { message.error('克隆失败: ' + (e.message || '未知错误')); }
    finally { setSubmitting(false); }
  }, [cloneSource, cloneForm, loadWorkspaces]);

  const handleDeleteWorkspace = useCallback(async (ws) => { await ttsStudioService.deleteWorkspace(ws.id); message.success('已删除'); loadWorkspaces(); }, [loadWorkspaces]);
  const handleOpenWorkspace = useCallback((ws) => { window.open('/tts/workspace/' + ws.id, '_blank'); }, []);

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div style={{ padding: '16px 24px' }}>
        {/* 工作区 */}
        <div style={{ marginBottom: 24 }}>
          {workspacesLoading ? <Spin /> : (
            <div className="model-grid">
              {workspaces.map(ws => (
                <WorkspaceCard key={ws.id} workspace={ws} onOpen={handleOpenWorkspace} onClone={openCloneModal} onDelete={handleDeleteWorkspace} />
              ))}
              <div className="add-model-card" onClick={openCreateModal}>
                <div className="add-model-content">
                  <div className="add-icon">+</div>
                  <div>新建工作区</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 引擎管理 */}
        <div style={{ marginBottom: 24 }}>
          <Title level={5} style={{ margin: 0, marginBottom: 12 }}>引擎管理</Title>
          {modelsLoading ? <Spin /> : models.length === 0 ? <Empty description="暂无 TTS 模型" /> : (
            <div className="model-grid">
              {models.map(model => (
                <ModelCard key={model.id} model={model} onUpdate={loadModels} isFavorited={false} onToggleFavorite={() => {}} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal title="新建工作区" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={submitting} width={620} destroyOnClose>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="工作区名称" /></Form.Item>
          <Form.Item name="engine_type" label="引擎" rules={[{ required: true }]}>
            <Select
              options={models.map(m => ({ value: m.engine_type || m.engine_version || m.id, label: m.name }))}
              placeholder="选择引擎"
              onChange={handleEngineChange}
            />
          </Form.Item>
          {createEngineParams.length > 0 && (
            <Form.Item label="引擎参数">
              <DynamicParamPanel
                definitions={createEngineParams}
                values={createParamValues}
                onChange={setCreateParamValues}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title={'克隆: ' + (cloneSource?.name || '')} open={cloneOpen} onCancel={() => setCloneOpen(false)} onOk={() => cloneForm.submit()} confirmLoading={submitting} width={400} destroyOnClose>
        <Form form={cloneForm} layout="vertical" onFinish={handleClone}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="engine_type" label="引擎"><Select options={models.map(m => ({ value: m.engine_type || m.engine_version || m.id, label: m.name }))} /></Form.Item>
        </Form>
      </Modal>

      <FfmpegRequiredModal
        open={ffmpegModalOpen}
        onClose={() => setFfmpegModalOpen(false)}
        onInstall={async () => {
          try {
            const engines = await engineService.getAll();
            const ffmpeg = engines?.ffmpeg;
            const versions = (ffmpeg?.versions || []).map(v => v.version).sort((a, b) => b.localeCompare(a));
            const latest = versions[0];
            if (!latest) throw new Error('no version');
            await engineService.download('ffmpeg', latest);
            message.success('已开始下载 FFmpeg ' + latest);
          } catch { message.error('下载失败'); }
          setFfmpegModalOpen(false);
        }}
      />
    </div>
  );
}

export default TTSStudio;
