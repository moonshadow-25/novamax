import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Button, Select, Space, Typography, message, Spin, Tooltip, Slider, Input, Collapse, Switch, InputNumber } from 'antd';
import {
  ArrowLeftOutlined, UploadOutlined, DeleteOutlined, SoundOutlined,
  DownloadOutlined, PauseCircleOutlined, CaretRightOutlined, ReloadOutlined,
  SettingOutlined, SmileOutlined, ClearOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ttsService } from '../../services/api';
import './TTS.css';

const { Header, Content } = Layout;
const { Title } = Typography;
const { TextArea } = Input;

const EMOTION_PRESETS = [
  { value: '', label: '无（默认）' },
  { value: '开心', label: '开心' },
  { value: '悲伤', label: '悲伤' },
  { value: '愤怒', label: '愤怒' },
  { value: '恐惧', label: '恐惧' },
  { value: '惊讶', label: '惊讶' },
  { value: '厌恶', label: '厌恶' },
  { value: '温柔', label: '温柔' },
  { value: '严肃', label: '严肃' },
  { value: '兴奋', label: '兴奋' },
  { value: '低沉', label: '低沉' },
];

function TTS() {
  const navigate = useNavigate();
  const voiceAudioRef = useRef(null);
  const voiceInputRef = useRef(null);
  const historyAudioRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [previewingVoice, setPreviewingVoice] = useState(null);

  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(false);

  // 基础参数
  const [speed, setSpeed] = useState(1.0);
  const [responseFormat, setResponseFormat] = useState('wav');
  const [inferMode, setInferMode] = useState('normal');

  // 情感参数
  const [emotionPreset, setEmotionPreset] = useState('');
  const [emoAlpha, setEmoAlpha] = useState(1.0);

  // 高级参数
  const [temperature, setTemperature] = useState(1.0);
  const [topP, setTopP] = useState(0.8);
  const [topK, setTopK] = useState(50);
  const [doSample, setDoSample] = useState(true);
  const [numBeams, setNumBeams] = useState(1);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.0);
  const [lengthPenalty, setLengthPenalty] = useState(1.0);
  const [maxMelTokens, setMaxMelTokens] = useState(600);

  const [history, setHistory] = useState([]);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  /* ── 检查 TTS 服务连接 ── */
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

  /* ── 加载音色列表 ── */
  const loadVoices = useCallback(async () => {
    if (!connected) { setVoices([]); return; }
    try {
      const data = await ttsService.getVoices();
      const list = data?.data || [];
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
      setHistory(data?.data || data?.history || []);
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

  /* ── 自动注册音色 ── */
  const autoRegister = async () => {
    try {
      const data = await ttsService.autoRegisterVoices();
      message.success(`注册完成: ${data?.registered || 0} 个音色`);
      loadVoices();
    } catch { message.error('自动注册失败'); }
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
      const params = {
        input: text,
        voice: selectedVoice,
        speed,
        response_format: responseFormat,
        infer_mode: inferMode,
        temperature,
        top_p: topP,
        top_k: topK,
        do_sample: doSample,
        num_beams: numBeams,
        repetition_penalty: repetitionPenalty,
        length_penalty: lengthPenalty,
        max_mel_tokens: maxMelTokens,
      };
      // 情感参数
      if (emotionPreset) {
        params.use_emo_text = true;
        params.emo_text = emotionPreset;
        params.emo_alpha = emoAlpha;
      }
      await ttsService.speech(params);
      message.success('生成完成');
      loadHistory();
    } catch (e) { message.error('生成失败: ' + (e.message || '未知错误')); }
    finally { setGenerating(false); }
  };

  /* ── 播放历史 ── */
  const playHistoryItem = (item) => {
    const id = item.id || item.filename;
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
    const id = item.id || item.filename;
    const url = ttsService.getHistoryAudioUrl(id);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.wav`;
    a.click();
  };

  /* ── 删除历史 ── */
  const deleteHistoryItem = async (item) => {
    const id = item.id || item.filename;
    try {
      await ttsService.deleteHistoryItem(id);
      loadHistory();
    } catch { message.error('删除失败'); }
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
          {/* ── 左栏：音色列表 ── */}
          <div className="tts-col tts-col-left">
            <div className="tts-section-title">
              <span>音色列表</span>
              <Space size={4}>
                <Tooltip title="上传音色">
                  <Button size="small" icon={<UploadOutlined />} onClick={() => voiceInputRef.current?.click()} />
                </Tooltip>
                <Tooltip title="自动注册">
                  <Button size="small" icon={<ReloadOutlined />} onClick={autoRegister} />
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
                  <Button type="text" size="small"
                    icon={previewingVoice === v.id ? <PauseCircleOutlined /> : <SoundOutlined />}
                    onClick={e => { e.stopPropagation(); previewVoice(v); }} />
                </div>
              ))}
              {voices.length === 0 && <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>暂无音色</div>}
            </div>
          </div>

          {/* ── 中栏：文本输入 + 参数 ── */}
          <div className="tts-col tts-col-mid">
            <TextArea
              value={text} onChange={e => setText(e.target.value)}
              placeholder="请输入要合成的文本..."
              autoSize={{ minRows: 6, maxRows: 12 }}
              maxLength={4000}
              showCount
              style={{ marginBottom: 12 }}
            />

            {/* 基础参数 */}
            <div className="tts-param-group">
              <div className="tts-param-row">
                <span className="tts-param-label">语速</span>
                <Slider min={0.5} max={2.0} step={0.1} value={speed} onChange={setSpeed} style={{ flex: 1 }} />
                <span className="tts-param-value">{speed.toFixed(1)}</span>
              </div>
              <div className="tts-param-row">
                <span className="tts-param-label">格式</span>
                <Select size="small" value={responseFormat} onChange={setResponseFormat} style={{ width: 100 }}
                  options={[{ value: 'wav', label: 'WAV' }, { value: 'mp3', label: 'MP3' }, { value: 'flac', label: 'FLAC' }]} />
                <span className="tts-param-label" style={{ marginLeft: 16 }}>推理模式</span>
                <Select size="small" value={inferMode} onChange={setInferMode} style={{ width: 100 }}
                  options={[{ value: 'normal', label: '标准' }, { value: 'fast', label: '快速' }]} />
              </div>
            </div>

            {/* 情感参数 */}
            <Collapse ghost size="small" defaultActiveKey={['emotion']} style={{ marginBottom: 8 }}
              items={[{
                key: 'emotion',
                label: <span><SmileOutlined style={{ marginRight: 6 }} />情感控制</span>,
                children: (
                  <div className="tts-param-group">
                    <div className="tts-param-row">
                      <span className="tts-param-label">情感模板</span>
                      <Select size="small" value={emotionPreset} onChange={setEmotionPreset}
                        style={{ flex: 1 }} options={EMOTION_PRESETS} allowClear
                        placeholder="选择情感" />
                    </div>
                    <div className="tts-param-row">
                      <span className="tts-param-label">情感强度</span>
                      <Slider min={0} max={1} step={0.05} value={emoAlpha} onChange={setEmoAlpha}
                        style={{ flex: 1 }} disabled={!emotionPreset} />
                      <span className="tts-param-value">{emoAlpha.toFixed(2)}</span>
                    </div>
                  </div>
                )
              }]}
            />

            {/* 高级参数 */}
            <Collapse ghost size="small" defaultActiveKey={['advanced']} style={{ marginBottom: 12 }}
              items={[{
                key: 'advanced',
                label: <span><SettingOutlined style={{ marginRight: 6 }} />高级参数</span>,
                children: (
                  <div className="tts-param-group">
                    <div className="tts-param-row">
                      <span className="tts-param-label">Temperature</span>
                      <Slider min={0.1} max={2.0} step={0.05} value={temperature} onChange={setTemperature} style={{ flex: 1 }} />
                      <span className="tts-param-value">{temperature.toFixed(2)}</span>
                    </div>
                    <div className="tts-param-row">
                      <span className="tts-param-label">Top P</span>
                      <Slider min={0} max={1} step={0.05} value={topP} onChange={setTopP} style={{ flex: 1 }} />
                      <span className="tts-param-value">{topP.toFixed(2)}</span>
                    </div>
                    <div className="tts-param-row">
                      <span className="tts-param-label">Top K</span>
                      <InputNumber size="small" min={1} max={200} value={topK} onChange={setTopK} style={{ width: 80 }} />
                      <span className="tts-param-label" style={{ marginLeft: 16 }}>Num Beams</span>
                      <InputNumber size="small" min={1} max={10} value={numBeams} onChange={setNumBeams} style={{ width: 80 }} />
                    </div>
                    <div className="tts-param-row">
                      <span className="tts-param-label">采样</span>
                      <Switch size="small" checked={doSample} onChange={setDoSample} />
                      <span className="tts-param-label" style={{ marginLeft: 16 }}>Max Mel Tokens</span>
                      <InputNumber size="small" min={100} max={2000} value={maxMelTokens} onChange={setMaxMelTokens} style={{ width: 80 }} />
                    </div>
                    <div className="tts-param-row">
                      <span className="tts-param-label">Repetition Penalty</span>
                      <Slider min={1.0} max={3.0} step={0.1} value={repetitionPenalty} onChange={setRepetitionPenalty} style={{ flex: 1 }} />
                      <span className="tts-param-value">{repetitionPenalty.toFixed(1)}</span>
                    </div>
                    <div className="tts-param-row">
                      <span className="tts-param-label">Length Penalty</span>
                      <Slider min={0.5} max={2.0} step={0.1} value={lengthPenalty} onChange={setLengthPenalty} style={{ flex: 1 }} />
                      <span className="tts-param-value">{lengthPenalty.toFixed(1)}</span>
                    </div>
                  </div>
                )
              }]}
            />

            <Button type="primary" block loading={generating} onClick={handleGenerate}
              icon={<SoundOutlined />} disabled={!text.trim() || !selectedVoice}>
              生成语音
            </Button>
          </div>

          {/* ── 右栏：历史记录 ── */}
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
              {history.map(item => {
                const id = item.id || item.filename;
                return (
                  <div key={id} className={`tts-history-item ${activeHistoryId === id ? 'active' : ''}`}
                    onClick={() => setActiveHistoryId(id === activeHistoryId ? null : id)}>
                    <div className="tts-history-top">
                      <span className="tts-history-text">{item.text || item.input || '...'}</span>
                      <Space size={4}>
                        <Tooltip title="播放">
                          <Button type="text" size="small"
                            icon={playingId === id ? <PauseCircleOutlined /> : <CaretRightOutlined />}
                            onClick={e => { e.stopPropagation(); playHistoryItem(item); }} />
                        </Tooltip>
                        <Tooltip title="下载">
                          <Button type="text" size="small" icon={<DownloadOutlined />}
                            onClick={e => { e.stopPropagation(); downloadHistoryItem(item); }} />
                        </Tooltip>
                      </Space>
                    </div>
                    <div className="tts-history-meta">
                      {item.created_at || ''} · {(item.format || 'wav').toUpperCase()} · {item.voice_id || ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Content>
      )}
    </Layout>
  );
}

export default TTS;
