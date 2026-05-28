/**
 * 引擎卡片组件 — NovaMax 风格
 *
 * 显示每个引擎变体的安装状态:
 *  🟢 绿色 — 已安装
 *  🟡 黄色 — 下载中/暂停/安装中
 *  🔴 红色 — 未安装
 */
import React from 'react';
import { Card, Tag, Progress, Button, Space } from 'antd';
import {
  CheckCircleOutlined, DownloadOutlined, PauseCircleOutlined,
  CloseCircleOutlined, SyncOutlined,
} from '@ant-design/icons';
import { normalizeEngineType } from '../../utils/engineType';

function EngineCard({ variant, engine, onDownload }) {
  const isLocalOnly = Boolean(variant.source === 'local');
  const variantKey = normalizeEngineType(variant.id);

  const installedVersions = (engine.installed_versions || []).filter(v => {
    const ver = normalizeEngineType(v.version);
    return ver.includes(variantKey) || variantKey.includes(ver);
  });
  const hasInstalled = installedVersions.length > 0;
  const latestVersion = variant.versions?.[0]?.version;

  const downloadState = (engine.download_states || []).find(s => {
    const sk = normalizeEngineType(s.targetQuantization || s.id || '');
    return (sk.includes(variantKey) || variantKey.includes(sk)) && ['downloading', 'paused', 'unpacking', 'installing'].includes(s.status);
  });

  let status, statusColor, statusIcon, statusBg;
  if (hasInstalled) {
    status = '已安装'; statusColor = '#52c41a'; statusBg = '#f6ffed';
    statusIcon = <CheckCircleOutlined />;
  } else if (downloadState) {
    if (downloadState.status === 'paused') {
      status = '已暂停'; statusColor = '#faad14'; statusBg = '#fffbe6';
      statusIcon = <PauseCircleOutlined />;
    } else {
      status = downloadState.status === 'unpacking' ? '解压中'
        : downloadState.status === 'installing' ? '安装中' : '下载中';
      statusColor = '#faad14'; statusBg = '#fffbe6';
      statusIcon = <SyncOutlined spin />;
    }
  } else {
    status = '未安装'; statusColor = '#ff4d4f'; statusBg = '#fff2f0';
    statusIcon = <CloseCircleOutlined />;
  }

  return (
    <Card
      size="small"
      hoverable
      style={{ borderLeft: `3px solid ${statusColor}`, background: statusBg, height: '100%' }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 18, marginRight: 8 }}>🎛</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{variant.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{engine.name}{latestVersion ? ` · ${latestVersion}` : ''}</div>
        </div>
        <Tag color={statusColor === '#52c41a' ? 'success' : statusColor === '#faad14' ? 'warning' : 'error'}
             icon={statusIcon}>{status}</Tag>
      </div>

      {hasInstalled && (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          已安装: {installedVersions.map(v => v.version).join(', ')}
        </div>
      )}

      {downloadState && (
        <div style={{ marginBottom: 8 }}>
          <Progress percent={Math.round((downloadState.progress || 0) * 100)} size="small"
            status={downloadState.status === 'paused' ? 'exception' : 'active'} />
        </div>
      )}

      {!hasInstalled && !downloadState && latestVersion && !isLocalOnly && (
        <Button size="small" type="primary" icon={<DownloadOutlined />}
          onClick={() => onDownload(engine.id, latestVersion)}>
          下载引擎
        </Button>
      )}
    </Card>
  );
}

export default EngineCard;
