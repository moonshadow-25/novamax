# 参数管理系统文档

## 功能概览

参数管理系统允许用户自定义模型运行参数，支持版本控制和自定义键值对。

## 核心特性

### 1. 参数优先级
- **用户参数** > **默认参数**
- 用户配置的参数会覆盖默认值
- 未配置的参数使用默认值

### 2. 版本控制
- 每个参数配置都有版本号（默认 1.0.0）
- 当管理员更新默认参数版本时，用户参数自动重置
- 防止使用过期配置导致的问题

### 3. 自定义参数
- 支持添加任意键值对
- 自动类型转换（数字、布尔值、字符串）
- 可随时删除自定义参数

## 使用方式

### 前端使用

1. **打开参数配置**
   - 点击模型卡片的"设置"按钮
   - 右侧弹出参数配置抽屉

2. **配置标准参数**
   - 运行时参数：GPU层数、上下文长度、线程数等
   - 采样参数：温度、Top P、Top K等
   - 所有参数都有说明提示

3. **添加自定义参数**
   - 在底部输入参数名和值
   - 点击 + 按钮添加
   - 支持数字、布尔值、字符串

4. **保存/重置**
   - 点击"保存"按钮保存用户配置
   - 点击"重置"按钮恢复默认值

### 后端 API

#### 获取有效参数
```javascript
GET /api/parameters/:modelId

响应:
{
  "parameters": {
    "version": "1.0.0",
    "gpu_layers": 50,
    "context_length": 16384,
    "_source": "user",      // 'user' 或 'default'
    "_version": "1.0.0"
  }
}
```

#### 保存用户参数
```javascript
PUT /api/parameters/:modelId
{
  "parameters": {
    "gpu_layers": 50,
    "context_length": 16384,
    "custom_key": "custom_value"
  }
}
```

#### 重置为默认
```javascript
POST /api/parameters/:modelId/reset
```

#### 添加自定义参数
```javascript
POST /api/parameters/:modelId/custom
{
  "key": "my_param",
  "value": 123
}
```

#### 删除自定义参数
```javascript
DELETE /api/parameters/:modelId/custom/:key
```

#### 获取参数元数据
```javascript
GET /api/parameters/metadata/all

响应:
{
  "metadata": {
    "gpu_layers": {
      "type": "number",
      "label": "GPU 层数",
      "description": "-1=全部使用GPU, 0=仅CPU",
      "min": -1,
      "max": 1000,
      "default": -1
    },
    ...
  }
}
```

## 参数说明

### 运行时参数

| 参数 | 说明 | 默认值 | 范围 |
|------|------|--------|------|
| context_length | 上下文长度（token数） | 8192 | 512-1048576 |
| gpu_layers | GPU加速层数 | -1 | -1(全部), 0(仅CPU), >0(指定) |
| threads | CPU线程数 | 8 | 1-128 |
| parallel | 并行请求数 | 2 | 1-16 |
| batch | Batch大小 | 512 | 1-2048 |
| ubatch | Micro Batch | 512 | 1-2048 |

### 采样参数

| 参数 | 说明 | 默认值 | 范围 |
|------|------|--------|------|
| temperature | 温度（控制随机性） | 0.7 | 0-2 |
| top_p | 核采样 | 0.9 | 0-1 |
| top_k | Top-K采样 | 40 | 0-200 |
| repeat_penalty | 重复惩罚 | 1.1 | 0-2 |

## 版本控制机制

### 工作原理

1. **初始状态**
   ```json
   {
     "parameters": { "version": "1.0.0", ... },
     "user_parameters": null,
     "user_parameters_version": null
   }
   ```

2. **用户保存配置**
   ```json
   {
     "parameters": { "version": "1.0.0", ... },
     "user_parameters": { "gpu_layers": 50 },
     "user_parameters_version": "1.0.0"
   }
   ```

3. **管理员更新默认参数**
   ```json
   {
     "parameters": { "version": "2.0.0", "new_param": 123 },
     "user_parameters": { "gpu_layers": 50 },
     "user_parameters_version": "1.0.0"
   }
   ```

4. **系统检测版本不匹配**
   - 比较 `parameters.version` (2.0.0) vs `user_parameters_version` (1.0.0)
   - 自动使用默认参数
   - 提示用户"默认参数已更新"

### 版本比较规则

使用 Semantic Versioning (semver):
- `2.0.0` > `1.9.9` (major 更新)
- `1.1.0` > `1.0.9` (minor 更新)
- `1.0.1` > `1.0.0` (patch 更新)

## 管理员操作

### 更新默认参数

编辑 `backend/admin/add-model-from-modelscope.js`:

```javascript
parameters: {
  version: '2.0.0',  // 增加版本号
  context_length: 131072,
  gpu_layers: -1,
  new_feature: true  // 添加新参数
}
```

运行更新:
```bash
cd backend/admin
node add-model-from-modelscope.js <modelId> llm
```

## 代码结构

```
backend/
├── src/
│   ├── services/
│   │   └── parameterService.js    # 参数管理核心逻辑
│   └── routes/
│       └── parameters.js           # API路由
└── test-parameters.js              # 测试脚本

frontend/
└── src/
    └── components/
        └── ParametersDrawer/
            ├── ParametersDrawer.jsx  # 参数配置UI
            └── ParametersDrawer.css
```

## 测试

运行测试脚本:
```bash
cd backend
node test-parameters.js
```

测试内容:
- ✓ 默认参数加载
- ✓ 用户参数保存
- ✓ 自定义参数添加/删除
- ✓ 版本控制机制
- ✓ 重置为默认值

## 注意事项

1. **版本号格式**：必须使用 `x.y.z` 格式（如 1.0.0）
2. **自定义参数**：键名不能以 `_` 开头（保留给系统）
3. **参数验证**：标准参数会进行范围验证
4. **性能影响**：修改运行时参数需要重启模型

## 示例场景

### 场景1：针对特定硬件优化

用户有 16GB 显存的 GPU：
- 设置 `gpu_layers: 50`（部分卸载）
- 设置 `context_length: 32768`（减少显存占用）
- 添加自定义 `use_flash_attention: true`

### 场景2：创意写作模式

用户需要更有创意的输出：
- 设置 `temperature: 1.2`（更随机）
- 设置 `top_p: 0.95`
- 设置 `repeat_penalty: 1.0`（允许重复）

### 场景3：版本升级

管理员更新模型配置：
1. 版本从 1.0.0 升级到 2.0.0
2. 添加新参数 `use_mmap: true`
3. 所有用户自动获得新配置
4. 用户需要重新调整个性化参数

## 扩展建议

1. **预设配置**：添加"性能模式"、"质量模式"等预设
2. **配置分享**：导出/导入参数配置
3. **参数验证**：添加更详细的参数验证规则
4. **历史记录**：保存参数修改历史
5. **A/B测试**：对比不同参数组合的效果
