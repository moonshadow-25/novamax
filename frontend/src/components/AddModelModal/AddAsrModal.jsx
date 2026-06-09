import React, { useState } from 'react';
import { Modal, Form, Input, Button, Space, Alert, Divider } from 'antd';
import { FolderOpenOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { systemService, modelService } from '../../services/api';
import { useTranslation } from 'react-i18next';

function AddAsrModal({ visible, onClose, onSuccess }) {
  const { t } = useTranslation('home');
  const [enginePath, setEnginePath] = useState('');
  const [models, setModels] = useState([{ name: '', path: '' }]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [engineBrowseLoading, setEngineBrowseLoading] = useState(false);
  const [modelBrowseLoading, setModelBrowseLoading] = useState(null);

  const reset = () => {
    setEnginePath('');
    setModels([{ name: '', path: '' }]);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleBrowseEngine = async () => {
    setEngineBrowseLoading(true);
    try {
      const result = await systemService.pickFolder();
      if (!result.cancelled && result.path) {
        setEnginePath(result.path);
        setError('');
      }
    } catch {
      // ignore
    } finally {
      setEngineBrowseLoading(false);
    }
  };

  const handleBrowseModel = async (index) => {
    setModelBrowseLoading(index);
    try {
      const result = await systemService.pickFile('*.bin;*.gguf');
      if (!result.cancelled && result.path) {
        const updated = [...models];
        updated[index] = { ...updated[index], path: result.path };
        if (!updated[index].name) {
          const filename = result.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
          updated[index] = { ...updated[index], name: filename };
        }
        setModels(updated);
        setError('');
      }
    } catch {
      // ignore
    } finally {
      setModelBrowseLoading(null);
    }
  };

  const addModelEntry = () => {
    setModels([...models, { name: '', path: '' }]);
  };

  const removeModelEntry = (index) => {
    if (models.length === 1) return;
    setModels(models.filter((_, i) => i !== index));
  };

  const updateModel = (index, field, value) => {
    const updated = [...models];
    updated[index] = { ...updated[index], [field]: value };
    setModels(updated);
    setError('');
  };

  const handleConfirm = async () => {
    if (!enginePath.trim()) {
      setError(t('addWhisperModal.selectEnginePath'));
      return;
    }
    for (let i = 0; i < models.length; i++) {
      if (!models[i].name.trim()) {
        setError(t('addWhisperModal.modelNameRequiredAtIndex', { index: i + 1 }));
        return;
      }
      if (!models[i].path.trim()) {
        setError(t('addWhisperModal.modelPathRequiredAtIndex', { index: i + 1 }));
        return;
      }
    }

    setLoading(true);
    setError('');
    try {
      const response = await modelService.addAsrModels({
        engine_path: enginePath.trim(),
        models: models.map(m => ({ name: m.name.trim(), path: m.path.trim() })),
      });
      if (response.success) {
        handleClose();
        if (onSuccess) onSuccess();
      } else {
        setError(response.error || t('addModelModal.addFailed'));
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('addModelModal.addFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('addWhisperModal.title')}
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label={t('addWhisperModal.enginePath')} required extra={t('addWhisperModal.enginePathHint')}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={t('addWhisperModal.enginePathPlaceholder')}
              value={enginePath}
              onChange={(e) => { setEnginePath(e.target.value); setError(''); }}
            />
            <Button
              icon={<FolderOpenOutlined />}
              loading={engineBrowseLoading}
              onClick={handleBrowseEngine}
            >
              {t('addModelModal.browse')}
            </Button>
          </Space.Compact>
        </Form.Item>

        <Divider orientation="left" style={{ fontSize: 13 }}>{t('addWhisperModal.modelList')}</Divider>

        {models.map((model, index) => (
          <div key={index} style={{ marginBottom: 12, padding: '12px 12px 4px', border: '1px solid #f0f0f0', borderRadius: 6 }}>
            <Form.Item label={t('addWhisperModal.modelName')} required style={{ marginBottom: 8 }}>
              <Input
                placeholder={t('addWhisperModal.modelNamePlaceholder')}
                value={model.name}
                onChange={(e) => updateModel(index, 'name', e.target.value)}
              />
            </Form.Item>
            <Form.Item label={t('addWhisperModal.modelFilePath')} required style={{ marginBottom: 8 }}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder={t('addWhisperModal.modelFilePathPlaceholder')}
                  value={model.path}
                  onChange={(e) => updateModel(index, 'path', e.target.value)}
                />
                <Button
                  icon={<FolderOpenOutlined />}
                  loading={modelBrowseLoading === index}
                  onClick={() => handleBrowseModel(index)}
                >
                  {t('addModelModal.browse')}
                </Button>
              </Space.Compact>
            </Form.Item>
            {models.length > 1 && (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => removeModelEntry(index)}
                style={{ marginBottom: 4 }}
              >
                {t('addWhisperModal.deleteThisModel')}
              </Button>
            )}
          </div>
        ))}

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={addModelEntry}
          style={{ marginTop: 4, marginBottom: 16 }}
        >
          {t('addWhisperModal.addModel')}
        </Button>

        {error && (
          <Alert
            message={error}
            type="error"
            closable
            onClose={() => setError('')}
            style={{ marginBottom: 12 }}
          />
        )}

        <Button type="primary" block loading={loading} onClick={handleConfirm}>
          {t('addModelModal.confirmAdd')}
        </Button>
      </Form>
    </Modal>
  );
}

export default AddAsrModal;
