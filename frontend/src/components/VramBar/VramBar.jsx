import React from 'react';
import { Tooltip } from 'antd';

/**
 * 紧凑显存状态条。
 * 分子 = 专用显存已用 + 共享显存已用
 * 分母 = 专用显存总量 + 共享显存总量
 * 单位: GB
 */
function VramBar({ gpu, compact }) {
  if (!gpu || !gpu.total || gpu.total <= 0) return null;

  const dedTotalGB = Number(gpu.total) / (1024 * 1024 * 1024);
  const dedUsedGB = Number(gpu.used || 0) / (1024 * 1024 * 1024);
  const shrTotalGB = (gpu.shared_total || 0) / (1024 * 1024 * 1024);
  const shrUsedGB = (gpu.shared_used || 0) / (1024 * 1024 * 1024);

  // 优先使用后端预计算的总值（字节），回退到手动计算（已是 GB）
  const hasShared = shrTotalGB > 0 || (gpu.total_avail || 0) > (gpu.total || 0);
  const displayTotal = hasShared
    ? (gpu.total_avail ? gpu.total_avail / (1024 * 1024 * 1024) : (dedTotalGB + shrTotalGB))
    : dedTotalGB;
  const displayUsed = hasShared
    ? (gpu.total_used != null ? gpu.total_used / (1024 * 1024 * 1024) : (dedUsedGB + shrUsedGB))
    : dedUsedGB;
  const pct = displayTotal > 0 ? Math.min(100, Math.round((displayUsed / displayTotal) * 100)) : 0;

  const color = pct > 90 ? '#ff4d4f' : pct > 70 ? '#faad14' : '#52c41a';

  const tooltip = (
    <div>
      <div>专用显存: {dedUsedGB.toFixed(1)} / {dedTotalGB.toFixed(1)} GB</div>
      {hasShared && (
        <div>共享显存: {shrUsedGB.toFixed(1)} / {shrTotalGB.toFixed(1)} GB</div>
      )}
      <div style={{ marginTop: 4, fontWeight: 600 }}>
        合计: {displayUsed.toFixed(1)} / {displayTotal.toFixed(1)} GB ({pct}%)
      </div>
    </div>
  );

  if (compact) {
    return (
      <Tooltip title={tooltip}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
          <div style={{
            width: 60, height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden'
          }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: 4,
              background: color, transition: 'width 0.5s'
            }} />
          </div>
          <span style={{ fontSize: 11, color: '#888' }}>{displayUsed.toFixed(1)}/{displayTotal.toFixed(1)}G</span>
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltip}>
      <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
          <span>显存</span>
          <span>{displayUsed.toFixed(1)} / {displayTotal.toFixed(1)} GB</span>
        </div>
        <div style={{
          height: 6, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden'
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 3,
            background: color, transition: 'width 0.5s'
          }} />
        </div>
      </div>
    </Tooltip>
  );
}

export default VramBar;
