# 量化选择器功能说明

## 功能概览

NovaMax 现已支持完整的量化版本管理，用户可以：
- 下载前选择量化版本
- 查看当前使用的量化版本
- 已下载后切换量化版本

## 实现的功能

### 1. 后端自动识别量化版本

**脚本**: `backend/admin/add-model-from-modelscope.js`

**支持的量化类型**:
- 原始精度: BF16, F16, F32
- 高质量: Q8_0, Q6_K
- 平衡推荐: Q5_K_M ⭐, Q4_K_M ⭐, Q5_K_S, Q4_K_S, Q4_0, Q4_1
- 极致压缩: IQ4_XS, Q3_K_M, Q3_K_S, IQ3_XXS
- 超级压缩: IQ2_M, IQ2_XXS
- UD 系列: UD-Q2_K_XL ~ UD-Q8_K_XL

**使用示例**:
```bash
cd backend/admin
node add-model-from-modelscope.js unsloth/Qwen3.5-4B-GGUF llm
```

**输出**:
```
量化版本数: 22
可用量化版本:
  原始精度:
    - BF16 - 7.85 GB
  高质量:
    - Q8_0 - 4.17 GB
    - Q6_K - 3.28 GB
  平衡推荐:
    - Q5_K_M - 2.93 GB ⭐
    - Q4_K_M - 2.55 GB ⭐
  极致压缩:
    - IQ4_XS - 2.31 GB
  默认选择: Q5_K_M - 2.93 GB ⭐
```

### 2. 模型配置结构

```json
{
  "id": "unsloth_Qwen3.5-4B-GGUF",
  "name": "Qwen3.5-4B-GGUF",
  "type": "llm",

  "quantizations": [
    {
      "name": "Q4_K_M",
      "label": "Q4_K_M - 2.55 GB",
      "category": "balanced",
      "quality": 80,
      "description": "常用推荐，适合大多数场景",
      "recommended": true,
      "file": {
        "name": "Qwen3.5-4B-Q4_K_M.gguf",
        "size": 2737152000,
        "sha256": "...",
        "download_url": "https://..."
      }
    }
  ],

  "selected_quantization": "Q4_K_M",

  "files": {
    "model": { /* 指向当前选择的量化版本 */ },
    "mmproj": { /* 多模态投影文件 */ }
  }
}
```

### 3. 前端量化选择器

**组件**: `frontend/src/components/QuantizationSelector/`

**特性**:
- 按分类显示（原始精度、高质量、平衡推荐等）
- 标记推荐版本 ⭐
- 显示质量百分比
- 显示描述和文件大小
- 支持选择确认/取消

**界面**:
```
┌─────────────────────────────────────────┐
│ 选择量化版本                             │
├─────────────────────────────────────────┤
│ ℹ️ 推荐选择: Q5_K_M - 2.93 GB           │
│   推荐，质量与大小平衡                    │
├─────────────────────────────────────────┤
│ 🟦 平衡推荐                              │
│   ○ Q5_K_M - 2.93 GB ⭐                 │
│     推荐，质量与大小平衡     质量: 85%    │
│   ○ Q4_K_M - 2.55 GB ⭐                 │
│     常用推荐，适合大多数场景  质量: 80%   │
├─────────────────────────────────────────┤
│ 💡 提示：                                │
│ • 质量越高，模型效果越好，但文件越大      │
│ • 推荐版本适合大多数用户                  │
└─────────────────────────────────────────┘
```

### 4. 使用流程

#### 下载新模型

1. **点击"下载模型"按钮**
   - 如果有多个量化版本，弹出量化选择器
   - 选择量化版本后开始下载

2. **显示当前量化版本**
   - 模型卡片上显示：`Q4_K_M - 2.55 GB`
   - 描述：`常用推荐，适合大多数场景`

#### 切换量化版本

1. **已下载模型显示"切换量化版本"按钮**
   - 仅当模型未运行时显示
   - 点击弹出量化选择器

2. **选择新的量化版本**
   - 确认后删除旧文件
   - 标记为未下载状态
   - 提示用户重新下载

### 5. API 接口

