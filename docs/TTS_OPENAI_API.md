# NovaMax TTS API

NovaMax 提供兼容 OpenAI TTS 格式的语音合成接口，可通过两个端口访问。

---

## 端口说明

| 端口 | 方式 | 并发控制 | 适用场景 |
|------|------|----------|----------|
| **15050** | 经 NovaAirouter 网关代理 | 是（speech 最多 2 并发） | 推荐。自动排队，避免引擎过载 |
| **3001** | 直连 NovaMax 后端 | 否 | 调试、低负载场景 |

> 两个端口的 API 路径、参数、响应格式完全相同，仅 base URL 端口不同。

---

## 端点

### POST /v1/audio/speech

文本转语音，返回音频二进制数据。

**Content-Type**: `application/json`

**请求体**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 工作区 Model ID（6 位，在工作区信息卡片中获取） |
| `input` | string | 是 | 要合成的文本，最大 4096 字符 |
| `voice` | string | 视模式 | Voice ID（8 位）。clone 模式必填，design/auto 模式可选 |
| `response_format` | string | 否 | 输出格式：`wav` / `mp3` / `flac` / `opus`，默认 `wav` |
| `speed` | number | 否 | 语速，0.25 ~ 4.0，默认 1.0 |

**成功响应 (200)**

- `Content-Type`: `audio/wav`（或对应格式）
- `X-Audio-Duration`: 音频时长（秒）
- Body: 原始音频二进制流

**错误响应**

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error"
  }
}
```

---

### GET /v1/audio/models

列出可用的 TTS 工作区和 ASR 模型。

```
GET /v1/audio/models
```

```json
{
  "object": "list",
  "data": [
    {
      "id": "a1b2c3",
      "object": "model",
      "created": 1717512345,
      "owned_by": "novamax",
      "engine": "indextts15",
      "voice_mode": "clone"
    }
  ]
}
```

---

### GET /v1/audio/voices

列出所有已注册的 Voice ID。

```
GET /v1/audio/voices
```

```json
{
  "object": "list",
  "data": [
    {
      "voice_id": "x1y2z3w4",
      "name": "我的声音",
      "mode": "clone",
      "created_at": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### GET /v1/health

服务健康检查。

```
GET /v1/health
```

```json
{ "status": "ok", "tts_engines": 1 }
```

---

## 调用示例

以下示例使用 15050 端口（推荐）。直连时替换为 3001 即可。

### cURL

```bash
# 基本合成
curl -X POST http://127.0.0.1:15050/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model": "a1b2c3", "input": "你好，世界", "voice": "x1y2z3w4"}' \
  --output speech.wav

# mp3 + 语速调整
curl -X POST http://127.0.0.1:15050/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model": "a1b2c3", "input": "Hello world", "voice": "x1y2z3w4", "response_format": "mp3", "speed": 1.2}' \
  --output speech.mp3
```

### Python

```python
import requests

resp = requests.post("http://127.0.0.1:15050/v1/audio/speech", json={
    "model": "a1b2c3",
    "input": "你好，世界",
    "voice": "x1y2z3w4"
})

if resp.status_code == 200:
    with open("output.wav", "wb") as f:
        f.write(resp.content)
else:
    print(resp.json()["error"]["message"])
```

### JavaScript

```javascript
const resp = await fetch("http://127.0.0.1:15050/v1/audio/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "a1b2c3",
    input: "你好，世界",
    voice: "x1y2z3w4"
  })
});

const blob = await resp.blob();
const audio = new Audio(URL.createObjectURL(blob));
audio.play();
```

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:15050/v1",
    api_key="any-value"
)

with client.audio.speech.with_streaming_response.create(
    model="a1b2c3",
    voice="x1y2z3w4",
    input="你好，世界"
) as resp:
    resp.stream_to_file("output.wav")
```

---

## 概念说明

**工作区 (Workspace)** — TTS 合成的上下文单元，绑定引擎、Voice 和参数。Model ID 在 `GET /v1/audio/models` 返回的 `id` 字段中获取。

**Voice ID** — 音色标识符，通过上传参考音频生成。在 `GET /v1/audio/voices` 返回的 `voice_id` 字段中获取。clone 模式下 `voice` 必填，design/auto 模式下可选。

**来源标记** — 通过 `Authorization` 头标记调用来源（非鉴权），仅影响历史记录显示：

| Header | 含义 |
|--------|------|
| `Bearer novamax-manual` | 手动输入 |
| `Bearer novamax-file` | 批量文件处理 |
| 不传 | 外部调用 |

**端口选择** — 15050 端口经 NovaAirouter 网关代理，TTS speech 端点限制最大 2 并发。高并发场景下建议通过此端口访问，网关会自动排队，避免引擎过载。调试或低负载时可直连 3001 端口。
