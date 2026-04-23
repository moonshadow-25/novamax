import React, { useState } from 'react';
import { Modal, Form, Input, Button, Space, Alert, Divider } from 'antd';
import { FolderOpenOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { systemService, modelService } from '../../services/api';

function AddWhisperModal({ visible, onClose, onSuccess }) {
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
      setError('请选择引擎路径');
      return;
    }
    for (let i = 0; i < models.length; i++) {
      if (!models[i].name.trim()) {
        setError(`第 ${i + 1} 个模型名称不能为空`);
        return;
      }
      if (!models[i].path.trim()) {
        setError(`第 ${i + 1} 个模型路径不能为空`);
        return;
      }
    }

    setLoading(true);
    setError('');
    try {
      const response = await modelService.addWhisperModels({
        engine_path: enginePath.trim(),
        models: models.map(m => ({ name: m.name.trim(), path: m.path.trim() })),
      });
      if (response.success) {
        handleClose();
        if (onSuccess) onSuccess();
      } else {
        setError(response.error || '添加失败');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || '添加失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="添加 Whisper 模型"
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="引擎路径" required extra="选择 whisper-server 所在目录">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="例如：D:\novastudio\llm"
              value={enginePath}
              onChange={(e) => { setEnginePath(e.target.value); setError(''); }}
            />
            <Button
              icon={<FolderOpenOutlined />}
              loading={engineBrowseLoading}
              onClick={handleBrowseEngine}
            >
              浏览
            </Button>
          </Space.Compact>
        </Form.Item>

        <Divider orientation="left" style={{ fontSize: 13 }}>模型列表</Divider>

        {models.map((model, index) => (
          <div key={index} style={{ marginBottom: 12, padding: '12px 12px 4px', border: '1px solid #f0f0f0', borderRadius: 6 }}>
            <Form.Item label="模型名称" required style={{ marginBottom: 8 }}>
              <Input
                placeholder="例如：ggml-large-v3"
                value={model.name}
                onChange={(e) => updateModel(index, 'name', e.target.value)}
              />
            </Form.Item>
            <Form.Item label="模型文件路径" required style={{ marginBottom: 8 }}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="例如：D:\models\ggml-large-v3.bin"
                  value={model.path}
                  onChange={(e) => updateModel(index, 'path', e.target.value)}
                />
                <Button
                  icon={<FolderOpenOutlined />}
                  loading={modelBrowseLoading === index}
                  onClick={() => handleBrowseModel(index)}
                >
                  浏览
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
                删除此模型
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
          添加模型
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
          确认添加
        </Button>
      </Form>
    </Modal>
  );
}

export default AddWhisperModal;
