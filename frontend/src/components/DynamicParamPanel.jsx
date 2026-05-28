/**
 * DynamicParamPanel — 根据引擎 ParamDef[] 动态渲染参数控件
 *
 * 完全通用，不包含任何引擎特定的参数名或分组逻辑。
 * 所有参数按 contract.json 声明原样渲染。
 */
import React from 'react';
import { Slider, Switch, Select, Input, Typography, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

function renderControl(def, value, onChange, disabled) {
  switch (def.widget) {
    case 'slider':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Slider
            style={{ flex: 1, margin: 0 }}
            min={def.min ?? 0}
            max={def.max ?? 100}
            step={def.step ?? 1}
            value={value ?? def.default}
            onChange={(v) => onChange(def.key, v)}
            disabled={disabled}
            tooltip={{ formatter: (v) => def.type === 'float' ? v?.toFixed(2) : v }}
          />
          <Text style={{ minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: '#666' }}>
            {def.type === 'float' ? (value ?? def.default)?.toFixed(2) : (value ?? def.default)}
          </Text>
        </div>
      );

    case 'toggle':
      return (
        <Switch
          size="small"
          checked={value ?? def.default}
          onChange={(v) => onChange(def.key, v)}
          disabled={disabled}
        />
      );

    case 'select':
      return (
        <Select
          size="small"
          style={{ width: '100%' }}
          value={value ?? def.default}
          onChange={(v) => onChange(def.key, v)}
          options={def.options || []}
          disabled={disabled}
        />
      );

    case 'text':
      return (
        <Input
          size="small"
          style={{ width: '100%' }}
          value={value ?? ''}
          onChange={(e) => onChange(def.key, e.target.value)}
          placeholder={def.placeholder}
          disabled={disabled}
        />
      );

    default:
      return <Text type="secondary" style={{ fontSize: 12 }}>{def.widget}</Text>;
  }
}

export default function DynamicParamPanel({ definitions, values = {}, onChange, disabled = false }) {
  if (!definitions || definitions.length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>无可用参数</Text>;
  }

  const emitChange = (key, v) => {
    onChange({ ...values, [key]: v });
  };

  const visibleDefs = definitions.filter(def => {
    if (!def.visible_when) return true;
    const { key, value } = def.visible_when;
    return values[key] === value;
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
      {visibleDefs.map(def => {
        const label = (
          <span style={{ fontSize: 12, color: '#666' }}>
            {def.label}
            {def.description && (
              <Tooltip title={def.description}>
                <QuestionCircleOutlined style={{ marginLeft: 4, color: '#bbb', fontSize: 11 }} />
              </Tooltip>
            )}
          </span>
        );

        if (def.widget === 'toggle') {
          return (
            <div key={def.key} style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
              {label}
              {renderControl(def, values[def.key], emitChange, disabled)}
            </div>
          );
        }

        return (
          <div key={def.key}>
            <div style={{ marginBottom: 2 }}>{label}</div>
            {renderControl(def, values[def.key], emitChange, disabled)}
          </div>
        );
      })}
    </div>
  );
}
