import React, { useMemo } from 'react';
import { Modal, Tabs, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { message } from 'antd';

const { Text, Title } = Typography;

const TTS_BASE = 'http://127.0.0.1:15050';
const ASR_BASE = 'http://127.0.0.1:3001';

const codeStyle = {
  background: '#1e1e1e',
  color: '#d4d4d4',
  padding: '12px 16px',
  borderRadius: 6,
  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.7,
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
  margin: '8px 0 16px 0',
  position: 'relative',
};

const copyBtnStyle = {
  position: 'absolute',
  top: 8,
  right: 8,
  cursor: 'pointer',
  color: '#888',
  fontSize: 14,
};

const labelStyle = { fontWeight: 600, display: 'block', marginTop: 12, marginBottom: 4 };

function CodeBlock({ code }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => message.success('已复制'));
  };
  return (
    <div style={codeStyle}>
      <CopyOutlined style={copyBtnStyle} onClick={handleCopy} />
      {code}
    </div>
  );
}

function ParamTable({ params }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #f0f0f0', textAlign: 'left' }}>
          <th style={{ padding: '4px 8px' }}>参数</th>
          <th style={{ padding: '4px 8px' }}>必填</th>
          <th style={{ padding: '4px 8px' }}>说明</th>
        </tr>
      </thead>
      <tbody>
        {params.map(p => (
          <tr key={p.name} style={{ borderBottom: '1px solid #f5f5f5' }}>
            <td style={{ padding: '4px 8px' }}><Text code>{p.name}</Text></td>
            <td style={{ padding: '4px 8px' }}>{p.required ? <span style={{ color: '#ff4d4f' }}>是</span> : '否'}</td>
            <td style={{ padding: '4px 8px' }}>{p.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PortInfo({ port, altPort, note }) {
  return (
    <div style={{ marginBottom: 12, padding: '6px 10px', background: '#f6f8fa', borderRadius: 4, fontSize: 12, lineHeight: 1.6 }}>
      <Text strong>端口：</Text>
      <Text code style={{ fontSize: 12 }}>127.0.0.1:{port}</Text>
      {altPort && (
        <Text type="secondary">（或直连 </Text>
      )}
      {altPort && <Text code style={{ fontSize: 12 }}>127.0.0.1:{altPort}</Text>}
      {altPort && <Text type="secondary">）</Text>}
      {note && <Text type="secondary"> — {note}</Text>}
    </div>
  );
}

export default function ApiUsageModal({ open, onClose, type, context = {} }) {
  const tabItems = useMemo(() => {
    if (type === 'tts') {
      const modelId = context.modelId || '<model_id>';
      const voiceId = context.voiceId || '<voice_id>';
      const isClone = context.isCloneMode !== false;

      const curlCode = isClone
        ? `curl -X POST ${TTS_BASE}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelId}",
    "input": "你好，世界",
    "voice": "${voiceId}",
    "response_format": "wav"
  }' \\
  --output speech.wav`
        : `curl -X POST ${TTS_BASE}/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelId}",
    "input": "你好，世界",
    "response_format": "wav"
  }' \\
  --output speech.wav`;

      const pyCode = isClone
        ? `import requests

resp = requests.post("${TTS_BASE}/v1/audio/speech", json={
    "model": "${modelId}",
    "input": "你好，世界",
    "voice": "${voiceId}",
    "response_format": "wav"
})
with open("speech.wav", "wb") as f:
    f.write(resp.content)`
        : `import requests

resp = requests.post("${TTS_BASE}/v1/audio/speech", json={
    "model": "${modelId}",
    "input": "你好，世界",
    "response_format": "wav"
})
with open("speech.wav", "wb") as f:
    f.write(resp.content)`;

      const jsCode = isClone
        ? `const resp = await fetch("${TTS_BASE}/v1/audio/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "${modelId}",
    input: "你好，世界",
    voice: "${voiceId}",
    response_format: "wav"
  })
});
const blob = await resp.blob();
// 播放或下载 blob`
        : `const resp = await fetch("${TTS_BASE}/v1/audio/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "${modelId}",
    input: "你好，世界",
    response_format: "wav"
  })
});
const blob = await resp.blob();
// 播放或下载 blob`;

      const ttsParams = [
        { name: 'model', required: true, desc: '工作区 Model ID（在工作区信息卡片中可复制）' },
        { name: 'input', required: true, desc: '要合成的文本，最大 4096 字符' },
        { name: 'voice', required: isClone, desc: isClone ? 'NovaMax Voice ID（clone 模式必填，上传参考音频自动生成）' : 'NovaMax Voice ID（当前工作区非 clone 模式，此参数可选）' },
        { name: 'response_format', required: false, desc: '输出格式：wav（默认）、mp3、flac、opus' },
        { name: 'speed', required: false, desc: '语速，范围 0.25 ~ 4.0，默认 1.0' },
      ];

      return [
        {
          key: 'curl',
          label: 'cURL',
          children: (
            <div>
              <PortInfo port={15050} altPort={3001} note="推荐 15050（网关代理，自动排队），调试可用 3001（直连）" />
              <Text style={labelStyle}>POST {TTS_BASE}/v1/audio/speech</Text>
              <CodeBlock code={curlCode} />
              <Text>响应直接返回原始音频二进制流，Content-Type 为 audio/wav（或其他指定格式）。</Text>
            </div>
          ),
        },
        {
          key: 'python',
          label: 'Python',
          children: (
            <div>
              <PortInfo port={15050} altPort={3001} note="推荐 15050（网关代理，自动排队），调试可用 3001（直连）" />
              <Text style={labelStyle}>POST {TTS_BASE}/v1/audio/speech</Text>
              <CodeBlock code={pyCode} />
              <Text>响应直接返回原始音频二进制流。</Text>
            </div>
          ),
        },
        {
          key: 'javascript',
          label: 'JavaScript',
          children: (
            <div>
              <PortInfo port={15050} altPort={3001} note="推荐 15050（网关代理，自动排队），调试可用 3001（直连）" />
              <Text style={labelStyle}>POST {TTS_BASE}/v1/audio/speech</Text>
              <CodeBlock code={jsCode} />
              <Text>响应为 blob，可直接用于播放或下载。</Text>
            </div>
          ),
        },
        {
          key: 'params',
          label: '参数说明',
          children: (
            <div>
              <ParamTable params={ttsParams} />
              <div style={{ marginTop: 16, padding: '8px 12px', background: '#fffbe6', borderRadius: 4, fontSize: 13 }}>
                <Text strong>其他端点：</Text>
                <div style={{ marginTop: 4 }}>• <Text code>GET {TTS_BASE}/v1/audio/models</Text> — 列出可用模型</div>
                <div>• <Text code>GET {TTS_BASE}/v1/audio/voices</Text> — 列出所有 Voice ID</div>
                <div>• <Text code>GET {TTS_BASE}/v1/health</Text> — 健康检查</div>
              </div>
            </div>
          ),
        },
      ];
    }

    // ASR
    const modelName = context.modelName || '<model_name>';
    const asrParams = [
      { name: 'file', required: true, desc: '音频文件（multipart/form-data），支持 mp3 / wav / flac / m4a / ogg / webm，最大 500MB' },
      { name: 'model', required: true, desc: 'ASR 模型名称或 ID。调用 GET /v1/audio/models 获取' },
      { name: 'language', required: false, desc: '语言代码：zh / en / ja / ko / auto 等，默认 auto（自动检测）' },
      { name: 'response_format', required: false, desc: '输出格式：json（默认）、text、srt、vtt、verbose_json' },
      { name: 'temperature', required: false, desc: '采样温度，0~1，默认 0' },
      { name: 'prompt', required: false, desc: '引导文本，用于提示模型特定词汇的写法' },
      { name: 'stream', required: false, desc: '是否开启流式输出（SSE），默认 false' },
    ];

    return [
      {
        key: 'curl',
        label: 'cURL',
        children: (
          <div>
            <PortInfo port={3001} note="ASR 当前仅支持直连 3001 端口" />
            <Text style={labelStyle}>POST {ASR_BASE}/v1/audio/transcriptions</Text>
            <CodeBlock code={`curl -X POST ${ASR_BASE}/v1/audio/transcriptions \\
  -F "file=@audio.mp3" \\
  -F "model=${modelName}" \\
  -F "language=zh"`} />
            <Text>响应为 JSON 格式：</Text>
            <CodeBlock code={`{"text": "转录结果文本", "model": "${modelName}"}`} />
          </div>
        ),
      },
      {
        key: 'python',
        label: 'Python',
        children: (
          <div>
            <PortInfo port={3001} note="ASR 当前仅支持直连 3001 端口" />
            <Text style={labelStyle}>POST {ASR_BASE}/v1/audio/transcriptions</Text>
            <CodeBlock code={`import requests

with open("audio.mp3", "rb") as f:
    resp = requests.post("${ASR_BASE}/v1/audio/transcriptions",
        files={"file": f},
        data={"model": "${modelName}", "language": "zh"})

print(resp.json())
# {"text": "转录结果文本", "model": "${modelName}"}`} />
          </div>
        ),
      },
      {
        key: 'javascript',
        label: 'JavaScript',
        children: (
          <div>
            <PortInfo port={3001} note="ASR 当前仅支持直连 3001 端口" />
            <Text style={labelStyle}>POST {ASR_BASE}/v1/audio/transcriptions</Text>
            <CodeBlock code={`const fd = new FormData();
fd.append("file", audioBlob);
fd.append("model", "${modelName}");
fd.append("language", "zh");

const resp = await fetch("${ASR_BASE}/v1/audio/transcriptions", {
  method: "POST",
  body: fd
});
const data = await resp.json();
console.log(data.text);`} />
          </div>
        ),
      },
      {
        key: 'params',
        label: '参数说明',
        children: (
          <div>
            <ParamTable params={asrParams} />
            <div style={{ marginTop: 16, padding: '8px 12px', background: '#fffbe6', borderRadius: 4, fontSize: 13 }}>
              <Text strong>另外：</Text>
              <div style={{ marginTop: 4 }}>• 模型列表： <Text code>GET {ASR_BASE}/v1/audio/models</Text></div>
            </div>
          </div>
        ),
      },
    ];
  }, [type, context]);

  const title = type === 'tts' ? 'TTS API 调用说明' : 'ASR API 调用说明';
  const subtitle = type === 'tts'
    ? 'OpenAI 兼容格式的 TTS（语音合成）API'
    : 'OpenAI 兼容格式的 ASR（语音识别）API';

  return (
    <Modal
      title={<span>{title} <Text type="secondary" style={{ fontSize: 13, fontWeight: 'normal' }}>— {subtitle}</Text></span>}
      open={open}
      onCancel={onClose}
      width={700}
      footer={null}
      destroyOnClose
    >
      <Tabs items={tabItems} />
    </Modal>
  );
}
