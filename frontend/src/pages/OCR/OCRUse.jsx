import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spin, Empty, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { modelService } from '../../services/api';
import ModelCard from '../../components/ModelCard/ModelCard';
import './OCRUse.css';

const { Title } = Typography;

export default function OCRUse() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await modelService.getByType('ocr');
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to load OCR models:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // SSE 实时状态同步
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('model-updated', () => loadModels());
    es.addEventListener('download-progress', () => loadModels());
    es.addEventListener('server-restarted', () => window.location.reload());
    return () => es.close();
  }, [loadModels]);

  return (
    <div className="ocr-use-page">
      <div className="ocr-use-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/?tab=ocr')}>
          {t('common:back')}
        </Button>
        <Title level={3} style={{ margin: 0 }}>OCR 模型</Title>
      </div>

      <Spin spinning={loading}>
        {models.length === 0 && !loading ? (
          <Empty description="暂无 OCR 模型，请检查远程模型同步状态" />
        ) : (
          <div className="ocr-model-grid">
            {models.map(model => (
              <ModelCard
                key={model.id}
                model={model}
                onUpdate={loadModels}
              />
            ))}
          </div>
        )}
      </Spin>
    </div>
  );
}
