import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Input, List, Button, message, Radio, Space, Alert, Typography, Tag, Form, Select } from 'antd';
import { SearchOutlined, LinkOutlined, LoadingOutlined, DownOutlined, UpOutlined, FolderOpenOutlined, CloudOutlined } from '@ant-design/icons';
import { modelscopeService, modelService, systemService } from '../../services/api';
import { useTranslation } from 'react-i18next';
import ModelPreviewDialog from './ModelPreviewDialog';
import AddWorkflowTab from './AddWorkflowTab';
import AddWhisperModal from './AddWhisperModal';

const { Text } = Typography;
const { Option } = Select;

// 初始显示的搜索结果数量
const INITIAL_DISPLAY_COUNT = 8;

function AddModelModal({ visible, type, onClose, onSuccess }) {
  const { t } = useTranslation('home');
  const [activeTab, setActiveTab] = useState('modelscope');
  const [inputMode, setInputMode] = useState('search'); // 'url' | 'search'
  const [urlInput, setUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [showAllResults, setShowAllResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 预览相关状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewConfig, setPreviewConfig] = useState(null);

  // 自定义模型相关状态
  const [customName, setCustomName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customError, setCustomError] = useState('');
  const [customLoading, setCustomLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);

  // 云API模型相关状态
  const CLOUD_PLATFORMS = [
    { label: t('addModelModal.platform.aliyun'), value: t('addModelModal.platform.aliyun'), url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { label: t('addModelModal.platform.ernie'), value: t('addModelModal.platform.ernie'), url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1' },
    { label: t('addModelModal.platform.doubao'), value: t('addModelModal.platform.doubao'), url: 'https://ark.cn-beijing.volces.com/api/v3' },
    { label: t('addModelModal.platform.zhipu'), value: t('addModelModal.platform.zhipu'), url: 'https://open.bigmodel.cn/api/paas/v4' },
    { label: t('addModelModal.platform.hunyuan'), value: t('addModelModal.platform.hunyuan'), url: 'https://api.hunyuan.cloud.tencent.com/v1' },
    { label: t('addModelModal.platform.siliconflow'), value: t('addModelModal.platform.siliconflow'), url: 'https://api.siliconflow.cn/v1' },
    { label: t('addModelModal.platform.deepseek'), value: t('addModelModal.platform.deepseek'), url: 'https://api.deepseek.com/v1' },
    { label: t('addModelModal.platform.moonshot'), value: t('addModelModal.platform.moonshot'), url: 'https://api.moonshot.cn/v1' },
    { label: t('addModelModal.platform.other'), value: t('addModelModal.platform.other'), url: '' },
  ];
  const [cloudName, setCloudName] = useState('');
  const [cloudPlatform, setCloudPlatform] = useState(null);
  const [cloudApiUrl, setCloudApiUrl] = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudApiModel, setCloudApiModel] = useState('');
  const [cloudDesc, setCloudDesc] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudTestLoading, setCloudTestLoading] = useState(false);
  const [cloudTested, setCloudTested] = useState(false);

  // 重置状态
  const resetState = () => {
    setInputMode('search');
    setUrlInput('');
    setSearchQuery('');
    setSearchResults([]);
    setTotalCount(0);
    setShowAllResults(false);
    setError('');
    setPreviewVisible(false);
    setPreviewData(null);
    setPreviewConfig(null);
    setCustomName('');
    setCustomPath('');
    setCustomDesc('');
    setCustomError('');
    setCloudName('');
    setCloudPlatform(null);
    setCloudApiUrl('');
    setCloudApiKey('');
    setCloudApiModel('');
    setCloudDesc('');
    setCloudError('');
  };

  // 处理关闭
  const handleClose = () => {
    resetState();
    onClose();
  };

  // 验证 URL
  const validateUrl = (url) => {
    if (!url || url.trim().length === 0) {
      return t('addModelModal.urlRequired');
    }
    if (!url.includes('modelscope.cn/models/')) {
      return t('addModelModal.urlMustBeModelscope');
    }
    return null;
  };

  // 解析 URL
  const handleParseUrl = async (urlToUse = null) => {
    const url = (typeof urlToUse === 'string' ? urlToUse : null) || urlInput;
    const validationError = validateUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await modelscopeService.parseUrl(url, type);

      if (response.success) {
        setPreviewData(response.preview);
        setPreviewConfig(response.config);
        setPreviewVisible(true);
      } else {
        setError(response.error || t('addModelModal.parseFailed'));
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || t('addModelModal.parseUrlFailed');
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // 搜索模型
  const handleSearch = useCallback(async (query) => {
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      setTotalCount(0);
      setShowAllResults(false);
      return;
    }

    setLoading(true);
    setError('');
    // 不清空已有结果，让用户感觉不到搜索发生

    try {
      const response = await modelscopeService.searchModels(query.trim());

      if (response.success) {
        setSearchResults(response.models || []);
        setTotalCount(response.totalCount || 0);
        setShowAllResults(false); // 重置展开状态
        if (response.models.length === 0) {
          setError(t('addModelModal.noMatchedModels'));
        }
      } else {
        setError(response.error || t('addModelModal.searchFailed'));
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || t('addModelModal.searchFailed');
      setError(errorMsg);
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // 动态搜索 - 使用 debounce
  useEffect(() => {
    if (inputMode !== 'search') return;

    const timeoutId = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        handleSearch(searchQuery);
      } else if (searchQuery.trim().length === 0) {
        setSearchResults([]);
        setTotalCount(0);
        setError('');
      }
    }, 500); // 500ms 防抖

    return () => clearTimeout(timeoutId);
  }, [searchQuery, inputMode, handleSearch]);

  // 选择搜索结果
  const handleSelectSearchResult = (model) => {
    setUrlInput(model.url);
    setInputMode('url');
    // 直接传递 URL，不依赖状态更新
    handleParseUrl(model.url);
  };

  // 确认添加模型
  const handleConfirmModel = async (config) => {
    try {
      const response = await modelscopeService.confirmModel(config);

      if (response.success) {
        message.success(t('addModelModal.modelAddSuccess'));
        setPreviewVisible(false);
        handleClose();
        // 异步生成 AI 描述
        if (response.model?.id && config.readme_content) {
          modelService.generateDescription(response.model.id).catch(() => {});
        }
        if (onSuccess) {
          onSuccess(response.model);
        }
      } else {
        message.error(response.error || t('addModelModal.saveModelFailed'));
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || t('addModelModal.saveModelFailed');
      message.error(errorMsg);
    }
  };

  // 云 API 连接测试
  const handleTestCloudApiConnection = async () => {
    if (!cloudName.trim()) { setCloudError(t('addModelModal.modelNameRequired')); return false; }
    if (!cloudPlatform) { setCloudError(t('addModelModal.selectCloudPlatform')); return false; }
    if (!cloudApiUrl.trim()) { setCloudError(t('addModelModal.apiBaseUrlRequired')); return false; }
    if (!cloudApiKey.trim()) { setCloudError(t('addModelModal.apiKeyRequired')); return false; }
    if (!cloudApiModel.trim()) { setCloudError(t('addModelModal.apiModelIdRequired')); return false; }

    setCloudTestLoading(true);
    setCloudError('');
    try {
      const response = await modelService.testCloudApiModel({
        api_base_url: cloudApiUrl.trim(),
        api_key: cloudApiKey.trim(),
        api_model: cloudApiModel.trim(),
      });

      if (response.success) {
        setCloudTested(true);
        message.success(t('addModelModal.cloudConnectSuccess'));
        return true;
      }

      setCloudError(response.error || t('addModelModal.testConnectionFailed'));
      return false;
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || t('addModelModal.testConnectionFailed');
      setCloudError(errMsg);
      return false;
    } finally {
      setCloudTestLoading(false);
    }
  };

  // 添加云API模型
  const handleAddCloudApiModel = async () => {
    if (!await handleTestCloudApiConnection()) {
      return;
    }

    setCloudLoading(true);
    setCloudError('');

    try {
      const response = await modelService.addCloudApiModel({
        name: cloudName.trim(),
        cloud_platform: cloudPlatform,
        api_base_url: cloudApiUrl.trim(),
        api_key: cloudApiKey.trim(),
        api_model: cloudApiModel.trim(),
        description: cloudDesc.trim() || cloudName.trim(),
      });
      if (response.success) {
        message.success(t('addModelModal.cloudAddSuccess'));
        handleClose();
        if (onSuccess) onSuccess(response.model);
      } else {
        setCloudError(response.error || t('addModelModal.addFailed'));
      }
    } catch (err) {
      setCloudError(err.response?.data?.error || err.message || t('addModelModal.addFailed'));
    } finally {
      setCloudLoading(false);
    }
  };

  // 浏览文件夹
  const handleBrowseFolder = async () => {
    setBrowseLoading(true);
    try {
      const result = await systemService.pickFolder();
      if (!result.cancelled && result.path) {
        setCustomPath(result.path);
        setCustomError('');
      }
    } catch (err) {
      message.error(t('addModelModal.pickFolderFailed'));
    } finally {
      setBrowseLoading(false);
    }
  };

  // 添加自定义模型
  const handleAddCustomModel = async () => {
    if (!customName.trim()) {
      setCustomError(t('addModelModal.modelNameRequired'));
      return;
    }
    if (!customPath.trim()) {
      setCustomError(t('addModelModal.modelFolderRequired'));
      return;
    }
    setCustomLoading(true);
    setCustomError('');
    try {
      const response = await modelService.addCustomModel({
        name: customName.trim(),
        description: customDesc.trim(),
        local_path: customPath.trim(),
        type: type || 'llm'
      });
      if (response.success) {
        message.success(t('addModelModal.customAddSuccess'));
        handleClose();
        if (onSuccess) onSuccess(response.model);
      } else {
        setCustomError(response.error || t('addModelModal.addFailed'));
      }
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || t('addModelModal.addFailed');
      setCustomError(errMsg);
    } finally {
      setCustomLoading(false);
    }
  };

  return (
    <>
      {type === 'asr' ? (
        <AddWhisperModal
          visible={visible}
          onClose={handleClose}
          onSuccess={onSuccess}
        />
      ) : (
        <Modal
          title={t('addModelModal.title')}
          open={visible}
          onCancel={handleClose}
          footer={null}
          width={700}
          style={{ top: 20 }}
          bodyStyle={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
          destroyOnClose={true}
        >
          {/* ComfyUI类型使用特殊的工作流上传界面 */}
          {type === 'comfyui' ? (
            <AddWorkflowTab
              onSuccess={(model) => {
                message.success(t('addModelModal.workflowAddSuccess'));
                handleClose();
                if (onSuccess) {
                  onSuccess(model);
                }
              }}
              onClose={handleClose}
            />
          ) : (
            <>
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                  { key: 'modelscope', label: t('addModelModal.tabModelscope') },
                  { key: 'custom', label: t('addModelModal.tabCustom') },
                  { key: 'cloudapi', label: t('addModelModal.tabCloudApi') },
                ]}
              />

            {activeTab === 'modelscope' && (
              <div>
                <Space direction="vertical" style={{ width: '100%' }} size="large">
                  {/* 输入模式切换 */}
                  <Radio.Group
                    value={inputMode}
                    onChange={(e) => {
                      setInputMode(e.target.value);
                      setError('');
                      setSearchResults([]);
                    }}
                  >
                    <Radio.Button value="search">{t('addModelModal.searchByName')}</Radio.Button>
                    <Radio.Button value="url">{t('addModelModal.urlInput')}</Radio.Button>
                  </Radio.Group>

                  {/* URL 输入模式 */}
                  {inputMode === 'url' && (
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder="https://www.modelscope.cn/models/owner/name"
                        prefix={<LinkOutlined />}
                        value={urlInput}
                        onChange={(e) => {
                          setUrlInput(e.target.value);
                          setError('');
                        }}
                        onPressEnter={handleParseUrl}
                        disabled={loading}
                      />
                      <Button
                        type="primary"
                        onClick={handleParseUrl}
                        loading={loading}
                        icon={loading ? <LoadingOutlined /> : null}
                      >
                        {t('addModelModal.parseUrl')}
                      </Button>
                    </Space.Compact>
                  )}

                  {/* 搜索模式 */}
                  {inputMode === 'search' && (
                    <>
                      <Input
                        placeholder={t('addModelModal.searchPlaceholder')}
                        prefix={<SearchOutlined />}
                        suffix={loading && <LoadingOutlined />}
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setError('');
                        }}
                      />

                      {searchResults.length > 0 && (
                        <>
                          <div style={{ marginTop: 8 }}>
                            <Space>
                              <Text type="secondary">
                                {t('addModelModal.searchResultCount', { count: totalCount })}
                                {searchResults.length < totalCount && ` ${t('addModelModal.showingFirst30')}`}
                              </Text>
                            </Space>
                          </div>
                          <div style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: '4px', marginTop: 8 }}>
                            <List
                              dataSource={showAllResults ? searchResults : searchResults.slice(0, INITIAL_DISPLAY_COUNT)}
                              renderItem={item => (
                                <List.Item
                                  style={{ cursor: 'pointer', padding: '12px 16px' }}
                                  onClick={() => handleSelectSearchResult(item)}
                                >
                                  <Space>
                                    <Text strong>{item.name}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      ({item.path})
                                    </Text>
                                  </Space>
                                </List.Item>
                              )}
                            />
                          </div>
                          {searchResults.length > INITIAL_DISPLAY_COUNT && (
                            <div style={{ textAlign: 'center', marginTop: 8 }}>
                              <Button
                                type="link"
                                icon={showAllResults ? <UpOutlined /> : <DownOutlined />}
                                onClick={() => setShowAllResults(!showAllResults)}
                              >
                                {showAllResults
                                  ? t('addModelModal.collapse')
                                  : t('addModelModal.showMore', { count: searchResults.length - INITIAL_DISPLAY_COUNT })
                                }
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* 错误提示 */}
                  {error && (
                    <Alert
                      message={error}
                      type="error"
                      closable
                      onClose={() => setError('')}
                    />
                  )}
                </Space>
              </div>
            )}

            {activeTab === 'custom' && (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Form layout="vertical" style={{ marginTop: 8 }}>
                  <Form.Item label={t('addModelModal.modelName')} required>
                    <Input
                      placeholder={t('addModelModal.inputCustomModelName')}
                      value={customName}
                      onChange={(e) => { setCustomName(e.target.value); setCustomError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label={t('addModelModal.modelFolder')} required extra={t('addModelModal.modelFolderHint')}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder={t('addModelModal.inputModelFolderPath')}
                        value={customPath}
                        onChange={(e) => { setCustomPath(e.target.value); setCustomError(''); }}
                      />
                      <Button
                        icon={<FolderOpenOutlined />}
                        loading={browseLoading}
                        onClick={handleBrowseFolder}
                      >
                        {t('addModelModal.browse')}
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                  <Form.Item label={t('addModelModal.modelDescription')}>
                    <Input.TextArea
                      placeholder={t('addModelModal.inputDescription')}
                      rows={3}
                      value={customDesc}
                      onChange={(e) => setCustomDesc(e.target.value)}
                    />
                  </Form.Item>
                </Form>
                {customError && (
                  <Alert
                    message={customError}
                    type="error"
                    closable
                    onClose={() => setCustomError('')}
                  />
                )}
                <Button
                  type="primary"
                  block
                  loading={customLoading}
                  onClick={handleAddCustomModel}
                >
                  {t('addModelModal.confirmAdd')}
                </Button>
              </Space>
            )}
            {activeTab === 'cloudapi' && (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Form layout="vertical" style={{ marginTop: 8 }}>
                  <Form.Item label={t('addModelModal.modelName')} required>
                    <Input
                      placeholder={t('addModelModal.inputModelName')}
                      value={cloudName}
                      onChange={(e) => { setCloudName(e.target.value); setCloudError(''); setCloudTested(false); }}
                    />
                  </Form.Item>
                  <Form.Item label={t('addModelModal.cloudPlatformName')} required>
                    <Select
                      placeholder={t('addModelModal.selectCloudPlatform')}
                      value={cloudPlatform}
                      onChange={(val) => {
                        setCloudPlatform(val);
                        setCloudError('');
                        const found = CLOUD_PLATFORMS.find(p => p.value === val);
                        setCloudApiUrl(found?.url || '');
                      }}
                      style={{ width: '100%' }}
                    >
                      {CLOUD_PLATFORMS.map(p => (
                        <Option key={p.value} value={p.value}>{p.label}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item label={t('addModelModal.apiBaseUrl')} required>
                    <Input
                      placeholder={t('addModelModal.inputApiBaseUrl')}
                      value={cloudApiUrl}
                      onChange={(e) => { setCloudApiUrl(e.target.value); setCloudError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label={t('addModelModal.apiKey')} required>
                    <Input.Password
                      placeholder={t('addModelModal.inputApiKey')}
                      value={cloudApiKey}
                      onChange={(e) => { setCloudApiKey(e.target.value); setCloudError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label={t('addModelModal.apiModelId')} required>
                    <Input
                      placeholder={t('addModelModal.inputApiModelId')}
                      value={cloudApiModel}
                      onChange={(e) => { setCloudApiModel(e.target.value); setCloudError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label={t('addModelModal.modelDescription')}>
                    <Input.TextArea
                      placeholder={t('addModelModal.inputDescription')}
                      rows={2}
                      value={cloudDesc}
                      onChange={(e) => { setCloudDesc(e.target.value); setCloudTested(false); }}
                    />
                  </Form.Item>
                </Form>
                {cloudError && (
                  <Alert
                    message={cloudError}
                    type="error"
                    closable
                    onClose={() => setCloudError('')}
                  />
                )}
                {cloudTested && (
                  <Alert
                    message={t('addModelModal.cloudTestPassed')}
                    type="success"
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                )}

                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button
                    type="default"
                    block
                    loading={cloudTestLoading}
                    onClick={handleTestCloudApiConnection}
                  >
                    {t('addModelModal.testConnection')}
                  </Button>
                  <Button
                    type="primary"
                    block
                    loading={cloudLoading}
                    onClick={handleAddCloudApiModel}
                  >
                    {t('addModelModal.confirmAdd')}
                  </Button>
                </Space>
              </Space>
            )}
          </>
        )}
        </Modal>
      )}

      {/* 预览对话框 */}
      <ModelPreviewDialog
        visible={previewVisible}
        preview={previewData}
        config={previewConfig}
        onConfirm={handleConfirmModel}
        onCancel={() => setPreviewVisible(false)}
      />
    </>
  );
}

export default AddModelModal;
