import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Input, List, Button, message, Radio, Space, Alert, Typography, Tag, Form, Select } from 'antd';
import { SearchOutlined, LinkOutlined, LoadingOutlined, DownOutlined, UpOutlined, FolderOpenOutlined, CloudOutlined } from '@ant-design/icons';
import { modelscopeService, modelService, systemService } from '../../services/api';
import ModelPreviewDialog from './ModelPreviewDialog';
import AddWorkflowTab from './AddWorkflowTab';
import AddWhisperModal from './AddWhisperModal';

const { Text } = Typography;
const { Option } = Select;

// 初始显示的搜索结果数量
const INITIAL_DISPLAY_COUNT = 8;

function AddModelModal({ visible, type, onClose, onSuccess }) {
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
    { label: '阿里云百炼', value: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { label: '文心一言', value: '文心一言', url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1' },
    { label: '豆包', value: '豆包', url: 'https://ark.cn-beijing.volces.com/api/v3' },
    { label: '智谱开放平台', value: '智谱开放平台', url: 'https://open.bigmodel.cn/api/paas/v4' },
    { label: '腾讯混元', value: '腾讯混元', url: 'https://api.hunyuan.cloud.tencent.com/v1' },
    { label: '硅基流动', value: '硅基流动', url: 'https://api.siliconflow.cn/v1' },
    { label: '深度求索', value: '深度求索', url: 'https://api.deepseek.com/v1' },
    { label: '月之暗面', value: '月之暗面', url: 'https://api.moonshot.cn/v1' },
    { label: '其他', value: '其他', url: '' },
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
      return 'URL 不能为空';
    }
    if (!url.includes('modelscope.cn/models/')) {
      return 'URL 必须是 ModelScope 模型链接';
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
        setError(response.error || '解析失败');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || '解析 URL 失败';
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
          setError('未找到匹配的模型');
        }
      } else {
        setError(response.error || '搜索失败');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || '搜索失败';
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
        message.success('模型添加成功');
        setPreviewVisible(false);
        handleClose();
        if (onSuccess) {
          onSuccess(response.model);
        }
      } else {
        message.error(response.error || '保存模型失败');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || '保存模型失败';
      message.error(errorMsg);
    }
  };

  // 云 API 连接测试
  const handleTestCloudApiConnection = async () => {
    if (!cloudName.trim()) { setCloudError('模型名称不能为空'); return false; }
    if (!cloudPlatform) { setCloudError('请选择云平台'); return false; }
    if (!cloudApiUrl.trim()) { setCloudError('API基础URL不能为空'); return false; }
    if (!cloudApiKey.trim()) { setCloudError('API密钥不能为空'); return false; }
    if (!cloudApiModel.trim()) { setCloudError('API模型标识不能为空'); return false; }

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
        message.success('云API连接测试成功');
        return true;
      }

      setCloudError(response.error || '连接测试失败');
      return false;
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || '连接测试失败';
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
        message.success('云API模型添加成功');
        handleClose();
        if (onSuccess) onSuccess(response.model);
      } else {
        setCloudError(response.error || '添加失败');
      }
    } catch (err) {
      setCloudError(err.response?.data?.error || err.message || '添加失败');
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
      message.error('打开文件夹选择器失败');
    } finally {
      setBrowseLoading(false);
    }
  };

  // 添加自定义模型
  const handleAddCustomModel = async () => {
    if (!customName.trim()) {
      setCustomError('模型名称不能为空');
      return;
    }
    if (!customPath.trim()) {
      setCustomError('请选择模型文件夹');
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
        message.success('自定义模型添加成功');
        handleClose();
        if (onSuccess) onSuccess(response.model);
      } else {
        setCustomError(response.error || '添加失败');
      }
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || '添加失败';
      setCustomError(errMsg);
    } finally {
      setCustomLoading(false);
    }
  };

  return (
    <>
      {type === 'whisper' ? (
        <AddWhisperModal
          visible={visible}
          onClose={handleClose}
          onSuccess={onSuccess}
        />
      ) : (
        <Modal
          title="添加新模型"
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
                message.success('工作流添加成功');
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
                  { key: 'modelscope', label: 'ModelScope' },
                  { key: 'custom', label: '自定义' },
                  { key: 'cloudapi', label: '云API' },
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
                    <Radio.Button value="search">名称搜索</Radio.Button>
                    <Radio.Button value="url">URL 输入</Radio.Button>
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
                        解析 URL
                      </Button>
                    </Space.Compact>
                  )}

                  {/* 搜索模式 */}
                  {inputMode === 'search' && (
                    <>
                      <Input
                        placeholder="输入模型名称 (例如: Qwen3.5) - 自动搜索"
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
                                找到 {totalCount} 个模型
                                {searchResults.length < totalCount && ` (显示前 30 个)`}
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
                                  ? '收起'
                                  : `显示更多 (还有 ${searchResults.length - INITIAL_DISPLAY_COUNT} 个)`
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
                  <Form.Item label="模型名称" required>
                    <Input
                      placeholder="请输入模型显示名称（如：My-Qwen3.5-35B）"
                      value={customName}
                      onChange={(e) => { setCustomName(e.target.value); setCustomError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label="模型文件夹" required extra="选择包含 .gguf 文件的文件夹">
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder="请输入模型文件夹路径（例如：D:\models\Qwen3.5-35B）"
                        value={customPath}
                        onChange={(e) => { setCustomPath(e.target.value); setCustomError(''); }}
                      />
                      <Button
                        icon={<FolderOpenOutlined />}
                        loading={browseLoading}
                        onClick={handleBrowseFolder}
                      >
                        浏览
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                  <Form.Item label="模型说明">
                    <Input.TextArea
                      placeholder="输入模型说明，未输入时显示模型名称（可选）"
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
                  确认添加
                </Button>
              </Space>
            )}
            {activeTab === 'cloudapi' && (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Form layout="vertical" style={{ marginTop: 8 }}>
                  <Form.Item label="模型名称" required>
                    <Input
                      placeholder="请输入模型显示名称（如：qwen-plus）"
                      value={cloudName}
                      onChange={(e) => { setCloudName(e.target.value); setCloudError(''); setCloudTested(false); }}
                    />
                  </Form.Item>
                  <Form.Item label="云平台名称" required>
                    <Select
                      placeholder="请选择云平台"
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
                  <Form.Item label="API基础URL" required>
                    <Input
                      placeholder="请输入自定义API地址"
                      value={cloudApiUrl}
                      onChange={(e) => { setCloudApiUrl(e.target.value); setCloudError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label="API密钥" required>
                    <Input.Password
                      placeholder="请输入API密钥"
                      value={cloudApiKey}
                      onChange={(e) => { setCloudApiKey(e.target.value); setCloudError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label="API模型标识" required>
                    <Input
                      placeholder="请输入API模型标识（如：qwen-plus）"
                      value={cloudApiModel}
                      onChange={(e) => { setCloudApiModel(e.target.value); setCloudError(''); }}
                    />
                  </Form.Item>
                  <Form.Item label="模型说明">
                    <Input.TextArea
                      placeholder="输入模型说明，未输入时显示模型名称（可选）"
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
                    message="连接测试已通过，可直接添加"
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
                    测试连接
                  </Button>
                  <Button
                    type="primary"
                    block
                    loading={cloudLoading}
                    onClick={handleAddCloudApiModel}
                  >
                    确认添加
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
