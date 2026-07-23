feat: GPU 架构智能检测 + ComfyUI 预打包运行环境 + 引擎推荐系统

== GPU 架构检测 (backend/src/utils/gpuArchDetection.js, 新增) ==
- 基于 GPU 名称识别 AMD RDNA 1/2/3/3.5/4 和 NVIDIA 计算能力架构
- 集成显卡检测: AMD 核显 (xxxM/xxxS 无 RX 前缀) 需 VRAM >16GB 才推荐 ROCm
- 导出 recommendGpuBackend(): NVIDIA→cuda, AMD独显RDNA3+→rocm, AMD核显低显存→vulkan

== ComfyUI 预打包运行环境 (engines.json + ci/install_comfyui.*) ==
- engines.json: ComfyUI 增加 runtimes 字段, 按 GPU 后端+架构分组版本
  {rocm: [{arch: rdna3|rdna35|rdna4, version, modelscope_file}], cuda: [...]}
- engines.json: llama.cpp 新增 CUDA variant
- ci/install_comfyui.py|bat: v2.0 预打包模式, 去掉 venv/pip install, 仅写 .installed

== 引擎下载 & 安装 (engineDownloader + engineManager + engines 路由) ==
- engineManager.getEngineRuntime(): 支持新 grouped runtimes 格式 {rocm: [...], cuda: [...]}
- engineManager._flattenRuntimes(): 新旧格式归一化
- engineDownloader: 运行时自动下载, if/else 改独立 if (同时传 --skip + --runtime-id)
- engineDownloader: 运行时任务增加 label 字段, 前端展示下载内容
- engines 路由: 下载未传 runtime 时自动检测 GPU 选择推荐
- engines 路由: ComfyUI runtimes 标注 recommended (AMD 精确匹配 arch, NVIDIA 取第一个 CUDA)
- engines 路由: 关联的 runtime 下载状态纳入 download_states 展示
- engines 路由: 去掉 当前模块配置 刷屏日志

== ComfyUI 启动 (comfyuiInstanceManager + comfyuiRunner) ==
- Python 路径检测: runtime/python.exe → runtime/Scripts/python.exe → 旧版 venv/Scripts/python.exe

== 模块系统 (modules.js, 新增) ==
- 首次启动 GPU 检测可能未就绪, getMaxVram() 增加重试 3 次 (间隔 2 秒)
- isLowEndDevice(): VRAM 为 0 时保守判定为低配, 关闭非推荐模块

== 前端 ==
- 首页: 测试通道时标题显示 [测试版] Tag
- 全局设置: 引擎与模块 改名为 引擎管理, GPU 名称旁显示架构标签, 下载进度显示运行环境名称
- EngineDownloadModal: 支持 grouped runtimes, 自动选中推荐 runtime, 显示 [推荐] 标签
- GlobalSettings 代码清理

== API 响应变更 ==
- /api/system/gpu + /api/system/info: GPU 对象增加 arch 和 archDisplay 字段
- /api/engines: llama.cpp variants + ComfyUI runtimes 增加 recommended 布尔字段
