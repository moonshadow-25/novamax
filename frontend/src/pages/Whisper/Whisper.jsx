import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Layout, Button, Select, Space, Typography, message, Spin, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, UploadOutlined, CopyOutlined, DownloadOutlined,
  SoundOutlined, RedoOutlined, DeleteOutlined, InboxOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { whisperService } from '../../services/api';
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

export default function Whisper() {
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [ready, setReady] = useState(null);
  const [language, setLanguage] = useState('auto');
  const [transcribing, setTranscribing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 当前选中的文件（未转写时）
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingUrl, setPendingUrl] = useState(null);

  // 历史记录 & 当前查看的历史项
  const [history, setHistory] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    whisperService.health().then(r => setReady(r?.status === 'ok')).catch(() => setReady(false));
  }, []);

  // 当前展示的音频信息（来自 pending 或 history）
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

  /* ── 转写 ── */
  const handleTranscribe = async () => {
    if (!pendingFile) return message.warning('请先选择音频文件');
    const file = pendingFile;
    // 立即清空上传区
    setPendingFile(null);
    if (pendingUrl) { URL.revokeObjectURL(pendingUrl); setPendingUrl(null); }
    if (fileRef.current) fileRef.current.value = '';
    setTranscribing(true);
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
    } catch (err) {
      message.error('转写失败: ' + (err?.message || '未知错误'));
    } finally {
      setTranscribing(false);
    }
  };

  /* ── 重新转写（原地更新当前历史项） ── */
  const handleRetranscribe = async () => {
    if (!activeItem?.file) return;
    setTranscribing(true);
    try {
      const res = await whisperService.transcribe(activeItem.file, language === 'auto' ? undefined : language, vad);
      const text = res?.text ?? '';
      setHistory(prev => prev.map(h => h.id === activeId ? { ...h, result: text, language, timestamp: Date.now() } : h));
    } catch (err) {
      message.error('转写失败: ' + (err?.message || '未知错误'));
    } finally {
      setTranscribing(false);
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

  if (ready === null) return <Layout className="wh-layout"><div className="wh-empty"><Spin /></div></Layout>;
  if (ready === false) return (
    <Layout className="wh-layout">
      <Header className="wh-header">
        <Space><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav(-1)} /><Title level={5} style={{ margin: 0 }}>Whisper 语音转写</Title></Space>
      </Header>
      <div className="wh-empty"><p>Whisper 服务未就绪</p></div>
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
                <div className="wh-empty"><Spin tip="转写中..." /></div>
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
