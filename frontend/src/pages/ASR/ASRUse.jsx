import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Select, Input, Card, message, Upload, Tag, Table, Typography, Switch, Space, Badge, Empty, Modal } from 'antd';
import { SoundOutlined, CopyOutlined, DeleteOutlined, InboxOutlined, ArrowLeftOutlined, FolderOpenOutlined, ClearOutlined } from '@ant-design/icons';
import { asrService, modelService, asrStudioService } from '../../services/api';
import './ASRUse.css';

const { TextArea } = Input; const { Text } = Typography; const { Dragger } = Upload;
const AUDIO_ACCEPT = '.mp3,.wav,.flac,.m4a,.ogg,.webm,.mp4,.mpeg,.mpga';
const ALL_LANGUAGES = [{ value: 'auto', label: '自动检测' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }, { value: 'ko', label: '한국어' }];
const ALL_FORMATS = [{ value: 'json', label: 'JSON' }, { value: 'text', label: '纯文本 (.txt)' }, { value: 'srt', label: 'SRT 字幕' }, { value: 'vtt', label: 'WebVTT 字幕' }, { value: 'verbose_json', label: 'Verbose JSON' }];
const FILE_STATUS_MAP = { completed: { color: 'success', text: '已完成' }, transcribing: { color: 'processing', text: '转录中' }, waiting: { color: 'warning', text: '等待中' }, pending: { color: 'default', text: '待处理' } };
const ls = (k, d) => { try { const v = localStorage.getItem(k); return v !== null ? v : d; } catch { return d; } };

