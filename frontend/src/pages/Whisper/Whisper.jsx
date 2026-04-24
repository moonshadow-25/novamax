import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Layout, Button, Select, Space, Typography, message, Spin, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, UploadOutlined, CopyOutlined, DownloadOutlined,
  SoundOutlined, RedoOutlined, DeleteOutlined, InboxOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { whisperService, backendService, modelService } from '../../services/api';
import './Whisper.css';

const { Header, Content } = Layout;
const { Title } = Typography;

const LANGUAGES = [
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

const fmtSize = (b) => b < 1024 * 1024
  ? (b / 1024).toFixed(1) + ' KB'
  : (b / 1024 / 1024).toFixed(1) + ' MB';

const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const parseWhisperPhaseFromLogs = (logText) => {
  if (!logText) return '';

  if (logText.includes('语音转录成功完成')) {
    return '转写完成，正在返回结果...';
  }

  const progressMatches = [...logText.matchAll(/progress\s*=\s*(\d+)%/g)];
  if (progressMatches.length > 0) {
    const latest = progressMatches[progressMatches.length - 1]?.[1];
    if (latest) return `正在转写文本... ${latest}%`;
  }

  if (/\[\d{2}:\d{2}:\d{2}\.\d+\s*-->/.test(logText)) {
    return '正在转写文本...';
  }

  if (logText.includes('whisper_vad_detect_speech') || logText.includes('VAD is enabled')) {
    return '正在做语音活动检测（VAD）...';
  }

  if (logText.includes('直接转发请求到 whisper 服务') || logText.includes('Running Whisper.cpp inference')) {
    return '已提交转写任务，正在等待引擎处理...';
  }

  if (logText.includes('开始音频预处理') || logText.includes('执行音频预处理命令')) {
    return '正在上传与预处理音频...';
  }

  return '';
};

export default function Whisper() {
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [ready, setReady] = useState(null);
  const [language, setLanguage] = useState('auto');
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeStartAt, setTranscribeStartAt] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [whisperModelId, setWhisperModelId] = useState(null);
  const [logBaseline, setLogBaseline] = useState(0);
  const [livePhaseText, setLivePhaseText] = useState('');
  const [dragging, setDragging] = useState(false);

  // 当前选中的文件（未转写时）
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingUrl, setPendingUrl] = useState(null);

  // 历史记录 & 当前查看的历史项
  const [history, setHistory] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const check = async () => {
      try {
        const r = await whisperService.health();
        if (cancelled) return;
        setReady(r?.status === 'ok');
      } catch {
        if (cancelled) return;
        setReady(false);
      }

      timer = setTimeout(check, 2000);
    };

    check();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (ready !== true) return;
    let cancelled = false;

    const loadWhisperModelId = async () => {
      try {
        const data = await modelService.getByType('whisper');
        if (cancelled) return;
        const models = data?.models || [];
        const runningModel = models.find(m => m.status === 'running' || m.status === 'starting');
        const target = runningModel || models[0] || null;
        setWhisperModelId(target?.id || null);
      } catch {
        if (!cancelled) setWhisperModelId(null);
      }
    };

    loadWhisperModelId();

    return () => {
      cancelled = true;
    };
  }, [ready]);


  const activeItem = useMemo(() => history.find(h => h.id === activeId), [history, activeId]);
  const displayName = activeItem?.fileName ?? pendingFile?.name ?? null;
  const displaySize = activeItem ? fmtSize(activeItem.fileSize) : pendingFile ? fmtSize(pendingFile.size) : null;
  const displayResult = activeItem?.result ?? '';

  // 音频 URL 管理
  const [historyUrls] = useState(() => new Map());
  const displayAudioUrl = useMemo(() => {
    if (activeItem) {
      if (!historyUrls.has(activeItem.id)) {
        historyUrls.set(activeItem.id, URL.createObjectURL(activeItem.file));
      }
      return historyUrls.get(activeItem.id);
    }
    return pendingUrl;
  }, [activeItem, pendingUrl, historyUrls]);

  /* ── 文件选择 ── */
  const handleFile = useCallback((file) => {
    if (!file) return;
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setPendingFile(file);
    setPendingUrl(URL.createObjectURL(file));
    setActiveId(null);
  }, [pendingUrl]);

  const onFileChange = (e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); };

  /* ── 拖拽 ── */
  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) handleFile(file);
    else message.warning('请拖入音频文件');
  };

  useEffect(() => {
    if (!transcribing || !transcribeStartAt) return;
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - transcribeStartAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [transcribing, transcribeStartAt]);

  useEffect(() => {
    if (!transcribing || !whisperModelId) return;
    let cancelled = false;

    const pollLogs = async () => {
      try {
        const data = await backendService.getLogs(whisperModelId);
        if (cancelled) return;
        const logs = Array.isArray(data?.logs) ? data.logs : [];
        const merged = logs.slice(logBaseline).join('\n');
        const parsed = parseWhisperPhaseFromLogs(merged);
        if (parsed) setLivePhaseText(parsed);
      } catch {
        // ignore log poll errors, keep fallback text
      }
    };

    pollLogs();
    const timer = setInterval(pollLogs, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [transcribing, whisperModelId, logBaseline]);

  const transcribePhaseText = useMemo(() => {
    if (!transcribing) return '';
    if (livePhaseText) return livePhaseText;
    if (elapsedSec < 8) return '正在上传与预处理音频...';
    if (elapsedSec < 45) return '正在分析音频内容，长音频会较慢...';
    return '正在分段转写，请耐心等待...';
  }, [transcribing, elapsedSec, livePhaseText]);

  /* ── 转写 ── */
  const handleTranscribe = async () => {
    if (!pendingFile) return message.warning('请先选择音频文件');
    const file = pendingFile;
    setTranscribing(true);
    setTranscribeStartAt(Date.now());
    setElapsedSec(0);
    setLivePhaseText('');
    if (whisperModelId) {
      try {
        const data = await backendService.getLogs(whisperModelId);
        const logs = Array.isArray(data?.logs) ? data.logs : [];
        setLogBaseline(logs.length);
      } catch {
        setLogBaseline(0);
      }
    } else {
      setLogBaseline(0);
    }
    try {
      const res = await whisperService.transcribe(file, language === 'auto' ? undefined : language);
      const text = res?.text ?? '';
      const newItem = {
        id: Date.now(),
        file,
        fileName: file.name,
        fileSize: file.size,
        result: text,
        language,
        timestamp: Date.now(),
      };
      setHistory(prev => [newItem, ...prev]);
      setActiveId(newItem.id);
      setPendingFile(null);
      if (pendingUrl) { URL.revokeObjectURL(pendingUrl); setPendingUrl(null); }
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      message.error('转写失败: ' + (err?.message || '未知错误'));
    } finally {
      setTranscribing(false);
      setTranscribeStartAt(null);
      setElapsedSec(0);
      setLivePhaseText('');
      setLogBaseline(0);
    }
  };

  /* ── 重新转写（原地更新当前历史项） ── */
  const handleRetranscribe = async () => {
    if (!activeItem?.file) return;
    setTranscribing(true);
    setTranscribeStartAt(Date.now());
    setElapsedSec(0);
    setLivePhaseText('');
    if (whisperModelId) {
      try {
        const data = await backendService.getLogs(whisperModelId);
        const logs = Array.isArray(data?.logs) ? data.logs : [];
        setLogBaseline(logs.length);
      } catch {
        setLogBaseline(0);
      }
    } else {
      setLogBaseline(0);
    }
    try {
      const res = await whisperService.transcribe(activeItem.file, language === 'auto' ? undefined : language);
      const text = res?.text ?? '';
      setHistory(prev => prev.map(h => h.id === activeId ? { ...h, result: text, language, timestamp: Date.now() } : h));
    } catch (err) {
      message.error('转写失败: ' + (err?.message || '未知错误'));
    } finally {
      setTranscribing(false);
      setTranscribeStartAt(null);
      setElapsedSec(0);
      setLivePhaseText('');
      setLogBaseline(0);
    }
  };

  /* ── 历史操作 ── */
  const deleteHistory = (id, e) => {
    e.stopPropagation();
    const url = historyUrls.get(id);
    if (url) { URL.revokeObjectURL(url); historyUrls.delete(id); }
    setHistory(prev => prev.filter(h => h.id !== id));
    if (activeId === id) setActiveId(null);
  };

  /* ── 结果操作 ── */
  const currentResult = activeItem ? activeItem.result : '';
  const copyText = () => { navigator.clipboard.writeText(currentResult); message.success('已复制'); };
  const downloadText = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([currentResult], { type: 'text/plain' }));
    a.download = (displayName?.replace(/\.[^.]+$/, '') || 'transcription') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (ready === null) return <Layout className="wh-layout"><div className="wh-empty"><Spin tip="正在连接 Whisper 服务..." /></div></Layout>;
  if (ready === false) return (
    <Layout className="wh-layout">
      <Header className="wh-header">
        <Space><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav(-1)} /><Title level={5} style={{ margin: 0 }}>Whisper 语音转写</Title></Space>
      </Header>
      <div className="wh-empty"><p>Whisper 服务未就绪，请先在模型页面启动</p></div>
    </Layout>
  );

  return (
    <Layout className="wh-layout">
      <Header className="wh-header">
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav(-1)} />
          <Title level={5} style={{ margin: 0 }}>Whisper 语音转写</Title>
        </Space>
      </Header>
      <Content className="wh-content">
        <div className="wh-body">
          {/* ── 左栏 ── */}
          <div className="wh-col wh-left">
            {/* 拖拽上传 */}
            <div className="wh-section">
              <input ref={fileRef} type="file" accept="audio/*" hidden onChange={onFileChange} />
              <div
                className={`wh-drop-zone${dragging ? ' dragging' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <InboxOutlined style={{ fontSize: 28 }} />
                <div style={{ marginTop: 6, fontSize: 13 }}>点击或拖拽音频文件到此处</div>
                <div className="wh-drop-hint">支持 mp3 / wav / flac / m4a 等格式</div>
              </div>
            </div>

            {/* 参数 */}
            <div className="wh-section">
              <div className="wh-param-row">
                <span className="wh-param-label">
                  音频语言
                  <Tooltip title="源音频语言，不影响输出语言" placement="top">
                    <QuestionCircleOutlined style={{ marginLeft: 4, fontSize: 12, opacity: 0.5, cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Select size="small" value={language} onChange={setLanguage} options={LANGUAGES} style={{ flex: 1 }} />
              </div>
              <Button type="primary" block icon={<UploadOutlined />} loading={transcribing} onClick={handleTranscribe}
                disabled={!pendingFile}>
                开始转写
              </Button>
            </div>

            {/* 历史记录 */}
            {history.length > 0 && (
              <div className="wh-section wh-history-section">
                <div className="wh-section-title">历史记录</div>
                <div className="wh-history-list">
                  {history.map(h => (
                    <div key={h.id}
                      className={`wh-history-item${activeId === h.id ? ' active' : ''}`}
                      onClick={() => setActiveId(h.id)}
                    >
                      <SoundOutlined style={{ flexShrink: 0, opacity: 0.5 }} />
                      <span className="wh-history-item-name">{h.fileName}</span>
                      <span className="wh-history-item-time">{fmtTime(h.timestamp)}</span>
                      <Button type="text" size="small" icon={<DeleteOutlined />}
                        className="wh-history-del"
                        onClick={(e) => deleteHistory(h.id, e)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── 右栏 ── */}
          <div className="wh-col wh-right">
            {/* 音频信息 + 播放器 */}
            {displayAudioUrl && (
              <div className="wh-audio-bar">
                <div className="wh-audio-info">
                  <SoundOutlined />
                  <span className="wh-audio-name">{displayName}</span>
                  <span className="wh-audio-size">{displaySize}</span>
                </div>
                <audio controls src={displayAudioUrl} className="wh-audio-player" />
              </div>
            )}

            {/* 结果头 */}
            <div className="wh-result-header">
              <span className="wh-result-header-title">转写结果</span>
              {currentResult && (
                <Space size={0}>
                  <Tooltip title="重新转写">
                    <Button type="text" size="small" icon={<RedoOutlined />} loading={transcribing} onClick={handleRetranscribe} />
                  </Tooltip>
                  <Tooltip title="复制">
                    <Button type="text" size="small" icon={<CopyOutlined />} onClick={copyText} />
                  </Tooltip>
                  <Tooltip title="下载">
                    <Button type="text" size="small" icon={<DownloadOutlined />} onClick={downloadText} />
                  </Tooltip>
                </Space>
              )}
            </div>

            {/* 结果内容 */}
            <div className="wh-result-area">
              {transcribing ? (
                <div className="wh-empty">
                  <Spin />
                  <div className="wh-progress-phase">{transcribePhaseText}</div>
                  <div className="wh-progress-time">已耗时 {fmtDuration(elapsedSec)}</div>
                </div>
              ) : currentResult ? (
                <pre className="wh-result-text">{currentResult}</pre>
              ) : (
                <div className="wh-empty">
                  <SoundOutlined style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }} />
                  <div>选择音频文件并点击"开始转写"</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Content>
    </Layout>
  );
}
