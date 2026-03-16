import React, { useState, useEffect } from 'react';
import { Select, Button, Drawer, List, Tag, Space, Popconfirm, message } from 'antd';
import { SettingOutlined, StarFilled, StarOutlined, DeleteOutlined } from '@ant-design/icons';
import { engineService } from '../../services/api';

/**
 * 引擎版本选择器组件
 * 支持版本切换和管理
 */
const EngineVersionSelector = ({ engineId, onChange }) => {
  const [versions, setVersions] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadVersions();
  }, [engineId]);

  const loadVersions = async () => {
    try {
      const result = await engineService.getVersions(engineId);
      setVersions(result.versions);

      // 找到默认版本
      const defaultVer = result.versions.find(v => v.is_default);
      if (defaultVer) {
        setCurrentVersion(defaultVer.version);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
  };

  const handleVersionChange = async (version) => {
    try {
      setLoading(true);
      await engineService.setDefaultVersion(engineId, version);
      setCurrentVersion(version);
      await loadVersions();
      onChange?.(version);
      message.success('版本切换成功');
    } catch (error) {
      message.error('版本切换失败');
      console.error('Failed to change version:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async (version) => {
    try {
      setLoading(true);
      await engineService.uninstall(engineId, version);
      await loadVersions();
      message.success('卸载成功');
    } catch (error) {
      message.error('卸载失败');
      console.error('Failed to uninstall:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (version) => {
    await handleVersionChange(version);
    setDrawerVisible(false);
  };

  if (versions.length === 0) {
    return null;
  }

  return (
    <>
      <Space>
        <Select
          value={currentVersion}
          onChange={handleVersionChange}
          loading={loading}
          style={{ width: 200 }}
          options={versions.map(v => ({
            label: `${v.version}${v.is_default ? ' (默认)' : ''}`,
            value: v.version
          }))}
        />
        <Button
          icon={<SettingOutlined />}
          onClick={() => setDrawerVisible(true)}
        >
          管理版本
        </Button>
      </Space>

      <Drawer
        title="版本管理"
        placement="right"
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        width={400}
      >
        <List
          dataSource={versions}
          renderItem={item => (
            <List.Item
              actions={[
                item.is_default ? (
                  <Tag color="blue" icon={<StarFilled />}>默认</Tag>
                ) : (
                  <Button
                    type="link"
                    size="small"
                    icon={<StarOutlined />}
                    onClick={() => handleSetDefault(item.version)}
                  >
                    设为默认
                  </Button>
                ),
                <Popconfirm
                  title="确定要卸载此版本吗？"
                  onConfirm={() => handleUninstall(item.version)}
                  okText="确定"
                  cancelText="取消"
                  disabled={item.is_default}
                >
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={item.is_default}
                  >
                    卸载
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                title={item.version}
                description={`安装于 ${new Date(item.installed_at).toLocaleString()}`}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
};

export default EngineVersionSelector;
