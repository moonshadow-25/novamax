/**
 * TTS 工作台 v5.0 — 仅通过 OpenAI API 生成，Voice 独立管理
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Layout, Button, Space, Typography, message, Spin, Card, Row, Col,
  Descriptions, Table, Tag, Upload, Input, Select, Popconfirm, Empty, Tooltip, Progress, List, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, FolderOpenOutlined, UploadOutlined, DeleteOutlined,
  SoundOutlined, PlayCircleOutlined, PauseCircleOutlined,
  DownloadOutlined, ThunderboltOutlined, FileTextOutlined, CheckCircleOutlined,
  AudioOutlined, StarOutlined, StarFilled, ClockCircleOutlined, LoadingOutlined, ClearOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { ttsService, ttsStudioService, engineService, systemService } from '../../services/api';
import VramBar from '../../components/VramBar/VramBar';
import FfmpegRequiredModal from '../../components/FfmpegRequiredModal/FfmpegRequiredModal';
import { ENGINE_STATUS_MAP } from '../../utils/engineStatus';
import axios from 'axios';
import './TTS.css';

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

/** 只读参数展示——仅显示标签+值，不可编辑 */
function ReadonlyParamPanel({ definitions, values }) {
  if (!definitions?.length) {
    if (!values || Object.keys(values).length === 0) return <Text type="secondary">无</Text>;
    return <Space wrap>{Object.entries(values).map(([k, v]) => <Tag key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : String(v)}</Tag>)}</Space>;
  }
  const labelMap = {};
  definitions.forEach(d => { labelMap[d.key] = d.label; });
  const entries = Object.entries(values || {}).filter(([k]) => k in labelMap);
  if (entries.length === 0) return <Text type="secondary">未设置</Text>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
      {entries.map(([k, v]) => (
        <span key={k} style={{ fontSize: 12 }}>
          <Text type="secondary">{labelMap[k] || k}:</Text>{' '}
          <Text strong>{typeof v === 'boolean' ? (v ? '开启' : '关闭') : String(v)}</Text>
        </span>
      ))}
    </div>
  );
}

function WorkbenchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const historyAudioRef = useRef(null);

  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [outputDir, setOutputDir] = useState('');
  const [textInput, setTextInput] = useState('');
  const [generatingFile, setGeneratingFile] = useState(null); // null | '__text__' | filename
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [history, setHistory] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [referenceAudios, setReferenceAudios] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState(null);
  const [refAudioPlayingId, setRefAudioPlayingId] = useState(null);
  const refAudioElRef = useRef(null);
  const [voiceMap, setVoiceMap] = useState({});
  const [taskQueue, setTaskQueue] = useState([]); // { id, text, status, error? }
  const queueIdRef = useRef(0);
  const [ffmpegModalOpen, setFfmpegModalOpen] = useState(false);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [paramDefinitions, setParamDefinitions] = useState([]);
  const [paramValues, setParamValues] = useState({});

  // 工作区 voice_mode 参数决定是否为 clone 模式（默认 clone）
  const isCloneMode = useMemo(() => {
    const mode = paramValues?.voice_mode;
    // 未设置或明确为 clone → clone 模式；design/auto → 非 clone 模式
    return !mode || mode === 'clone';
  }, [paramValues]);

  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const loadData = useCallback(async () => {
    try {
      const ws = await ttsStudioService.getWorkspace(id);
      setWorkspace(ws);
      setOutputDir(ws.output_dir || '');
      setParamValues(ws.params || {});
      const files = ws.files || [];
      const staleFiles = files.filter(f => f.status === 'generating' || f.status === 'waiting');
      for (const f of staleFiles) {
        await ttsStudioService.updateFileStatus(id, f.filename, 'pending');
      }
      if (staleFiles.length > 0) {
        setFiles(files.map(f => staleFiles.some(s => s.filename === f.filename) ? { ...f, status: 'pending' } : f));
      } else {
        setFiles(files);
      }
    } catch (e) { message.error('加载工作区失败'); navigate('/?tab=tts'); }
    finally { setLoading(false); }
    try {
      const info = await systemService.getInfo();
      setGpuInfo(info.hardware?.gpus?.[0] || null);
    } catch {}
  }, [id, navigate]);

  // 加载引擎合约参数定义（仅 TTS2）
  const loadParamDefs = useCallback(async () => {
    try {
      const r = await ttsStudioService.getWorkspaceParams(id);
      if (r?.definitions) setParamDefinitions(r.definitions);
      if (r?.current) setParamValues(r.current);
    } catch {}
  }, [id]);

  const loadHistory = useCallback(async () => {
    try { const data = await ttsService.getHistory(id); setHistory(data?.items || []); }
    catch { setHistory([]); }
  }, [id]);

  const loadVoices = useCallback(async () => {
    try {
      const res = await axios.get('/v1/audio/voices');
      const voices = res.data?.data || [];
      const map = {};
      voices.forEach(v => { map[v.voice_id] = v; });
      setVoiceMap(map);
    } catch {}
  }, []);

  const loadRefAudios = useCallback(async () => {
    try {
      const d = await ttsStudioService.getReferenceAudios({ page: 1, page_size: 100 });
      setReferenceAudios(d.items || []);
    } catch { setReferenceAudios([]); }
  }, []);

  // 加载 workspace 的 active_voice_id
  const loadActiveVoice = useCallback(() => {
    if (workspace?.active_voice_id) {
      setSelectedVoiceId(workspace.active_voice_id);
    }
  }, [workspace]);

  useEffect(() => {
    loadData().catch(() => {});
    loadParamDefs().catch(() => {});
    loadHistory(); loadRefAudios(); loadVoices();
    // 异步启动引擎（与模型卡片共用统一的引擎启动接口）
    (async () => {
      try {
        const ws = await ttsStudioService.getWorkspace(id);
        if (ws?.engine_type) {
          await ttsStudioService.startEngine(ws.engine_type);
          await loadData();
        }
      } catch {}
    })();
    const timer = setInterval(loadData, 10000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => { loadActiveVoice(); }, [workspace]);

  // 主动检测 ffmpeg
  useEffect(() => { engineService.getAll().then(engines => { if (!engines?.ffmpeg?.installed) setFfmpegModalOpen(true); }).catch(() => {}); }, []);

  // === Voice 激活 ===
  const handleActivateVoice = async (voiceId) => {
    try {
      await ttsStudioService.updateOutputDir(id, outputDir); // reuse: any PUT to workspace
      // Use a dedicated API call
      await axios.post(`/api/tts-studio/workspaces/${id}/activate-voice`, { voice_id: voiceId });
      setSelectedVoiceId(voiceId);
      message.success('已设为默认 Voice');
      loadData(); // refresh workspace
    } catch { message.error('激活失败'); }
  };

  // === 生成（带队列追踪） ===
  const enqueueTask = useCallback((text, sourceFile) => {
    const id = ++queueIdRef.current;
    const label = sourceFile || text.slice(0, 30);
    setTaskQueue(prev => [...prev, { id, text: label, status: 'waiting' }]);
    return id;
  }, []);

  const updateTask = useCallback((id, updates) => {
    setTaskQueue(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const removeTask = useCallback((id) => {
    setTaskQueue(prev => prev.filter(t => t.id !== id));
  }, []);

  const doGenerateOpenAI = useCallback(async (text, sourceFile = '', sourceType = 'manual') => {
    const taskId = enqueueTask(text, sourceFile);
    try {
      updateTask(taskId, { status: 'running' });
      const voiceId = selectedVoiceId || workspace?.active_voice_id;
      if (isCloneMode && !voiceId) throw new Error('请先选择一个 Voice');
      const apiKey = sourceType === 'file' ? 'novamax-file' : 'novamax-manual';
      await axios.post('/v1/audio/speech', {
        model: workspace.model_id, input: text, voice: isCloneMode ? voiceId : '',
        response_format: 'wav',
      }, {
        timeout: 0, responseType: 'blob',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(sourceFile ? { 'X-Source-File': sourceFile } : {}),
        },
      }).then(resp => {
        if (resp.headers['x-ffmpeg-missing'] === '1') setFfmpegModalOpen(true);
      });
      updateTask(taskId, { status: 'done' });
      setTimeout(() => removeTask(taskId), 3000);
    } catch (e) {
      updateTask(taskId, { status: 'error', error: e?.response?.data?.error?.message || e.message || '未知错误' });
      setTimeout(() => removeTask(taskId), 5000);
      throw e;
    }
  }, [workspace, selectedVoiceId, enqueueTask, updateTask, removeTask]);

  const handleGenerate = useCallback(async () => {
    if (!textInput.trim()) return message.warning('请输入文本');
    if (isCloneMode && !selectedVoiceId && !workspace?.active_voice_id) return message.warning('请先选择一个 Voice');
    setGeneratingFile('__text__');
    try { await doGenerateOpenAI(textInput, '', 'manual'); message.success('生成完成'); loadHistory(); }
    catch (e) {
      const msg = e?.response?.data?.error?.message || e.message || '未知错误';
      if (msg.includes('ffmpeg')) setFfmpegModalOpen(true);
      else message.error('生成失败: ' + msg);
    }
    finally { setGeneratingFile(null); }
  }, [textInput, doGenerateOpenAI, loadHistory, selectedVoiceId, workspace]);

  const handleFileGenerate = useCallback(async (file) => {
    try {
      const data = await ttsStudioService.getFileContent(id, file.filename);
      if (!data?.content?.trim()) return message.warning('文件内容为空');
      await ttsStudioService.updateFileStatus(id, file.filename, 'generating');
      setGeneratingFile(file.filename);
      setFiles(prev => prev.map(f => f.filename === file.filename ? { ...f, status: 'generating' } : f));
      await doGenerateOpenAI(data.content, file.original_name, 'file');
      await ttsStudioService.updateFileStatus(id, file.filename, 'completed');
      setFiles(prev => prev.map(f => f.filename === file.filename ? { ...f, status: 'completed' } : f));
      message.success(`"${file.original_name}" 生成完成`); loadHistory();
    } catch (e) {
      await ttsStudioService.updateFileStatus(id, file.filename, 'pending');
      setFiles(prev => prev.map(f => f.filename === file.filename ? { ...f, status: 'pending' } : f));
      const msg = e?.response?.data?.error?.message || e.message || '';
      if (msg.includes('ffmpeg')) setFfmpegModalOpen(true);
      else message.error('生成失败');
    }
    finally { setGeneratingFile(null); }
  }, [id, doGenerateOpenAI, loadHistory]);

  const handleBatchGenerate = useCallback(async () => {
    const pendingFiles = files.filter(f => f.status !== 'completed');
    if (pendingFiles.length === 0) return message.warning('没有待处理的文件');
    setBatchGenerating(true); setBatchProgress({ done: 0, total: pendingFiles.length });
    // 将所有待处理文件标记为等待中
    for (const f of pendingFiles) {
      await ttsStudioService.updateFileStatus(id, f.filename, 'waiting');
    }
    setFiles(prev => prev.map(f => pendingFiles.some(p => p.filename === f.filename) ? { ...f, status: 'waiting' } : f));
    let ok = 0, fail = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      const f = pendingFiles[i];
      try {
        await ttsStudioService.updateFileStatus(id, f.filename, 'generating');
        setFiles(prev => prev.map(x => x.filename === f.filename ? { ...x, status: 'generating' } : x));
        const data = await ttsStudioService.getFileContent(id, f.filename);
        if (data?.content?.trim()) {
          await doGenerateOpenAI(data.content, f.original_name, 'file');
          await ttsStudioService.updateFileStatus(id, f.filename, 'completed');
          setFiles(prev => prev.map(x => x.filename === f.filename ? { ...x, status: 'completed' } : x));
          ok++;
        } else { fail++; }
      } catch {
        await ttsStudioService.updateFileStatus(id, f.filename, 'pending');
        setFiles(prev => prev.map(x => x.filename === f.filename ? { ...x, status: 'pending' } : x));
        fail++;
      }
      setBatchProgress({ done: i + 1, total: pendingFiles.length });
    }
    setBatchGenerating(false); loadHistory();
    message.success(`批量完成: ${ok} 成功, ${fail} 失败`);
  }, [files, id, doGenerateOpenAI, loadHistory]);

  // === 参考音频 ===
  const handleRefAudioUpload = useCallback(async (file) => {
    const fd = new FormData(); fd.append('file', file);
    try {
      await ttsStudioService.uploadReferenceAudio(fd);
      message.success('上传完成'); loadRefAudios(); loadVoices();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || '';
      if (msg.includes('ffmpeg')) setFfmpegModalOpen(true);
      else message.error('上传失败: ' + msg);
    }
    return false;
  }, [loadRefAudios, loadVoices]);

  const playRefAudio = (audio) => {
    if (refAudioPlayingId === audio.id) { refAudioElRef.current?.pause(); setRefAudioPlayingId(null); return; }
    setRefAudioPlayingId(audio.id);
    if (refAudioElRef.current) { refAudioElRef.current.src = `/api/tts-studio/reference-audios/${audio.id}/file`; refAudioElRef.current.play().catch(() => setRefAudioPlayingId(null)); }
  };

  const handleDeleteRefAudio = async (audio) => { await ttsStudioService.deleteReferenceAudio(audio.id); message.success('已删除'); loadRefAudios(); };

  const handleUpload = useCallback(async (file) => {
    const fd = new FormData(); fd.append('files', file);
    await ttsStudioService.uploadWorkspaceFiles(id, fd); message.success('上传成功'); loadData(); return false;
  }, [id, loadData]);

  const handleDeleteFile = useCallback(async (fn) => { await ttsStudioService.deleteWorkspaceFiles(id, [fn]); message.success('已删除'); loadData(); }, [id, loadData]);
  const handleUpdateOutputDir = useCallback(async () => { await ttsStudioService.updateOutputDir(id, outputDir); message.success('已更新'); }, [id, outputDir]);
  const handleOpenDir = useCallback(async () => { try { await ttsStudioService.openOutputDir(id, outputDir); } catch { message.error('无法打开'); } }, [id, outputDir]);

  const playHistoryItem = (item) => {
    if (playingId === item.id) { historyAudioRef.current?.pause(); setPlayingId(null); return; }
    setPlayingId(item.id);
    const url = ttsService.getHistoryAudioUrl(item.id);
    if (historyAudioRef.current) { historyAudioRef.current.src = url; historyAudioRef.current.play().catch(() => setPlayingId(null)); }
  };
  const downloadHistoryItem = (item) => { const a = document.createElement('a'); a.href = ttsService.getHistoryAudioUrl(item.id); a.download = `${item.id}.${item.output_format || 'wav'}`; a.click(); };
  const deleteHistoryItem = async (item) => { try { await ttsService.deleteHistoryItem(item.id); loadHistory(); } catch { message.error('删除失败'); } };

  const clearCompletedFiles = useCallback(async () => {
    try {
      const res = await ttsStudioService.deleteCompletedFiles(id);
      message.success(`已清除 ${res.deleted || 0} 个已完成文件`);
      loadData();
    } catch { message.error('清除失败'); }
  }, [id, loadData]);

  if (loading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 120 }} />;
  if (!workspace) return null;

  const indicator = workspace.indicator || { status: 'idle', reason: '' };
  const ind = ENGINE_STATUS_MAP[indicator.status] || ENGINE_STATUS_MAP.idle;

  const FILE_STATUS_MAP = {
    completed:  { color: 'success', text: '已完成' },
    generating: { color: 'processing', text: '生成中' },
    waiting:    { color: 'warning', text: '等待中' },
    pending:    { color: 'default', text: '待处理' },
  };

  const fileColumns = [
    { title: '', width: 30, render: (_, r) => {
      const s = r.status || 'pending';
      if (s === 'completed') return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      if (s === 'generating') return <LoadingOutlined style={{ color: '#1890ff' }} />;
      if (s === 'waiting') return <ClockCircleOutlined style={{ color: '#fa8c16' }} />;
      return <FileTextOutlined style={{ color: '#d9d9d9' }} />;
    }},
    { title: '名称', dataIndex: 'original_name', ellipsis: true },
    { title: '字符数', width: 80, render: (_, r) => (r.char_count || 0) > 0 ? (r.char_count || 0).toLocaleString() : '-' },
    { title: '状态', width: 80, render: (_, r) => {
      const s = FILE_STATUS_MAP[r.status || 'pending'];
      return <Tag color={s.color}>{s.text}</Tag>;
    }},
    { title: '操作', width: 120, render: (_, r) => {
      const isGenerating = generatingFile === r.filename || r.status === 'generating' || r.status === 'waiting';
      return (
        <Space size="small">
          <Button type="link" size="small" icon={<ThunderboltOutlined />}
            onClick={() => handleFileGenerate(r)}
            loading={generatingFile === r.filename}
            disabled={r.status === 'completed' || isGenerating}>
            生成
          </Button>
          <Popconfirm title="删除？" onConfirm={() => handleDeleteFile(r.filename)}><Button type="link" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </Space>
      );}},
  ];

  const SOURCE_TYPE_MAP = {
    manual:   { color: 'blue', text: '手动输入' },
    file:     { color: 'green', text: '上传文件' },
    external: { color: 'orange', text: '外部调用' },
  };

  const historyColumns = [
    { title: '来源', dataIndex: 'source_type', width: 90, render: (v, r) => {
      const s = SOURCE_TYPE_MAP[v] || SOURCE_TYPE_MAP.manual;
      return <Tooltip title={r.source_file || ''}><Tag color={s.color}>{s.text}</Tag></Tooltip>;
    }},
    { title: '文本', dataIndex: 'text', ellipsis: true, width: 140, render: v => v?.slice(0, 30) || '...' },
    { title: 'Voice', dataIndex: 'voice_id', width: 90, ellipsis: true, render: v => v ? <Tooltip title={voiceMap[v]?.name || v}><Tag>{v}</Tag></Tooltip> : '-' },
    { title: '时长', dataIndex: 'duration_seconds', width: 55, render: v => v ? `${v.toFixed(1)}s` : '-' },
    { title: '时间', dataIndex: 'created_at', width: 120, render: v => v?.slice(0, 16) },
    { title: '操作', width: 130, render: (_, r) => (
        <Space size="small">
          <Tooltip title="播放"><Button type="text" size="small" icon={playingId === r.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={() => playHistoryItem(r)} /></Tooltip>
          <Tooltip title="下载"><Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => downloadHistoryItem(r)} /></Tooltip>
          {isLocal && r.output_file && <Tooltip title="播放器"><Button type="text" size="small" icon={<SoundOutlined />} onClick={async () => { try { await ttsStudioService.openFileInPlayer(r.output_file); } catch { message.error('打开失败'); } }} /></Tooltip>}
          <Popconfirm title="删除？" onConfirm={() => deleteHistoryItem(r)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </Space>
      )},
  ];

  return (
    <Layout className="tts-layout" style={{ minWidth: 0 }}>
      <Header className="tts-header" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 48, padding: '8px 16px' }}>
        <Space wrap><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/?tab=tts')} /><Title level={5} style={{ margin: 0 }}>{workspace.name}</Title></Space>
        <Space style={{ marginLeft: 'auto' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: ind.color, display: 'inline-block', boxShadow: indicator.status === 'running' ? `0 0 6px ${ind.color}` : 'none' }} />
          <Text style={{ color: ind.color, fontSize: 13 }}>{ind.text || indicator.reason}</Text>
          {gpuInfo && <VramBar gpu={gpuInfo} compact />}
        </Space>
      </Header>

      <audio ref={historyAudioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />

      <Content style={{ padding: 12, overflowY: 'auto' }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={14}>
            <Card size="small" title="工作区信息" style={{ marginBottom: 12 }}>
              <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                <Descriptions.Item label="Model ID">{workspace.model_id ? <Text copyable>{workspace.model_id}</Text> : '—'}</Descriptions.Item>
                <Descriptions.Item label="引擎">{workspace.engine_name || workspace.engine_type}</Descriptions.Item>
                <Descriptions.Item label="默认 Voice">{workspace.active_voice_id || '未设置'}</Descriptions.Item>
                <Descriptions.Item label="参数" span={2}>
                  <ReadonlyParamPanel definitions={paramDefinitions} values={paramValues} />
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {isCloneMode && (
            <Card size="small" title={<Space><AudioOutlined /><span>参考音频管理</span></Space>}
              extra={<Upload beforeUpload={handleRefAudioUpload} showUploadList={false} accept="audio/*"><Button size="small" icon={<UploadOutlined />}>上传</Button></Upload>}
              style={{ marginBottom: 12 }}>
              <audio ref={refAudioElRef} onEnded={() => setRefAudioPlayingId(null)} style={{ display: 'none' }} />
              {referenceAudios.length === 0 ? (
                <Empty description="暂无参考音频，上传后自动创建 Voice ID" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Table dataSource={referenceAudios} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small' }} scroll={{ x: 500 }}
                  columns={[
                    { title: '', width: 36, render: (_, r) => <Button type="text" size="small" icon={refAudioPlayingId === r.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={() => playRefAudio(r)} /> },
                    { title: '名称', dataIndex: 'name', ellipsis: true,
                      render: (v, r) => (
                        <Text editable={{ onChange: async (val) => {
                          try { await ttsStudioService.renameReferenceAudio(r.id, val); loadRefAudios(); message.success('已改名'); }
                          catch { message.error('改名失败'); }
                        }}} style={{ fontSize: 13 }}>{v}</Text>
                      )
                    },
                    { title: '格式', dataIndex: 'format', width: 50, render: v => <Tag>{v?.toUpperCase()}</Tag> },
                    { title: 'Voice ID', dataIndex: 'voice_id', width: 90, ellipsis: true, render: v => v ? <Text copyable style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>创建中...</Text> },
                    { title: '默认', width: 50, render: (_, r) => (
                        <Tooltip title={workspace.active_voice_id === r.voice_id ? '当前默认' : '设为默认'}>
                          <Button type="text" size="small"
                            icon={workspace.active_voice_id === r.voice_id ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                            onClick={() => r.voice_id && handleActivateVoice(r.voice_id)} /></Tooltip>
                      )},
                    { title: '', width: 36, render: (_, r) => <Popconfirm title="删除？" onConfirm={() => handleDeleteRefAudio(r)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm> },
                  ]} />
              )}
            </Card>
            )}

            {isLocal && (
            <Card size="small" title="📁 输出目录" style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: '100%' }}><Input value={outputDir} onChange={e => setOutputDir(e.target.value)} style={{ flex: 1 }} /><Button icon={<FolderOpenOutlined />} onClick={handleOpenDir}>打开</Button><Button type="primary" onClick={handleUpdateOutputDir}>保存</Button></Space.Compact>
            </Card>)}

            <Card size="small" title={<Space><FileTextOutlined /><span>上传文本文件</span></Space>}
              extra={
                <Space size="small">
                  <Upload beforeUpload={handleUpload} showUploadList={false} accept=".txt,.text" multiple><Button size="small" icon={<UploadOutlined />}>上传</Button></Upload>
                  {files.filter(f => f.status !== 'completed').length > 0 && <Tooltip title={`批量生成 ${files.filter(f => f.status !== 'completed').length} 个待处理文件`}><Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={handleBatchGenerate} loading={batchGenerating}>批量生成</Button></Tooltip>}
                  {files.some(f => f.status === 'completed') && <Popconfirm title="确定清除所有已完成文件？" onConfirm={clearCompletedFiles} okText="清除" cancelText="取消"><Button size="small" danger icon={<ClearOutlined />}>清除已完成</Button></Popconfirm>}
                </Space>}
              style={{ marginBottom: 12 }}>
              {batchGenerating && <Progress percent={Math.round((batchProgress.done / batchProgress.total) * 100)} size="small" style={{ marginBottom: 8 }} format={() => `${batchProgress.done}/${batchProgress.total}`} />}
              {files.length === 0 ? <Empty description="暂无文本文件" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <Table dataSource={files} columns={fileColumns} rowKey="filename" size="small" pagination={{ pageSize: 10, size: 'small' }} scroll={{ x: 400 }} />}
            </Card>

            <Card size="small" title="📋 生成历史" style={{ marginBottom: 12 }}>
              {history.length === 0 ? <Empty description="暂无记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <Table dataSource={history} columns={historyColumns} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small' }} scroll={{ x: 500 }} />}
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card size="small" title="✏ TTS 生成" extra={<Text type="secondary" style={{ fontSize: 12 }}>{textInput.length} 字符</Text>} style={{ marginBottom: 12 }}>
              <TextArea rows={5} value={textInput} onChange={e => setTextInput(e.target.value)} placeholder="输入要合成的文本..." style={{ marginBottom: 8 }} />
              {isCloneMode && (
              <Select value={selectedVoiceId} onChange={setSelectedVoiceId} placeholder="选择 Voice" size="small" style={{ width: '100%', marginBottom: 8 }}
                options={referenceAudios.map(a => ({ value: a.id, label: `${a.name} (${a.voice_id || a.id})` }))} allowClear />
              )}
              <Button type="primary" icon={<SoundOutlined />} loading={generatingFile === '__text__'} onClick={handleGenerate} block disabled={!textInput.trim()}>生成语音</Button>

              {taskQueue.length > 0 && (
                <div style={{ marginTop: 8, border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 12px', maxHeight: 180, overflow: 'auto' }}>
                  <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                    📋 任务队列 ({taskQueue.length})
                  </Text>
                  {taskQueue.map(t => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
                      <Badge status={t.status === 'running' ? 'processing' : t.status === 'done' ? 'success' : t.status === 'error' ? 'error' : 'default'} />
                      <Text ellipsis style={{ flex: 1, fontSize: 12, color: t.status === 'error' ? '#ff4d4f' : undefined }}>
                        {t.text}
                      </Text>
                      <Tag color={t.status === 'waiting' ? 'default' : t.status === 'running' ? 'processing' : t.status === 'done' ? 'success' : 'error'}
                        style={{ fontSize: 10, lineHeight: '16px' }}>
                        {t.status === 'waiting' ? '等待' : t.status === 'running' ? '生成中' : t.status === 'done' ? '完成' : '失败'}
                      </Tag>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      </Content>

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
          } catch { message.error('下载失败，请重试'); }
          setFfmpegModalOpen(false);
        }}
      />
    </Layout>
  );
}

export default WorkbenchPage;
