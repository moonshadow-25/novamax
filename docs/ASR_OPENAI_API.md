# NovaMax ASR API

NovaMax 提供兼容 OpenAI Whisper 格式的语音识别接口。

---

## 端口说明

| 端口 | 方式 | 说明 |
|------|------|------|
| **3001** | 直连 NovaMax 后端 | ASR 当前仅支持直连 |
| **15050** | NovaAirouter 网关 | ASR 端点暂未注册到网关，不可用 |

---

## 端点

### POST /v1/audio/transcriptions

语音转文字，上传音频文件返回转录文本。

**Content-Type**: `multipart/form-data`

**请求体**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | 音频文件。支持 mp3 / wav / flac / m4a / ogg / webm / mpeg / mpga，最大 500MB |
| `model` | string | 是 | ASR 模型名称。调用 `GET /v1/audio/models` 获取，`type` 为 `"asr"` 的条目即为可用模型 |
| `language` | string | 否 | 源语言。`zh` / `en` / `ja` / `ko` / `auto` 等，默认 `auto` |
| `response_format` | string | 否 | 输出格式：`json` / `text` / `srt` / `vtt` / `verbose_json`，默认 `json` |
| `temperature` | number | 否 | 采样温度，0 ~ 1，默认 0 |
| `prompt` | string | 否 | 引导文本，帮助模型识别专有名词 |
| `stream` | boolean | 否 | 是否流式返回（SSE），默认 `false` |

**成功响应 (200)**

`json`：
```json
{ "text": "转录结果文本", "model": "qwen3-asr" }
```

`text`：
```
转录结果文本
```

`srt`：
```srt
1
00:00:00,000 --> 00:00:02,500
第一段文本

2
00:00:02,500 --> 00:00:05,000
第二段文本
```

`vtt`：
```vtt
WEBVTT

00:00:00.000 --> 00:00:02.500
第一段文本

00:00:02.500 --> 00:00:05.000
第二段文本
```

`verbose_json`：
```json
{
  "text": "完整文本",
  "language": "zh",
  "segments": [
    { "text": "第一段", "start": 0.0, "end": 2.5 },
    { "text": "第二段", "start": 2.5, "end": 5.0 }
  ]
}
```

**错误响应**

```json
{
  "error": {
    "message": "模型未找到",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

---

### GET /v1/audio/models

列出所有可用模型。`type` 为 `"asr"` 的条目即 ASR 模型。

```
GET http://127.0.0.1:3001/v1/audio/models
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen3-asr",
      "object": "model",
      "created": 1717512345,
      "owned_by": "novamax",
      "type": "asr",
      "language": "auto"
    }
  ]
}
```

---

## 调用示例

### cURL

```bash
# 基本转录
curl -X POST http://127.0.0.1:3001/v1/audio/transcriptions \
  -F "file=@recording.mp3" \
  -F "model=qwen3-asr" \
  -F "language=zh"

# 纯文本输出
curl -X POST http://127.0.0.1:3001/v1/audio/transcriptions \
  -F "file=@recording.wav" \
  -F "model=qwen3-asr" \
  -F "response_format=text"

# 生成 SRT 字幕
curl -X POST http://127.0.0.1:3001/v1/audio/transcriptions \
  -F "file=@video.mp3" \
  -F "model=qwen3-asr" \
  -F "language=zh" \
  -F "response_format=srt" \
  --output subtitle.srt

# 带提示词
curl -X POST http://127.0.0.1:3001/v1/audio/transcriptions \
  -F "file=@meeting.mp3" \
  -F "model=qwen3-asr" \
  -F "prompt=NovaMax IndeTTS Qwen3"
```

### Python

```python
import requests

with open("recording.mp3", "rb") as f:
    resp = requests.post(
        "http://127.0.0.1:3001/v1/audio/transcriptions",
        files={"file": f},
        data={"model": "qwen3-asr", "language": "zh"}
    )

print(resp.json()["text"])
```

### JavaScript

```javascript
const fd = new FormData();
fd.append("file", audioBlob, "audio.mp3");
fd.append("model", "qwen3-asr");
fd.append("language", "zh");

const resp = await fetch("http://127.0.0.1:3001/v1/audio/transcriptions", {
  method: "POST",
  body: fd
});
const { text } = await resp.json();
console.log(text);
```

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3001/v1",
    api_key="any-value"
)

with open("recording.mp3", "rb") as f:
    transcript = client.audio.transcriptions.create(
        model="qwen3-asr",
        file=f,
        language="zh"
    )

print(transcript.text)
```

---

## 流式转录

设置 `stream=true` 启用 SSE 流式返回，逐步输出识别文本。

> 需引擎支持（取决于 contract.json 中 `capabilities.supports_streaming`）。

**请求**：
```bash
curl -X POST http://127.0.0.1:3001/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "model=qwen3-asr" \
  -F "stream=true"
```

**SSE 响应**：
```
data: {"text": "你好"}

data: {"text": "你好，欢迎使用"}

data: [DONE]
```

**JavaScript 消费**：
```javascript
const reader = resp.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  for (const line of buffer.split("\n")) {
    if (line.startsWith("data: ") && !line.includes("[DONE]")) {
      const { text } = JSON.parse(line.slice(6));
      console.log(text);
    }
  }
  buffer = buffer.split("\n").pop();
}
```

---

## 来源标记

通过 `Authorization` 头标记调用来源（非鉴权），仅影响历史记录显示：

| Header | 含义 |
|--------|------|
| `Bearer novamax-manual` | 手动输入 |
| `Bearer novamax-file` | 批量文件处理 |
| 不传 | 外部调用 |

---

## 常见问题

**Q: model 参数从哪里获取？**
调用 `GET http://127.0.0.1:3001/v1/audio/models`，取 `type` 为 `"asr"` 的条目的 `id` 字段。

**Q: 支持哪些语言？**
取决于所装引擎。Qwen3-ASR 支持 30+ 种语言。设 `language=auto` 可自动检测。

**Q: 文件大小限制？**
最大 500MB，最长 2 小时。

**Q: OpenAI SDK 能用吗？**
可以。`base_url` 设为 `http://127.0.0.1:3001/v1`，`api_key` 填任意值。

**Q: 为什么 15050 端口不能用于 ASR？**
ASR 端点暂未注册到 NovaAirouter 网关。如需网关代理，可在 `novaAirouterRegistrar.js` 中添加 ASR 端点注册。
