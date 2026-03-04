import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Input, List, Button, message, Radio, Space, Alert, Typography, Tag } from 'antd';
import { SearchOutlined, LinkOutlined, LoadingOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { modelscopeService } from '../../services/api';
import ModelPreviewDialog from './ModelPreviewDialog';

const { Text } = Typography;

// 初始显示的搜索结果数量
const INITIAL_DISPLAY_COUNT = 8;

function AddModelModal({ visible, type, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('modelscope');
  const [inputMode, setInputMode] = useState('url'); // 'url' | 'search'
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

  // 重置状态
  const resetState = () => {
    setInputMode('url');
    setUrlInput('');
    setSearchQuery('');
    setSearchResults([]);
    setTotalCount(0);
    setShowAllResults(false);
    setError('');
    setPreviewVisible(false);
    setPreviewData(null);
    setPreviewConfig(null);
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
    const url = urlToUse || urlInput;
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

  return (
    <>
      <Modal
        title="添加新模型"
        open={visible}
        onCancel={handleClose}
        footer={null}
        width={700}
        style={{ top: 20 }}
        bodyStyle={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'modelscope', label: 'ModelScope' },
            { key: 'custom', label: '自定义' }
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
                <Radio.Button value="url">URL 输入</Radio.Button>
                <Radio.Button value="search">名称搜索</Radio.Button>
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
          <div>自定义模型功能开发中...</div>
        )}
      </Modal>

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
