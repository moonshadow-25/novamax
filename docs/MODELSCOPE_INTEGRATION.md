# ModelScope 下载集成

## 概述

已经集成了 ModelScope CLI 来替代原有的 axios 下载方式，解决了以下问题：
- 下载中断无法恢复
- 下载速度慢
- 后端频繁出错
- **只下载选中的量化版本，而不是整个仓库**

## 安装

Python 3.13 便携版已经下载并配置在 `external/python313/` 目录中。
ModelScope 库已经通过 pip 安装。

## 使用方式

### 1. 通过前端下载模型

前端界面保持不变：
1. 点击"选择量化版本并下载"
2. 在弹出的对话框中选择一个量化版本（如 Q5_K_M）
3. 点击确定后，**只会下载该量化文件**（如 Q5_K_M.gguf）和必要的配置文件
4. **不会下载整个仓库的所有文件**

### 2. 模型数据结构

添加模型时，需要包含：
- `modelscope_id`: ModelScope 仓库 ID
- `quantizations`: 量化版本列表

```json
{
  "name": "Qwen2.5-7B-Instruct",
  "modelscope_id": "Qwen/Qwen2.5-7B-Instruct-GGUF",
  "description": "Qwen 2.5 7B 指令模型",
  "quantizations": [
    {
      "name": "Q5_K_M",
      "label": "Q5_K_M - 2.93 GB",
      "description": "推荐，质量与大小平衡",
      "size": 2930000000,
      "quality": 85,
      "filename": "q5_k_m.gguf",
      "recommended": true
    },
    {
      "name": "Q8_0",
      "label": "Q8_0 - 4.17 GB",
      "description": "高质量，推荐高质量场景",
      "size": 4170000000,
      "quality": 95,
      "filename": "q8_0.gguf"
    }
  ]
}
```

**重要字段说明：**
- `name`: 量化版本标识符（如 Q5_K_M）
- `filename`: 实际文件名（如 q5_k_m.gguf）。如果不提供，会自动使用 `{name}.gguf`

### 3. 下载目录结构

```
data/
  downloads/          # 下载临时目录
    llm/
      {modelId}/
  models_dir/         # 模型运行目录
    llm/
      {modelId}/
        q5_k_m.gguf  # 只有选中的量化文件
        config.json
        tokenizer.json
        ...
```

## Python 脚本

核心下载脚本位于 `backend/src/services/modelscope_downloader.py`

### 直接使用 Python 脚本下载特定文件

```bash
# 只下载 Q5_K_M.gguf 和配置文件
external/python313/python.exe backend/src/services/modelscope_downloader.py \
  Qwen/Qwen2.5-0.5B-Instruct-GGUF \
  --output data/downloads/test \
  --files q5_k_m.gguf "*.json" "tokenizer*"
```

### 参数说明

- `model_id`: ModelScope 模型 ID（必需）
- `--output, -o`: 输出目录（必需）
- `--files, -f`: 要下载的文件列表（可选，支持通配符）
- `--revision, -r`: 版本/分支（可选，默认 master）

**`--files` 参数支持通配符：**
- `*.json` - 所有 JSON 文件
- `tokenizer*` - 所有以 tokenizer 开头的文件
- `q5_k_m.gguf` - 特定文件

## 测试

运行测试脚本：

```bash
cd backend
node test-modelscope-download.js
```

这将创建一个测试模型并开始下载。

## 工作原理

1. **用户选择量化版本**：前端调用 API 更新模型的 `selected_quantization` 字段
2. **后端读取配置**：从 `quantizations` 数组中找到对应的配置
3. **构建文件列表**：
   - 添加选中的 .gguf 文件（如 q5_k_m.gguf）
   - 添加必要的配置文件（*.json, tokenizer*, LICENSE 等）
4. **调用 Python 下载器**：传递文件列表到 ModelScope SDK
5. **ModelScope 过滤**：使用 `allow_patterns` 参数只下载指定的文件

## 优势

1. **稳定性好**：ModelScope SDK 内置了断点续传和错误重试机制
2. **速度快**：使用 ModelScope 官方源，国内下载速度更快
3. **节省空间**：只下载选中的量化版本，不下载整个仓库
4. **易于维护**：基于成熟的 ModelScope SDK，问题少

## 故障排除

### 下载了整个仓库而不是单个文件

检查：
1. 模型数据中是否设置了 `selected_quantization` 字段
2. `quantizations` 数组中是否有对应的配置
3. `filename` 字段是否正确（应该是实际文件名，如 q5_k_m.gguf）
4. 查看后端日志，确认传递给 Python 的 `--files` 参数

### Python 找不到

确保 `external/python313/python.exe` 存在。如果没有，运行：

```bash
curl -L -o python-3.13.1-embed-amd64.zip https://www.python.org/ftp/python/3.13.1/python-3.13.1-embed-amd64.zip
powershell -Command "Expand-Archive -Path python-3.13.1-embed-amd64.zip -DestinationPath external/python313 -Force"
```

### ModelScope 安装失败

重新安装：

```bash
external/python313/python.exe -m pip install --upgrade modelscope
```

### 下载失败

检查：
1. 网络连接是否正常
2. ModelScope ID 是否正确
3. 文件名是否正确（大小写敏感）
4. 查看后端日志中的详细错误信息

## 清理已下载的文件

如果之前下载了整个仓库导致硬盘满了，可以手动删除：

```bash
# 删除下载缓存
rm -rf data/downloads/llm/*

# 删除运行时目录中的模型（注意：会删除所有已下载的模型）
rm -rf data/models_dir/llm/*
```

然后重新选择量化版本并下载。
