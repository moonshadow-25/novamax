feat: ASR multi-variant engine support + variant-aware UI + Qwen3-ASR install script

## ASR engine variant system

[Backend] downloadStateManager.createState 新增 variantId 参数，下载状态携带 variant_id
[Backend] engineDownloader 主下载/重装流程传递 variant_id，修复安装脚本日志显示实际文件名
[Frontend] GlobalSettings: resolveTtsVariantRow → 泛化 resolveVariantRow，所有多 variant 引擎
  （TTS/ASR/OCR）统一拆分为独立卡片；llama.cpp 推荐 variant 加绿色"推荐"标签
[Frontend] Home banner: engineUpdates 泛化为所有 variant 引擎逐 variant 检查；
  新增 variant_mode="single" 互斥模式（llama.cpp GPU 后端），已安装则只检查该 variant，
  未安装则只提示 recommended（后端根据 GPU 标注）
[Frontend] variant 匹配三层优先级：s.variant_id 精确 > variant.versions 列表 > normalize 兜底
  （修复 llama.cpp / ASR 版本号不含 variant 名导致匹配失败的问题）
[Frontend] 下载状态匹配：s.variant_id 存在时只精确匹配，不走 fallback
  （修复版本号 20260602 在 whisper/qwen3-asr 中重复导致的下载进度串扰）

## Qwen3-ASR engine

[Install] 新增 ci/install_qwen3-asr.py：4 步安装 — 验证 serve.py/contract.json →
  从 engines.json 解析运行时包 → ModelScope 下载 ROCm+PyTorch 运行环境 ~1.2 GB →
  解压到 runtime/ 并验证 torch 可 import → 写 .installed
  支持 --skip-runtime-download（由 engineDownloader 处理运行时）
  修复：之前无专属脚本，fallback 到 install_whisper.py 找 whisper-server.exe 导致失败

## ASR Settings Drawer

[Frontend] AsrSettingsDrawer: 新增 resolveAsrVariant() 根据 model.engine_id 识别 variant
  （whisper/qwen3-asr），fetch 父引擎后过滤为单 variant 视图，安装/版本提示精确到具体引擎
[i18n] whisperEngineNotInstalled → engineNotInstalled ({{engineName}} 参数化)

## engines.json

[Data] llamacpp 新增 "variant_mode": "single"（标记 GPU 后端互斥，区别于 TTS/ASR 的并行模式）
