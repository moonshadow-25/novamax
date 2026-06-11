# 合并记录：TTS_refactor → dev

**日期**：2026-06-09  
**操作人**：GitHub Copilot  
**目标分支**：`dev`  
**源分支**：`origin/TTS_refactor`

---

## 背景

将 `TTS_refactor` 分支的 TTS/ASR 架构重构成果合并进 `dev` 分支。

- `dev` 分支近期主要改动：全面接入国际化（i18n）、新增浅色/深色主题、全局设置国际化
- `TTS_refactor` 分支主要改动：Whisper 重命名为 ASR、TTS 架构 v5.0 重构、新增 ASR/TTS Studio 后端服务

---

## 执行命令

```bash
# 1. 确认当前分支
git status
git branch -a

# 2. 查看两分支的最近提交
git log --oneline -5
git log --oneline origin/TTS_refactor -5

# 3. 查看公共祖先（merge base）
git merge-base dev origin/TTS_refactor
# 输出：42df8cbde6babeac742d68374b06375aa49a88fc（即 origin/main 的最新提交）

# 4. 执行合并（no-ff 保留合并节点）
git merge origin/TTS_refactor --no-ff -m "merge: 将 TTS_refactor 分支合并到 dev"
# 结果：自动合并失败，10 个文件存在冲突

# 5. 手动解决所有冲突后，标记为已解决
git add frontend/src/components/ASRModelsPanel/AsrModelsPanel.jsx \
        frontend/src/components/ASRSettingsDrawer/AsrSettingsDrawer.jsx \
        frontend/src/components/AddModelModal/AddAsrModal.jsx \
        frontend/src/components/DownloadCenter/DownloadCenter.jsx \
        frontend/src/components/EngineDownloadModal/EngineDownloadModal.jsx \
        frontend/src/components/ModelCard/ModelCard.jsx \
        frontend/src/components/TtsSettingsDrawer/TtsSettingsDrawer.jsx \
        frontend/src/pages/GlobalSettings/GlobalSettings.jsx \
        frontend/src/pages/Home/Home.css \
        frontend/src/pages/Home/Home.jsx

# 6. 完成合并提交
git commit -m "merge: 将 TTS_refactor 分支合并到 dev"
# 提交：26b0881

# 7. 编译前端验证
cd frontend && npm run build
# 发现 TtsSettingsDrawer.jsx 存在两处问题：
#   - saving/setSaving 重复声明（合并时 dev 版本声明了一次，TTS_refactor 版本又声明了一次）
#   - handleDelete 函数体缺少关闭的 };

# 8. 修复编译错误后再次提交
git add frontend/src/components/TtsSettingsDrawer/TtsSettingsDrawer.jsx
git commit -m "fix: 修复 TtsSettingsDrawer 合并后的 saving 重复声明和函数体缺失 };"
# 提交：465a614
```

---

## 冲突文件列表及解决策略

| 文件 | 冲突来源 | 解决策略 |
|------|---------|---------|
| `ASRModelsPanel/AsrModelsPanel.jsx` | dev: i18n + WhisperModelsPanel 名称；TTS_refactor: ASR 重命名 | 保留 TTS_refactor 的 `asrModelsService` 和 `AsrModelsPanel` 名称，保留 dev 的 `useTranslation` 和 `t()` 调用 |
| `ASRSettingsDrawer/AsrSettingsDrawer.jsx` | dev: i18n + 旧 Whisper 表单（threads/language/ports/VAD）；TTS_refactor: 简化为仅 idle_timeout 配置 | 保留 TTS_refactor 的简化 UI（去掉旧端口/线程配置，仅保留闲置超时），添加回 dev 的 i18n |
| `AddModelModal/AddAsrModal.jsx` | dev: AddWhisperModal 名称 + i18n；TTS_refactor: AddAsrModal 名称 | 使用 TTS_refactor 的 `AddAsrModal` 名称，保留 dev 的 `t()` 调用 |
| `DownloadCenter/DownloadCenter.jsx` | dev: `whisperService` 导入 + i18n；TTS_refactor: `asrModelsService`/`engineService` 导入 | 合并导入，用 `asrModelsService` 替换 `whisperService`，保留 `useTranslation` |
| `EngineDownloadModal/EngineDownloadModal.jsx` | dev: 版本选择下拉框 + i18n 标题；TTS_refactor: 简化为只显示最新版本 | 保留 TTS_refactor 的简化版本显示 UI，标题使用 TTS_refactor 的动态判断逻辑 |
| `ModelCard/ModelCard.jsx` | dev: `whisperService` + i18n；TTS_refactor: 新增 `asrStudioService`/`ttsStudioService` + ASR 专属启停逻辑 | 合并导入，保留 TTS_refactor 的 ASR 专属 start/stop（通过 `asrStudioService`），保留 dev 的 `t()` 文案 |
| `TtsSettingsDrawer/TtsSettingsDrawer.jsx` | dev: 旧 TTS 表单（ports/workers/fp16）+ i18n；TTS_refactor: 完全重写为 runtime config + idle timeout | 保留 TTS_refactor 的新 UI 结构，添加回 dev 的 `useTranslation` 和关键 `t()` 调用 |
| `GlobalSettings/GlobalSettings.jsx` | dev: theme token + `BgColorsOutlined` + `useTheme`；TTS_refactor: VRAM 显示支持 shared memory + `ttsStudioService` | 合并 antd/icon 导入，保留 TTS_refactor 的 shared VRAM 显示逻辑，用 dev 的 theme token 替换硬编码颜色 |
| `Home/Home.css` | dev: 无深色主题 CSS；TTS_refactor: 新增深色主题 CSS | 两者并存，追加 TTS_refactor 的深色主题 CSS |
| `Home/Home.jsx` | dev: 基础导入；TTS_refactor: 新增 `Alert`/`Card`/`useTheme`/`normalizeEngineType` 等 | 合并两组导入，取并集 |

---

## 最终提交历史

```
465a614 (HEAD -> dev) fix: 修复 TtsSettingsDrawer 合并后的 saving 重复声明和函数体缺失 };
26b0881                merge: 将 TTS_refactor 分支合并到 dev
0730617 (origin/dev)   feat(frontend): 全局设置页面国际化与主题适配优化
96d5dae (origin/TTS_refactor) refactor: Whisper→ASR 重命名 + TTS/ASR 前端修复
7c1789b               feat(theme): 支持浅色/深色/跟随系统三种主题模式
```

---

## 合并后验证

- `cd frontend && npm run build` ✅ 编译成功（3120 个模块，无错误）
- 前端静态产物输出到 `frontend/dist/`

---

## 注意事项

- 后端变更较多（新增 ASR worker、TTS Studio 路由等），用户需**重启后端**以使变更生效
- `TtsSettingsDrawer` 移除了旧的 TTS 配置表单（api_port/webui_port/workers/fp16），改为 runtime config + idle timeout 管理
- `AsrSettingsDrawer` 移除了旧的 Whisper 配置（threads/language/ports/VAD），改为 idle timeout 管理
- `EngineDownloadModal` 简化了版本选择 UI，仅展示最新版本，不再支持手动选择版本
