import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Button, Select, Space, Typography, message, Spin, Tooltip, Input, Collapse } from 'antd';
import {
  ArrowLeftOutlined, UploadOutlined, DeleteOutlined, SoundOutlined,
  DownloadOutlined, PauseCircleOutlined, CaretRightOutlined, ReloadOutlined,
  SettingOutlined, ClearOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ttsService } from '../../services/api';
import { normalizeEngineType } from '../../utils/engineType';
import DynamicParamPanel from '../../components/DynamicParamPanel';
import './TTS.css';

const { Header, Content } = Layout;
const { Title } = Typography;
const { TextArea } = Input;

function normalizeParams(params) {
  if (!params) return [];
  if (Array.isArray(params)) return params;           // v3.0
  if (params.flat && Array.isArray(params.flat)) return params.flat; // v4.0
  return [];
}

function TTS() {
  const navigate = useNavigate();
  const voiceAudioRef = useRef(null);
  const voiceInputRef = useRef(null);
  const historyAudioRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  // Voice — NovaMax 自有体系
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [previewingVoice, setPreviewingVoice] = useState(null);

  // 引擎选择
  const [engineTypes, setEngineTypes] = useState([]);
  const [selectedEngine, setSelectedEngine] = useState(null);

  // 文本
  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(false);

  // 动态参数
  const [paramDefinitions, setParamDefinitions] = useState([]);
  const [paramValues, setParamValues] = useState({});
  const [outputFormat, setOutputFormat] = useState('wav');

  const [history, setHistory] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  /* ── 检查服务连接 ── */
  useEffect(() => {
    const check = async () => {
      try { await ttsService.health(); setConnected(true); }
      catch { setConnected(false); }
      finally { setChecking(false); }
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  /* ── 加载引擎列表 ── */
  useEffect(() => {
    if (!connected) return;
    ttsService.getEngineContracts?.().then(data => {
      const contracts = data || [];
      setEngineTypes(contracts);
      if (contracts.length > 0 && !selectedEngine) {
        setSelectedEngine(contracts[0].engine_type);
      }
    }).catch(() => {});
  }, [connected]);

  /* ── 引擎切换时加载参数定义 ── */
  useEffect(() => {
    if (!selectedEngine) return;
    const contract = engineTypes.find(c => normalizeEngineType(c.engine_type) === normalizeEngineType(selectedEngine));
    const params = normalizeParams(contract?.contract?.parameters);
    if (params.length > 0) {
      setParamDefinitions(params);
      const defaults = {};
      params.forEach(p => { defaults[p.key] = p.default; });
      setParamValues(defaults);
    } else {
      setParamDefinitions([]);
      setParamValues({});
    }
  }, [selectedEngine, engineTypes]);

  /* ── 加载音色列表（NovaMax 自有） ── */
  const loadVoices = useCallback(async () => {
    if (!connected) { setVoices([]); return; }
    try {
      const data = await ttsService.getVoices();
      const list = data?.items || data?.data || [];
      setVoices(list);
      if (list.length > 0 && !selectedVoice) setSelectedVoice(list[0].id);
    } catch { setVoices([]); }
  }, [connected, selectedVoice]);

  useEffect(() => { loadVoices(); }, [connected]);

  /* ── 加载历史 ── */
  const loadHistory = useCallback(async () => {
    if (!connected) return;
    try {
      const data = await ttsService.getHistory();
      setHistory(data?.items || data?.data || []);
    } catch { setHistory([]); }
  }, [connected]);

  useEffect(() => { loadHistory(); }, [connected]);

  /* ── 预览音色 ── */
  const previewVoice = (voice) => {
    if (previewingVoice === voice.id) {
      voiceAudioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voice.id);
    const url = ttsService.getVoiceAudioUrl(voice.id);
    if (voiceAudioRef.current) {
      voiceAudioRef.current.src = url;
      voiceAudioRef.current.play().catch(() => setPreviewingVoice(null));
    }
  };

  /* ── 上传音色 ── */
  const handleUploadVoice = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    try {
      const fd = new FormData();
      fd.append('file', files[0]);
      await ttsService.createVoice(fd);
      message.success('音色上传成功');
      loadVoices();
    } catch { message.error('上传失败'); }
    e.target.value = '';
  };

  /* ── 删除音色 ── */
  const deleteVoice = async (voiceId) => {
    try {
      await ttsService.deleteVoice(voiceId);
      message.success('已删除');
      if (selectedVoice === voiceId) setSelectedVoice(null);
      loadVoices();
    } catch { message.error('删除失败'); }
  };

  /* ── 生成语音 ── */
  const handleGenerate = async () => {
    if (!text.trim()) return message.warning('请输入文本');
    if (!selectedVoice) return message.warning('请选择音色');
    setGenerating(true);
    try {
      await ttsService.speech({
        text: text.trim(),
        voice: selectedVoice,
        engine_type: selectedEngine,
        output_format: outputFormat,
        ...paramValues
      });
      message.success('生成完成');
      loadHistory();
    } catch (e) {
      const errMsg = e?.response?.data?.error || e.message || '未知错误';
      message.error('生成失败: ' + errMsg);
    }
    finally { setGenerating(false); }
  };

  /* ── 播放历史 ── */
  const playHistoryItem = (item) => {
    const id = item.id;
    if (playingId === id) {
      historyAudioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    setPlayingId(id);
    const url = ttsService.getHistoryAudioUrl(id);
    if (historyAudioRef.current) {
      historyAudioRef.current.src = url;
      historyAudioRef.current.play().catch(() => setPlayingId(null));
    }
  };

  /* ── 下载历史 ── */
  const downloadHistoryItem = (item) => {
    const url = ttsService.getHistoryAudioUrl(item.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.id}.${item.output_format || 'wav'}`;
    a.click();
  };

  /* ── 删除历史 ── */
  const deleteHistoryItem = async (item) => {
    try { await ttsService.deleteHistoryItem(item.id); loadHistory(); }
    catch { message.error('删除失败'); }
  };

  if (checking) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: 120 }} />;

  return (
    <Layout className="tts-layout">
      <Header className="tts-header">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <Title level={4} style={{ margin: 0, flex: 1 }}>语音合成 (TTS)</Title>
        <span style={{ color: connected ? '#52c41a' : '#ff4d4f', fontSize: 12 }}>
          {connected ? '● 已连接' : '● 未连接'}
        </span>
      </Header>

      {!connected ? (
        <Content className="tts-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: '#999' }}>
            <SoundOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <div>TTS 服务未连接，请确认服务已启动</div>
          </div>
        </Content>
      ) : (
        <Content className="tts-content tts-body">
          {/* ── 左栏：引擎 + 音色 ── */}
          <div className="tts-col tts-col-left">
            {/* 引擎选择 */}
            <div className="tts-section-title">引擎</div>
            {engineTypes.length > 0 && (
              <Select
                value={selectedEngine}
                onChange={setSelectedEngine}
                style={{ width: '100%', marginBottom: 12 }}
                options={engineTypes.map(e => ({ value: e.engine_type, label: e.engine_name || e.engine_type }))}
              />
            )}

            {/* 音色列表 */}
            <div className="tts-section-title">
              <span>音色</span>
              <Space size={4}>
                <Tooltip title="上传音色">
                  <Button size="small" icon={<UploadOutlined />} onClick={() => voiceInputRef.current?.click()} />
                </Tooltip>
              </Space>
            </div>
            <input ref={voiceInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleUploadVoice} />
            <audio ref={voiceAudioRef} onEnded={() => setPreviewingVoice(null)} />
            <div className="tts-voice-list">
              {voices.map(v => (
                <div key={v.id}
                  className={`tts-voice-item ${selectedVoice === v.id ? 'active' : ''}`}
                  onClick={() => setSelectedVoice(v.id)}>
                  <span className="tts-voice-name">{v.name || v.id}</span>
                  <Space size={2}>
                    <Button type="text" size="small"
                      icon={previewingVoice === v.id ? <PauseCircleOutlined /> : <SoundOutlined />}
                      onClick={e => { e.stopPropagation(); previewVoice(v); }} />
                    <Button type="text" size="small" icon={<DeleteOutlined />}
                      onClick={e => { e.stopPropagation(); deleteVoice(v.id); }} />
                  </Space>
                </div>
              ))}
              {voices.length === 0 && <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>暂无音色</div>}
            </div>
          </div>

          {/* ── 中栏：文本 + 动态参数 ── */}
          <div className="tts-col tts-col-mid">
            <TextArea
              value={text} onChange={e => setText(e.target.value)}
              placeholder="请输入要合成的文本..."
              autoSize={{ minRows: 6, maxRows: 12 }}
              maxLength={4000}
              showCount
              style={{ marginBottom: 12 }}
            />

            {/* 输出格式 */}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#666' }}>输出格式</span>
              <Select size="small" value={outputFormat} onChange={setOutputFormat} style={{ width: 90 }}
                options={[{ value: 'wav', label: 'WAV' }, { value: 'mp3', label: 'MP3' }, { value: 'flac', label: 'FLAC' }]} />
            </div>

            {/* 动态参数面板 */}
            {paramDefinitions.length > 0 && (
              <Collapse ghost size="small" defaultActiveKey={['params']} style={{ marginBottom: 12 }}
                items={[{
                  key: 'params',
                  label: <span><SettingOutlined style={{ marginRight: 6 }} />引擎参数</span>,
                  children: (
                    <DynamicParamPanel
                      definitions={paramDefinitions}
                      values={paramValues}
                      onChange={(key, value) => setParamValues(prev => ({ ...prev, [key]: value }))}
                      disabled={generating}
                    />
                  )
                }]}
              />
            )}

            <Button type="primary" block loading={generating} onClick={handleGenerate}
              icon={<SoundOutlined />} disabled={!text.trim() || !selectedVoice}>
              生成语音
            </Button>
          </div>

          {/* ── 右栏：历史 ── */}
          <div className="tts-col tts-col-right">
            <div className="tts-section-title">
              <span>生成历史</span>
              {history.length > 0 && (
                <Tooltip title="清空历史">
                  <Button type="text" size="small" icon={<ClearOutlined />} danger onClick={async () => {
                    try { await ttsService.clearHistory(); setHistory([]); } catch {}
                  }} />
                </Tooltip>
              )}
            </div>
            <audio ref={historyAudioRef} onEnded={() => setPlayingId(null)} />
            <div className="tts-history">
              {history.map(item => (
                <div key={item.id} className={`tts-history-item ${activeHistoryId === item.id ? 'active' : ''}`}
                  onClick={() => setActiveHistoryId(item.id === activeHistoryId ? null : item.id)}>
                  <div className="tts-history-top">
                    <span className="tts-history-text">{item.text?.slice(0, 60) || '...'}</span>
                    <Space size={4}>
                      <Tooltip title="播放">
                        <Button type="text" size="small"
                          icon={playingId === item.id ? <PauseCircleOutlined /> : <CaretRightOutlined />}
                          onClick={e => { e.stopPropagation(); playHistoryItem(item); }} />
                      </Tooltip>
                      <Tooltip title="下载">
                        <Button type="text" size="small" icon={<DownloadOutlined />}
                          onClick={e => { e.stopPropagation(); downloadHistoryItem(item); }} />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button type="text" size="small" icon={<DeleteOutlined />}
                          onClick={e => { e.stopPropagation(); deleteHistoryItem(item); }} />
                      </Tooltip>
                    </Space>
                  </div>
                  <div className="tts-history-meta">
                    {item.created_at?.slice(0, 19) || ''} · {(item.output_format || 'wav').toUpperCase()} · {item.voice_id || ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Content>
      )}
    </Layout>
  );
}

export default TTS;
