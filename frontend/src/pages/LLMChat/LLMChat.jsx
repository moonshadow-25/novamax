import React, { useState, useEffect, useRef } from 'react';
import { Layout, Input, Button, Space, Typography, message } from 'antd';
import { ArrowLeftOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { llmService, modelService, engineService } from '../../services/api';
import EngineDownloadModal from '../../components/EngineDownloadModal/EngineDownloadModal';
import './LLMChat.css';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;
const { TextArea } = Input;

function LLMChat() {
  const navigate = useNavigate();
  const { modelId } = useParams();
  const [model, setModel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // 引擎检查相关状态
  const [engineReady, setEngineReady] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);

  useEffect(() => {
    checkEngine();
  }, []);

  useEffect(() => {
    if (engineReady) {
      loadModel();
    }
  }, [modelId, engineReady]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const checkEngine = async () => {
    try {
      const result = await engineService.checkInstalled('llamacpp');
      if (!result.installed) {
        setEngineInfo(result.engineInfo);
        setShowDownloadModal(true);
      } else {
        setEngineReady(true);
      }
    } catch (error) {
      console.error('Failed to check engine:', error);
      setEngineReady(true);
    }
  };

  const handleDownloadComplete = () => {
    setShowDownloadModal(false);
    setEngineReady(true);
  };

  const loadModel = async () => {
    try {
      const data = await modelService.getById(modelId);
      setModel(data);
    } catch (error) {
      message.error('加载模型失败');
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await llmService.chat(modelId, {
        messages: [...messages, userMessage],
        stream: false
      });
      setMessages(prev => [...prev, { role: 'assistant', content: response.content }]);
    } catch (error) {
      message.error('发送失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
  };

  if (!engineReady) {
    return (
      <EngineDownloadModal
        visible={true}
        engineId="llamacpp"
        engineInfo={engineInfo}
        onComplete={handleDownloadComplete}
        onCancel={() => navigate('/?tab=llm')}
      />
    );
  }

  return (
    <Layout className="llm-chat-layout">
      <Header className="llm-chat-header">
        <Space>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/?tab=llm')}
          />
          <Title level={4} style={{ margin: 0 }}>{model?.name || 'LLM Chat'}</Title>
        </Space>
        <Space>
          <Button onClick={handleClear}>清除对话</Button>
          <Button
            icon={<SettingOutlined />}
            onClick={() => navigate(`/settings/${modelId}`)}
          />
        </Space>
      </Header>
      <Content className="llm-chat-content">
        <div className="messages-container">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-role">{msg.role === 'user' ? '你' : 'AI'}</div>
              <div className="message-content">{msg.content}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </Content>
      <Footer className="llm-chat-footer">
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入消息... (Shift+Enter 换行)"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={loading}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={loading}
          >
            发送
          </Button>
        </Space.Compact>
      </Footer>
    </Layout>
  );
}

export default LLMChat;
