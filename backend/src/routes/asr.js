/**
 * ASR 辅助端点 — 引擎能力查询、遗留迁移、日志
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import modelManager from '../services/modelManager.js';
import { PROJECT_ROOT } from '../config/constants.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

const router = Router();
const ASR_ENGINE_DIR = path.join(PROJECT_ROOT, 'external', 'asr');

// ==================== 引擎合约列表 ====================

router.get('/engine-contracts', (req, res) => {
  try {
    if (!fs.existsSync(ASR_ENGINE_DIR)) return res.json([]);
    const contracts = [];
    // 扫描 external/asr/{variantId}/{versionDir}/contract.json（两级目录结构）
    for (const variantEntry of fs.readdirSync(ASR_ENGINE_DIR, { withFileTypes: true }).filter(x => x.isDirectory())) {
      if (variantEntry.name.startsWith('_temp_')) continue;
      const variantPath = path.join(ASR_ENGINE_DIR, variantEntry.name);
      for (const verEntry of fs.readdirSync(variantPath, { withFileTypes: true }).filter(x => x.isDirectory())) {
        if (verEntry.name.startsWith('_temp_')) continue;
        const cp = path.join(variantPath, verEntry.name, 'contract.json');
        if (fs.existsSync(cp)) {
          try {
            const c = JSON.parse(fs.readFileSync(cp, 'utf-8'));
            contracts.push({
              engine_type: c.engine?.type,
              engine_name: c.engine?.name,
              contract: c,
            });
          } catch {}
        }
      }
    }
    res.json(contracts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 模型引擎能力 ====================

router.get('/models/:modelId/capabilities', (req, res) => {
  try {
    const model = modelManager.getById(req.params.modelId);
    if (!model) return res.status(404).json({ error: '模型不存在' });

    const engineType = model.engine_id;
    const normalizedModelType = normalizeEngineType(engineType);
    let supportedLanguages = ['auto', 'zh', 'en'], outputFormats = ['json'], supportsStreaming = false, supportsTranslation = false;
    if (fs.existsSync(ASR_ENGINE_DIR) && engineType) {
      for (const variantDir of fs.readdirSync(ASR_ENGINE_DIR, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('_temp_'))) {
        const variantPath = path.join(ASR_ENGINE_DIR, variantDir.name);
        for (const verDir of fs.readdirSync(variantPath, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('_temp_'))) {
          const cp = path.join(variantPath, verDir.name, 'contract.json');
          if (!fs.existsSync(cp) || !fs.existsSync(path.join(variantPath, verDir.name, '.installed'))) continue;
          try {
            const c = JSON.parse(fs.readFileSync(cp, 'utf-8'));
            // 只匹配与模型 engine_type 对应的引擎
            if (normalizeEngineType(c.engine?.type) !== normalizedModelType) continue;
            if (c.capabilities?.supported_languages) supportedLanguages = c.capabilities.supported_languages;
            if (c.capabilities?.output_formats) outputFormats = c.capabilities.output_formats;
            supportsStreaming = c.capabilities?.supports_streaming || false;
            supportsTranslation = c.capabilities?.supports_translation || false;
          } catch {}
        }
      }
    }

    res.json({
      engine_type: engineType,
      supported_languages: supportedLanguages,
      output_formats: outputFormats,
      supports_streaming: supportsStreaming,
      supports_translation: supportsTranslation,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 遗留迁移 ====================

router.get('/migrate-legacy', (req, res) => {
  const legacyEngineDir = path.join(PROJECT_ROOT, 'external', 'whisper');
  const legacyModelDir = path.join(PROJECT_ROOT, 'data', 'models_dir', 'whisper');
  res.json({
    has_legacy_engine: fs.existsSync(legacyEngineDir),
    has_legacy_models: fs.existsSync(legacyModelDir),
  });
});

router.post('/migrate-legacy', async (req, res) => {
  const result = { engine: [], models: [] };

  try {
    const legacyEngineDir = path.join(PROJECT_ROOT, 'external', 'whisper');

    if (fs.existsSync(legacyEngineDir)) {
      const versions = fs.readdirSync(legacyEngineDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_temp_'));

      for (const v of versions) {
        const legacyV = path.join(legacyEngineDir, v.name);
        const targetV = path.join(ASR_ENGINE_DIR, v.name);

        if (fs.existsSync(targetV) && fs.existsSync(path.join(targetV, 'venv'))) {
          result.engine.push({ version: v.name, status: 'skipped' });
          continue;
        }

        await fs.promises.mkdir(targetV, { recursive: true });
        let copied = 0;
        for (const f of await fs.promises.readdir(legacyV)) {
          const src = path.join(legacyV, f);
          const dest = path.join(targetV, f);
          if (!fs.existsSync(dest)) { await fs.promises.cp(src, dest, { recursive: true }); copied++; }
        }
        result.engine.push({ version: v.name, status: 'merged', copied });
      }

      if (result.engine.length > 0) {
        try { await fs.promises.rm(legacyEngineDir, { recursive: true, force: true }); }
        catch (e) { result.engineDeleteError = e.message; }
      }
    } else {
      result.engine.push({ status: 'none' });
    }

    const legacyModelDir = path.join(PROJECT_ROOT, 'data', 'models_dir', 'whisper');
    const asrModelDir = path.join(PROJECT_ROOT, 'data', 'models_dir', 'asr');

    if (fs.existsSync(legacyModelDir)) {
      await fs.promises.mkdir(asrModelDir, { recursive: true });
      const modelDirs = await fs.promises.readdir(legacyModelDir, { withFileTypes: true }).then(dirs => dirs.filter(d => d.isDirectory()));

      for (const md of modelDirs) {
        const legacyM = path.join(legacyModelDir, md.name);
        const targetM = path.join(asrModelDir, md.name);
        if (fs.existsSync(targetM)) {
          result.models.push({ name: md.name, status: 'skipped' });
          continue;
        }
        await fs.promises.cp(legacyM, targetM, { recursive: true });
        result.models.push({ name: md.name, status: 'migrated' });
      }

      // 更新 modelManager 中所有 whisper 模型的 path
      for (const md of modelDirs) {
        const asrModels = modelManager.getByType('asr') || [];
        for (const m of asrModels) {
          if (m.path && (m.path.includes('models_dir\\whisper\\') || m.path.includes('models_dir/whisper/'))) {
            const newPath = m.path.replace(/models_dir[\\/]whisper[\\/]/, 'models_dir/asr/');
            if (fs.existsSync(newPath)) {
              try { modelManager.update(m.id, { path: newPath }); result.pathUpdated = result.pathUpdated || []; result.pathUpdated.push(m.id); } catch {}
            }
          }
        }
      }

      if (result.models.length > 0) {
        try { await fs.promises.rm(legacyModelDir, { recursive: true, force: true }); }
        catch (e) { result.modelDeleteError = e.message; }
      }
    } else {
      result.models.push({ status: 'none' });
    }

    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
