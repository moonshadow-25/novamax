# backend/src 目录说明

## auxiliary-scripts.json

`backend/src/auxiliary-scripts.json` 用于配置辅助脚本的打包规则。

该文件由 `backend/build-portable.js` 读取，并将指定的脚本从源码目录打包到发布目录 `backend/dist/`。

### 目的

- 避免将辅助脚本以源码形式直接复制到发布包中
- 将脚本也作为构建产物打包输出，保持发布包一致性
- 支持后续新增类似单独启动的辅助脚本

### 格式说明

```json
[
  {
    "source": "src/utils/cloudApiProxy.js",
    "target": "utils/cloudApiProxy.js"
  }
]
```

- `source`：相对于 `backend/` 的源文件路径
- `target`：相对于 `backend/dist/` 的生成路径

### 扩展

如果需要新增辅助脚本，只需在 `auxiliary-scripts.json` 中增加对应条目。

例如：

```json
[
  {
    "source": "src/utils/cloudApiProxy.js",
    "target": "utils/cloudApiProxy.js"
  },
  {
    "source": "src/utils/otherAuxiliary.js",
    "target": "utils/otherAuxiliary.js"
  }
]
```

### 运行时路径

生产环境中，后台服务会通过 `backend/dist/` 的路径来加载这些脚本；
开发环境中仍然直接使用源码目录 `backend/src/`。
