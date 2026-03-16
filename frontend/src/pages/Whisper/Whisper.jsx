import React, { useState, useEffect } from 'react';
import { Layout, Typography, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { engineService } from '../../services/api';
import EngineDownloadModal from '../../components/EngineDownloadModal/EngineDownloadModal';

const { Header, Content } = Layout;
const { Title } = Typography;

function Whisper() {
  const navigate = useNavigate();
  const { modelId } = useParams();

  const [engineReady, setEngineReady] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [engineInfo, setEngineInfo] = useState(null);

  useEffect(() => {
    checkEngine();
  }, []);

  const checkEngine = async () => {
    try {
      const result = await engineService.checkInstalled('whisper');
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

  if (!engineReady) {
    return (
      <EngineDownloadModal
        visible={true}
        engineId="whisper"
        engineInfo={engineInfo}
        onComplete={handleDownloadComplete}
        onCancel={() => navigate('/?tab=whisper')}
      />
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: 'inherit', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/?tab=whisper')}
        />
        <Title level={4} style={{ display: 'inline', marginLeft: 16 }}>Whisper</Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <div>Whisper 界面开发中... (Model ID: {modelId})</div>
      </Content>
    </Layout>
  );
}

export default Whisper;
