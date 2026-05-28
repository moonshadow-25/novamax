import React from 'react';
import { Layout, Typography, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const { Header, Content } = Layout;
const { Title } = Typography;

function Settings() {
  const navigate = useNavigate();
  const { modelId } = useParams();
  const { t } = useTranslation('settings');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: 'inherit', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
        />
        <Title level={4} style={{ display: 'inline', marginLeft: 16 }}>{t('modelSettings')}</Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <div>{t('settingsInProgress', { modelId })}</div>
      </Content>
    </Layout>
  );
}

export default Settings;
