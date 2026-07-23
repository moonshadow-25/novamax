import express from 'express';
import { MODULE_REGISTRY, LOW_END_VRAM_THRESHOLD } from '../config/modules.js';
import configManager from '../services/configManager.js';
import { getGpuInfo } from './system.js';

const router = express.Router();

/**
 * 获取最大专用显存（字节）
 * @returns {Promise<number>}
 */
async function getMaxVram() {
  // 重试 3 次（间隔 2 秒），应对 GPU 检测在启动时尚未就绪
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const gpus = await getGpuInfo({ namesOnly: false });
      if (Array.isArray(gpus) && gpus.length > 0) {
        const max = Math.max(...gpus.map(g => g.total || 0));
        if (max > 0) return max;
      }
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
  }
  return 0;
}

/**
 * 判断是否为低配设备（最大专用显存 <= 16 GB，即大于 16 GB 才全开）
 */
function isLowEndDevice(maxVram) {
  // maxVram === 0 表示 GPU 检测未完成/失败 → 保守判定为低配
  return maxVram === 0 || maxVram <= LOW_END_VRAM_THRESHOLD;
}

/**
 * GET /api/modules
 * 返回所有模块及其启用状态、硬件推荐信息
 */
router.get('/modules', async (req, res) => {
  try {
    const config = configManager.get();
    const modulesConfig = config.modules || {};
    const maxVram = await getMaxVram();
    const lowEnd = isLowEndDevice(maxVram);

    const modules = MODULE_REGISTRY.map(mod => {
      const configured = modulesConfig[mod.id];

      // alwaysEnabled 模块始终启用，不受配置和硬件影响
      if (mod.alwaysEnabled) {
        return {
          id: mod.id,
          name: mod.name,
          nameZh: mod.nameZh,
          requiredEngines: mod.requiredEngines,
          alwaysEnabled: true,
          recommended: mod.recommended || false,
          order: mod.order,
          enabled: true,
          lowEndWarning: false
        };
      }

      // enabled 判断逻辑：
      // - 用户已明确设置 → 使用用户的值
      // - 低配设备 → 推荐模块默认启用，非推荐默认禁用
      // - 高配设备 → 全部默认启用
      const hasExplicitConfig = configured !== undefined;
      let enabled;
      if (hasExplicitConfig) {
        enabled = configured.enabled !== false;
      } else if (lowEnd) {
        enabled = mod.recommended;
      } else {
        enabled = true;
      }

      return {
        id: mod.id,
        name: mod.name,
        nameZh: mod.nameZh,
        requiredEngines: mod.requiredEngines,
        recommended: mod.recommended || false,
        order: mod.order,
        enabled,
        lowEndWarning: lowEnd && !mod.recommended
      };
    });

    res.json({
      modules,
      lowEndDevice: lowEnd,
      maxVram
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/modules
 * 更新模块启用/禁用状态
 * Body: { moduleId: string, enabled: boolean, confirm?: boolean }
 * 低配设备启用非推荐模块时，需要 confirm: true 二次确认
 */
router.put('/modules', async (req, res) => {
  try {
    const { moduleId, enabled, confirm } = req.body;

    const modDef = MODULE_REGISTRY.find(m => m.id === moduleId);
    if (!modDef) {
      return res.status(400).json({ error: '未知模块' });
    }

    // alwaysEnabled 模块不允许关闭
    if (!enabled && modDef.alwaysEnabled) {
      return res.status(400).json({ error: '此模块不可关闭' });
    }

    // 低配设备启用非推荐模块 → 需要二次确认
    if (enabled && !modDef.recommended) {
      const maxVram = await getMaxVram();
      if (isLowEndDevice(maxVram) && !confirm) {
        return res.status(428).json({
          error: '此模块不建议在低显存设备上启用，可能影响系统性能',
          requiresConfirmation: true,
          moduleId,
          maxVram
        });
      }
    }

    // 持久化到 config
    const config = configManager.get();
    const modulesConfig = { ...config.modules };
    modulesConfig[moduleId] = { ...modulesConfig[moduleId], enabled };
    configManager.set('modules', modulesConfig);
    console.log('[modules] 已保存模块配置:', JSON.stringify(configManager.get().modules));

    res.json({ success: true, moduleId, enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
