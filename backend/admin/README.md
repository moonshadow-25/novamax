# 管理员工具

此目录包含用于管理 NovaMax 模型配置的管理员工具。

## add-model-from-modelscope.js

从 ModelScope 自动抓取模型信息并添加到配置文件。

### 使用方式

```bash
cd backend/admin
node add-model-from-modelscope.js <modelId> <type>
```

### 参数

- `modelId`: ModelScope 模型 ID（格式：`用户名/模型名`）
- `type`: 模型类型，可选值：
  - `llm` - 大语言模型（GGUF 格式）
  - `comfyui` - ComfyUI 模型
  - `tts` - TTS 语音合成模型
  - `whisper` - Whisper 语音识别模型

### 示例

```bash
# 添加 LLM 模型
node add-model-from-modelscope.js shoujiekeji/Qwen3.5-35B-A3B-GGUF llm

# 添加 ComfyUI 模型
node add-model-from-modelscope.js username/model-name comfyui
```

### 功能

1. **自动获取模型信息**
   - 模型名称、描述
   - 框架、标签、许可证
   - 星标数、下载数

2. **获取文件列表**
   - 自动识别 GGUF 文件
   - 区分主模型和多模态投影文件
   - 获取文件大小、SHA256 哈希
   - 生成下载链接

3. **生成完整配置**
   - LLM 模型：包含 chat、vision、completion 能力
   - 默认参数：temperature、top_p、context_length 等
   - 文件信息：名称、大小、下载地址

4. **更新配置文件**
   - 保存到 `data/models/{type}.json`
   - 自动检测并更新已存在的模型
   - 保持配置文件格式一致

### 配置文件位置

生成的配置文件位于：
- LLM: `data/models/llm.json`
- ComfyUI: `data/models/comfyui.json`
- TTS: `data/models/tts.json`
- Whisper: `data/models/whisper.json`

### ModelScope API 端点

工具使用以下 ModelScope API：

1. **模型信息**: `https://www.modelscope.cn/api/v1/models/{modelId}`
   - 返回模型基本信息、README 内容、统计数据

2. **文件列表**: `https://www.modelscope.cn/api/v1/models/{modelId}/repo/files`
   - 返回仓库中的所有文件及其元数据

3. **下载链接**: `https://www.modelscope.cn/models/{modelId}/resolve/master/{filename}`
   - 直接下载链接格式

### 注意事项

- 确保有网络连接以访问 ModelScope API
- 模型 ID 必须是有效的 ModelScope 仓库
- 脚本会自动创建不存在的配置文件
- 重复运行会更新现有配置而不是创建副本

### 生成的配置示例

```json
{
  "models": [
    {
      "id": "shoujiekeji_Qwen3.5-35B-A3B-GGUF",
      "name": "Qwen3.5-35B-A3B-GGUF",
      "description": "Qwen 3.5 35B 多模态模型",
      "type": "llm",
      "modelscope_id": "shoujiekeji/Qwen3.5-35B-A3B-GGUF",
      "downloaded": false,
      "status": "stopped",
      "files": {
        "model": {
          "name": "Qwen3.5-35B-A3B-Q8_0.gguf",
          "size": 36903139616,
          "sha256": "7ba74a85...",
          "download_url": "https://www.modelscope.cn/models/..."
        },
        "mmproj": {
          "name": "mmproj-Qwen_Qwen3.5-35B-A3B-bf16.gguf",
          "size": 902822240,
          "sha256": "d341dec9...",
          "download_url": "https://www.modelscope.cn/models/..."
        }
      },
      "capabilities": {
        "chat": true,
        "vision": true,
        "completion": true
      },
      "parameters": {
        "context_length": 131072,
        "temperature": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "repeat_penalty": 1.1
      },
      "frameworks": ["other"],
      "tags": ["unsloth", "qwen3_5_moe"],
      "license": "apache-2.0"
    }
  ]
}
```
