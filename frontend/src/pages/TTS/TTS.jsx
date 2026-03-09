import React from 'react';
import { Layout, Typography, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';

const { Header, Content } = Layout;
const { Title } = Typography;

function TTS() {
  const navigate = useNavigate();
  const { modelId } = useParams();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: 'inherit', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/?tab=tts')}
        />
        <Title level={4} style={{ display: 'inline', marginLeft: 16 }}>TTS</Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <div>TTS 界面开发中... (Model ID: {modelId})</div>
      </Content>
    </Layout>
  );
}

export default TTS;
