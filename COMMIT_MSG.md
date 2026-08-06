feat: 引擎参数系统升级 + ComfyUI 日志/配置优化 + variant 体系完善

[参数系统]
- constants.js: no-mmap → load-mode=none（替代已弃用参数），temperature 默认 0.7→0.8；
  新增 DEPRECATED_LLM_PARAMS 集合，presetService/llmRunner 输出端统一拦截
- parameterService.js: getEffectiveParameters 合并 DEFAULT_LLM_PARAMETERS 兜底，
  旧模型自动获得 load-mode 等新默认值；no-mmap 在合并阶段过滤，不再泄露到前端/CLI/INI
- llm.js: temperature 默认 0.7→0.8，同时修正 || 为 ??（避免 0 被吞掉）
- add-model-from-modelscope.js: admin 脚本 temperature 默认同步更新
- ParametersDrawer.jsx: no-mmap → load-mode（standardKeys/runtimeKeys），
  renderFormItem 支持 options 下拉选择，load-mode 渲染为 Select 组件

[引擎管理]
- GlobalSettings.jsx: resolveTtsVariantRow 泛化为 resolveVariantRow，
  所有多 variant 引擎（TTS/ASR/OCR）统一拆分为独立卡片；
  llama.cpp 推荐 variant 加绿色「推荐」标签；版本号标签去掉 v 前缀
- Home.jsx: engineUpdates banner 泛化逐 variant 检查；
  variant_mode="single" 互斥模式（llama.cpp GPU 后端），已安装只检查该 variant，
  未安装只提示 recommended
- variant 匹配三层优先级：variant_id 精确 → variant.versions 列表 → normalize 兜底；
  下载状态有 variant_id 时只用精确匹配，避免版本号重复导致进度串扰

[ComfyUI]
- comfyuiInstanceManager.js: stderr 日志按 [INFO]/[WARNING]/[ERROR] 分级解析，
  不再全部打 ERROR；Python 路径提取 RUNTIME_DIR/VENV_DIR 常量；
  extra_model_paths.yaml 动态扫描引擎模板目录 + 用户目录生成，不再硬编码 18 个子目录
- install_comfyui.py: skip_runtime_download 时不写 .installed（由两阶段提交统一写）；
  修复 esbuild const 重赋值错误
- engineManager.js: _isValidEngineDir 排除 . 和 _temp_ 开头的临时目录

[下载/解压]
- engineDownloader.js: 解压统一改用系统 tar.exe（-xf），移除 node-stream-zip 和 tar npm；
  package.json 可卸载 node-stream-zip、tar 两个依赖；
  安装脚本 stderr 改为 console.log（不再误标 ERROR）；安装日志打印实际脚本名；
  downloadStateManager.createState 支持 variant_id 参数
- archiveIntegrity.js: 新增，size/sha256 线性降级校验——有则严格验，无则 warn 跳过

[安装脚本]
- install_qwen3-asr.py: 新建，4 步安装（验证引擎文件→解析运行时→ModelScope 下载→解压验证）
- install_comfyui.py: 同上修复
- install_ocr.py/install_tts.py: skip 分支还原，不验证运行时（由 engineDownloader 负责）

[引擎卸载]
- engineManager.js: _removeVersionDirWithRetry 中 fs.rmSync → await fsp.rm，
  异步删除不阻塞 event loop

[GPU 架构检测]
- gpuArchDetection.js: AMD 专业卡支持（Radeon AI PRO R9600/R9700、W7900/W7800/W6800 系列）

[其他]
- processManager.js: OCR/TTS Python 路径提取常量 + Scripts fallback 兼容
- i18n: whisperEngineNotInstalled → engineNotInstalled（{{engineName}} 参数化）
