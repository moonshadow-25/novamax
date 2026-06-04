import React, { useState, useEffect } from 'react';
import { Select, Button, Drawer, List, Tag, Space, Popconfirm, message } from 'antd';
import { SettingOutlined, StarFilled, StarOutlined, DeleteOutlined } from '@ant-design/icons';
import { engineService } from '../../services/api';
import { useTranslation } from 'react-i18next';

/**
 * 引擎版本选择器组件
 * 支持版本切换和管理
 */
const EngineVersionSelector = ({ engineId, onChange }) => {
  const { t } = useTranslation('home');
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
      message.success(t('engineVersionSelector.switchSuccess'));
    } catch (error) {
      message.error(t('engineVersionSelector.switchFailed'));
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
      message.success(t('engineVersionSelector.uninstallSuccess'));
    } catch (error) {
      message.error(t('engineVersionSelector.uninstallFailed'));
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
            label: `${v.version}${v.is_default ? ` (${t('engineVersionSelector.default')})` : ''}`,
            value: v.version
          }))}
        />
        <Button
          icon={<SettingOutlined />}
          onClick={() => setDrawerVisible(true)}
        >
          {t('engineVersionSelector.manageVersions')}
        </Button>
      </Space>

      <Drawer
        title={t('engineVersionSelector.versionManagement')}
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
                  <Tag color="blue" icon={<StarFilled />}>{t('engineVersionSelector.default')}</Tag>
                ) : (
                  <Button
                    type="link"
                    size="small"
                    icon={<StarOutlined />}
                    onClick={() => handleSetDefault(item.version)}
                  >
                    {t('engineVersionSelector.setAsDefault')}
                  </Button>
                ),
                <Popconfirm
                  title={t('engineVersionSelector.confirmUninstallVersion')}
                  onConfirm={() => handleUninstall(item.version)}
                  okText={t('settingsDrawer.confirm')}
                  cancelText={t('settingsDrawer.cancel')}
                  disabled={item.is_default}
                >
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={item.is_default}
                  >
                    {t('engineVersionSelector.uninstall')}
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                title={item.version}
                description={t('engineVersionSelector.installedAt', { time: new Date(item.installed_at).toLocaleString() })}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
};

export default EngineVersionSelector;