export default function ASRUse() {
  const navigate = useNavigate();
  const [models, setModels] = useState([]); const [selectedModelId, setSelectedModelId] = useState('');
  const [language, setLanguage] = useState(ls('asr_lang', 'auto'));
  const [outputFormat, setOutputFormat] = useState(ls('asr_fmt', 'json'));
  const [outputMode, setOutputMode] = useState(ls('asr_mode', 'inline'));
  const [prompt, setPrompt] = useState(''); const [streaming, setStreaming] = useState(ls('asr_stream', 'true') !== 'false');
  const [transcribing, setTranscribing] = useState(false); const [resultText, setResultText] = useState('');
  const [files, setFiles] = useState([]); const [history, setHistory] = useState([]);
  const [outputDir, setOutputDir] = useState(ls('asr_odir', ''));
  const [taskQueue, setTaskQueue] = useState([]); const queueIdRef = useRef(0); const abortRef = useRef(null);
  const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId), [models, selectedModelId]);

  useEffect(() => { localStorage.setItem('asr_fmt', outputFormat); }, [outputFormat]);
  useEffect(() => { localStorage.setItem('asr_mode', outputMode); }, [outputMode]);
  useEffect(() => { localStorage.setItem('asr_lang', language); }, [language]);
  useEffect(() => { localStorage.setItem('asr_stream', streaming); }, [streaming]);
  useEffect(() => { if (outputDir) localStorage.setItem('asr_odir', outputDir); }, [outputDir]);

  useEffect(() => { modelService.getByType('asr').then(data => { const arr = Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : []; setModels(arr); if (arr.length && !selectedModelId) setSelectedModelId(arr[0].id); }).catch(() => {}); }, []);
  const loadData = useCallback(() => { asrStudioService.getFiles().then(setFiles).catch(() => {}); asrStudioService.getHistory({ page_size: 50 }).then(r => setHistory(r.items || [])).catch(() => {}); asrStudioService.getOutputDir().then(r => setOutputDir(r.output_dir || '')).catch(() => {}); }, []);
  useEffect(() => { loadData(); const t = setInterval(loadData, 3000); return () => clearInterval(t); }, [loadData]);
  useEffect(() => { if (!selectedModelId) return; asrService.getCapabilities(selectedModelId).then(d => { if (d?.supported_languages?.length) setCapabilities(d); else setCapabilities({ supported_languages: ALL_LANGUAGES.map(l => l.value), output_formats: ['json'] }); }).catch(() => setCapabilities({ supported_languages: ALL_LANGUAGES.map(l => l.value), output_formats: ['json'] })); }, [selectedModelId]);
  const [capabilities, setCapabilities] = useState(null);
  const availableLanguages = useMemo(() => { const s = capabilities?.supported_languages || ALL_LANGUAGES.map(l => l.value); return ALL_LANGUAGES.filter(l => s.includes(l.value)); }, [capabilities]);
  const availableFormats = useMemo(() => { const s = capabilities?.output_formats || ['json']; return ALL_FORMATS.filter(f => s.includes(f.value)); }, [capabilities]);
  const supportsStreaming = capabilities?.supports_streaming || false;

  const enqueueTask = useCallback((name) => { const id = ++queueIdRef.current; setTaskQueue(p => [...p, { id, text: name, status: 'waiting' }]); return id; }, []);
  const updateTask = useCallback((id, u) => setTaskQueue(p => p.map(t => t.id === id ? { ...t, ...u } : t)), []);
  const removeTask = useCallback((id) => { setTimeout(() => setTaskQueue(p => p.filter(t => t.id !== id)), 3000); }, []);

  const callTranscribeApi = async (audioFileObj, originalName, sourceType) => {
    const taskId = enqueueTask(originalName); let text = '';
    try {
      updateTask(taskId, { status: 'running' });
      const fd = new FormData(); fd.append('file', audioFileObj); fd.append('model', selectedModel?.name || '');
      if (language !== 'auto') fd.append('language', language);
      fd.append('response_format', outputFormat); fd.append('output_mode', outputMode);
      if (prompt) fd.append('prompt', prompt); if (streaming && supportsStreaming) fd.append('stream', 'true');
      const ctrl = new AbortController(); abortRef.current = ctrl;
      const res = await fetch('/v1/audio/transcriptions', { method: 'POST', body: fd, signal: ctrl.signal,
        headers: { Authorization: `Bearer novamax-${sourceType}`, Accept: (streaming && supportsStreaming) ? 'text/event-stream' : '*/*' } });
      if (!res.ok) { const errText = await res.text().catch(() => ''); let errMsg = `HTTP ${res.status}`; try { const e = JSON.parse(errText); errMsg = e.error?.message || errMsg; } catch {} throw new Error(errMsg); }
      if (supportsStreaming && streaming && res.headers.get('Content-Type')?.includes('text/event-stream')) {
        const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = '';
        while (true) { const { done, value } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true });
          for (const line of buf.split('\n')) { if (line.startsWith('data: ') && line.slice(6).trim() !== '[DONE]') { try { const p = JSON.parse(line.slice(6)); if (p.text) { text = p.text; setResultText(text); } } catch {} } }
          buf = buf.split('\n').pop() || ''; }
      } else { const ct = res.headers.get('Content-Type') || ''; if (ct.includes('text/plain')) { text = await res.text(); } else { const data = await res.json().catch(() => ({})); text = data.text || data.error?.message || ''; } }
      setResultText(text); updateTask(taskId, { status: 'done' }); message.success('转录完成');
    } catch (e) { if (e.name !== 'AbortError') message.error(e.message || '转录失败'); updateTask(taskId, { status: 'error', error: e.message }); throw e; }
    finally { removeTask(taskId); abortRef.current = null; loadData(); }
    return text;
  };

  const handleUpload = async (file) => { const fd = new FormData(); fd.append('files', file); await asrStudioService.uploadFiles(fd); loadData(); return false; };
  const handleFileTranscribe = async (file) => { setTranscribing(true); try { await asrStudioService.updateFileStatus(file.filename, 'transcribing'); const res = await fetch(asrStudioService.getFilePlayUrl(file.filename)); const blob = await res.blob(); const f = new File([blob], file.original_name, { type: blob.type }); await callTranscribeApi(f, file.original_name, 'file'); await asrStudioService.updateFileStatus(file.filename, 'completed'); } catch {} finally { setTranscribing(false); loadData(); } };
  const handleBatchTranscribe = async () => { const pending = files.filter(f => f.status !== 'completed'); if (!pending.length) { message.info('无待处理文件'); return; } for (const f of pending) await asrStudioService.updateFileStatus(f.filename, 'waiting'); for (const f of pending) { try { await handleFileTranscribe(f); } catch {} } loadData(); };
  const handleDirectUpload = async (f) => { setTranscribing(true); try { await callTranscribeApi(f, f.name, 'manual'); } finally { setTranscribing(false); loadData(); } return false; };
  const showResult = (item) => { Modal.info({ title: item.original_filename || '转录结果', width: 700, content: <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>{item.result_text || ''}</pre>, okText: '关闭' }); };

  const fileCols = [
    { title: '', dataIndex: 'status', width: 32, render: (s) => <Badge status={s === 'completed' ? 'success' : s === 'transcribing' ? 'processing' : 'default'} /> },
    { title: '文件名', dataIndex: 'original_name', ellipsis: true },
    { title: '大小', dataIndex: 'size', width: 90, render: (s) => s ? `${(s / 1024 / 1024).toFixed(1)} MB` : '-' },
    { title: '', width: 140, render: (_, r) => (<Space size={4}><Button size="small" type="link" icon={<SoundOutlined />} onClick={() => handleFileTranscribe(r)} disabled={r.status === 'completed' || r.status === 'transcribing'}>转录</Button><Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={async () => { await asrStudioService.deleteFiles([r.filename]); loadData(); }} /></Space>) },
  ];
  const histCols = [
    { title: '文件名', dataIndex: 'original_filename', ellipsis: true, width: 100 },
    { title: '结果预览', dataIndex: 'result_text', ellipsis: true, render: (t) => t?.slice(0, 40) || '' },
    { title: '来源', dataIndex: 'source_type', width: 56, render: (s) => <Tag color={s === 'manual' ? 'blue' : s === 'file' ? 'green' : 'orange'}>{s === 'manual' ? '手动' : s === 'file' ? '文件' : '外部'}</Tag> },
    { title: '时间', dataIndex: 'created_at', width: 110, render: (t) => t?.slice(0, 16) || '' },
    { title: '', width: 80, render: (_, r) => (<Space size={4}><Button size="small" type="link" onClick={() => showResult(r)}>查看</Button><Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={async () => { await asrStudioService.deleteHistoryItem(r.id); loadData(); }} /></Space>) },
  ];

  return (
    <div className="asr-use-page">
      <div className="asr-use-header"><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回</Button><h2>ASR 语音识别</h2></div>
      <div className="asr-use-content">
        <div className="asr-use-config">
          <Card size="small" title="模型选择">
            <Select style={{ width: '100%' }} value={selectedModelId} onChange={setSelectedModelId}>
              {models.map(m => <Select.Option key={m.id} value={m.id}>{m.name} {m.asr_config?.is_default || m.whisper_config?.is_default ? '(默认)' : ''}</Select.Option>)}
            </Select>
          </Card>
          <Card size="small" title="直接转录">
            <Dragger accept={AUDIO_ACCEPT} showUploadList={false} beforeUpload={handleDirectUpload}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">拖拽音频文件直接转录</p>
            </Dragger>
            <div className="asr-param"><label>源语言</label><Select style={{ width: '100%' }} value={language} onChange={setLanguage}>{availableLanguages.map(l => <Select.Option key={l.value} value={l.value}>{l.label}</Select.Option>)}</Select></div>
            <div className="asr-param"><label>输出模式</label><Select style={{ width: '100%' }} value={outputMode} onChange={setOutputMode}><Select.Option value="inline">直接响应</Select.Option><Select.Option value="file">输出到文件</Select.Option></Select></div>
            <div className="asr-param"><label>输出格式</label><Select style={{ width: '100%' }} value={outputFormat} onChange={setOutputFormat}>{availableFormats.map(f => <Select.Option key={f.value} value={f.value}>{f.label}</Select.Option>)}</Select></div>
            <div className="asr-param"><label>引导文本</label><TextArea rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="可选" /></div>
            {supportsStreaming && <div className="asr-param"><Switch size="small" checked={streaming} onChange={setStreaming} /> <span style={{ marginLeft: 8 }}>流式输出</span></div>}
            <Space style={{ marginTop: 8 }}>{transcribing && <Text type="secondary">转录中...</Text>}{transcribing && <Button size="small" danger onClick={() => abortRef.current?.abort()}>取消</Button>}</Space>
            <Card size="small" title="转录结果" style={{ marginTop: 12 }}>{resultText ? <pre className="asr-result-text">{resultText}</pre> : <Empty description="拖拽音频开始转录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}</Card>
          </Card>
          <Card size="small" title={`请求队列 (${taskQueue.length})`} style={{ marginTop: 12 }}>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {taskQueue.map(t => (<div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 12 }}><Badge status={t.status === 'done' ? 'success' : t.status === 'running' ? 'processing' : t.status === 'error' ? 'error' : 'warning'} /><Text ellipsis style={{ flex: 1 }}>{t.text}</Text><Tag color={t.status === 'done' ? 'success' : t.status === 'running' ? 'processing' : t.status === 'error' ? 'error' : 'warning'} style={{ fontSize: 10 }}>{t.status === 'waiting' ? '等待' : t.status === 'running' ? '运行' : t.status === 'done' ? '完成' : '错误'}</Tag></div>))}
              {taskQueue.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>无任务</Text>}
            </div>
          </Card>
        </div>
        <div className="asr-use-result">
          <Card size="small" title="音频文件管理" extra={<Space><Button size="small" onClick={handleBatchTranscribe} disabled={files.filter(f => f.status !== 'completed').length === 0}>批量转录</Button><Button size="small" icon={<ClearOutlined />} onClick={async () => { await asrStudioService.deleteCompletedFiles(); loadData(); }}>清除已完成</Button></Space>}>
            <Dragger accept={AUDIO_ACCEPT} showUploadList={false} multiple beforeUpload={handleUpload} style={{ marginBottom: 8 }}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">上传音频文件（支持批量）</p></Dragger>
            <Table columns={fileCols} dataSource={files} rowKey="filename" size="small" pagination={false} locale={{ emptyText: '暂无文件' }} />
          </Card>
          <Card size="small" title="转录历史" style={{ marginTop: 12 }}><Table columns={histCols} dataSource={history} rowKey="id" size="small" pagination={{ pageSize: 15, showSizeChanger: false }} locale={{ emptyText: '暂无记录' }} /></Card>
          <Card size="small" title="输出目录" style={{ marginTop: 12 }}><Space.Compact style={{ width: '100%' }}><Input value={outputDir} onChange={e => setOutputDir(e.target.value)} size="small" /><Button size="small" icon={<FolderOpenOutlined />} onClick={() => asrStudioService.openOutputDir(outputDir)} /><Button size="small" type="primary" onClick={async () => { await asrStudioService.setOutputDir(outputDir); message.success('已保存'); }}>保存</Button></Space.Compact></Card>
        </div>
      </div>
    </div>
  );
}