#### 更新量化版本
```javascript
PUT /api/models/:modelId
{
  "selected_quantization": "Q4_K_M"
}

// 后端自动同步 files 字段
```

#### 下载流程
```javascript
// 1. 前端选择量化版本
await modelService.update(modelId, {
  selected_quantization: "Q4_K_M"
});

// 2. 开始下载（自动使用选择的量化版本）
await downloadService.start(modelId);
```

## 技术实现细节

### 量化类型识别

使用正则表达式从文件名提取量化类型：
```javascript
function extractQuantizationType(filename) {
  // Qwen3.5-4B-Q4_K_M.gguf → Q4_K_M
  const patterns = [
    /-(Q8_0)$/i,
    /-(Q6_K)$/i,
    /-(Q5_K_M)$/i,
    /-(Q4_K_M)$/i,
    // ... 更多模式
  ];

  for (const pattern of patterns) {
    const match = baseName.match(pattern);
    if (match) return match[1].toUpperCase();
  }
}
```

### 文件同步逻辑

当用户更新 `selected_quantization` 时，后端自动更新 `files` 字段：

```javascript
// backend/src/routes/models.js
if (updates.selected_quantization) {
  const selectedQuant = model.quantizations.find(
    q => q.name === updates.selected_quantization
  );

  updates.files = {
    model: selectedQuant.file,
    mmproj: model.mmproj_options[0]
  };
}
```

### 下载服务

下载服务读取 `model.files` 字段，无需修改：
```javascript
// backend/src/services/downloadService.js
if (model.files?.model) {
  filesToDownload.push({
    name: model.files.model.name,
    url: model.files.model.download_url,
    size: model.files.model.size,
    sha256: model.files.model.sha256
  });
}
```

## 测试场景

### 场景 1：添加多量化版本模型

```bash
cd backend/admin
node add-model-from-modelscope.js unsloth/Qwen3.5-4B-GGUF llm
```

**预期结果**:
- 识别 22 个量化版本
- 默认选择 Q5_K_M
- 生成完整配置

### 场景 2：下载模型选择量化版本

1. 打开前端，查看模型卡片
2. 点击"下载模型"
3. 弹出量化选择器，显示 22 个版本
4. 选择 Q4_K_M
5. 开始下载 Q4_K_M 版本

**预期结果**:
- 下载 `Qwen3.5-4B-Q4_K_M.gguf` (2.55 GB)
- 模型卡片显示 `Q4_K_M - 2.55 GB`

### 场景 3：切换量化版本

1. 已下载 Q4_K_M 版本
2. 点击"切换量化版本"
3. 选择 Q8_0 (4.17 GB)
4. 确认切换
5. 重新下载

**预期结果**:
- 删除旧的 Q4_K_M 文件
- 标记为未下载
- 提示"量化版本已切换，请重新下载"

## 兼容性

### 向后兼容

旧的模型配置（没有 quantizations 字段）仍然可以正常工作：
- 不显示量化选择器
- 直接下载 `files.model`

### 渐进式升级

```bash
# 重新生成配置以支持量化版本
cd backend/admin
node add-model-from-modelscope.js shoujiekeji/Qwen3.5-35B-A3B-GGUF llm
```

## 注意事项

1. **量化类型识别**
   - 文件名必须符合规范：`ModelName-QUANTIZATION.gguf`
   - 不支持的格式会被忽略并警告

2. **切换量化版本**
   - 需要删除旧文件并重新下载
   - 运行中的模型无法切换

3. **推荐版本**
   - 自动标记 Q5_K_M 和 Q4_K_M 为推荐
   - 可在 QUANTIZATION_INFO 中自定义

4. **文件大小**
   - 从 ModelScope API 获取准确大小
   - 自动显示为 GB 格式

## 未来扩展

1. **预下载多个版本**
   - 允许用户预下载多个量化版本
   - 快速切换无需重新下载

2. **量化质量测试**
   - 自动测试不同量化版本的效果
   - 提供质量对比报告

3. **智能推荐**
   - 根据用户硬件配置推荐量化版本
   - 基于 GPU 显存自动选择

4. **量化转换**
   - 本地量化转换工具
   - 从高质量版本生成低质量版本
