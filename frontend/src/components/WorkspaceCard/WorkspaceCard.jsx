/**
 * 工作区卡片组件 — 与 ModelCard 风格统一
 */
import React, { useState } from 'react';
import { Card, Button, Popconfirm, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import { ENGINE_STATUS_MAP } from '../../utils/engineStatus';

const { Text } = Typography;

function WorkspaceCard({ workspace, onOpen, onClone, onDelete }) {
  const indicator = workspace.indicator || { status: 'idle', reason: '', canOpen: true };
  const ind = ENGINE_STATUS_MAP[indicator.status] || ENGINE_STATUS_MAP.idle;
  const [hovered, setHovered] = useState(false);

  return (
    <Card
      style={{ height: '100%', minHeight: 200 }}
      bodyStyle={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {/* 可点击主体 */}
      <div
        onClick={() => indicator.canOpen && onOpen?.(workspace)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ flex: 1, padding: 16, cursor: indicator.canOpen ? 'pointer' : 'default', position: 'relative', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: ind.color, flexShrink: 0, marginTop: 5,
            boxShadow: indicator.status === 'running' ? `0 0 6px ${ind.color}` : 'none',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
              {workspace.name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
              <div>引擎：{workspace.engine_name || workspace.engine_type}</div>
              <div>Model：{workspace.model_id
                ? <span onClick={e => e.stopPropagation()}><Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{workspace.model_id}</Text></span>
                : <Text type="secondary" style={{ fontSize: 12 }}>未分配</Text>
              }</div>
              <div>创建：{workspace.created_at ? new Date(workspace.created_at).toLocaleDateString() : '—'}</div>
            </div>
          </div>
        </div>

        {indicator.status === 'error' && (
          <div style={{ fontSize: 12, color: ENGINE_STATUS_MAP.error.color, marginTop: 8 }}>
            {indicator.reason || '引擎异常'}
          </div>
        )}

        {/* hover 遮罩 */}
        {hovered && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(24, 144, 255, 0.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>打开</span>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '8px 16px', display: 'flex', gap: 4 }}>
        <Button size="small" block icon={<CopyOutlined />} onClick={() => onClone?.(workspace)}>克隆</Button>
        <Popconfirm title="确定删除此工作区？" onConfirm={() => onDelete?.(workspace)}>
          <Button size="small" block danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </div>
    </Card>
  );
}

export default WorkspaceCard;
