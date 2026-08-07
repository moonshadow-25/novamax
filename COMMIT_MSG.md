feat: load-mode 新增 nommap 默认值，兼容老版本 llama.cpp

[参数]
- constants.js: load-mode 默认值 none → nommap
- parameterService.js: load-mode options 首位新增 nommap，default 同步
- llmRunner.js: load-mode=nommap 时 CLI 输出 --no-mmap（而非 --load-mode nommap）
- presetService.js: load-mode=nommap 时 INI 写 no-mmap = true

[其他]
- .gitignore: 忽略 .easier-code/；移除已跟踪的 .easier-code/_session_prefs.json
- package.json: 版本号 2.2.16 → 2.2.18
