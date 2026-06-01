import fs from 'fs';
import path from 'path';
import { DATA_DIR, PROJECT_ROOT } from '../config/constants.js';
import configManager from './configManager.js';

/**
 * 引擎管理服务
 * 负责加载引擎元数据、验证依赖、管理已安装版本
 */
class EngineManager {
  constructor() {
    this.engines = null;
    this.enginesFilePath = path.join(DATA_DIR, 'engines.json');
  }

  _getEngineVersions(engine) {
    if (!engine) return [];
    if (Array.isArray(engine.versions) && engine.versions.length > 0) {
      return engine.versions;
    }
    if (Array.isArray(engine.variants)) {
      const out = [];
      for (const variant of engine.variants) {
        const versions = Array.isArray(variant.versions) ? variant.versions : [];
        for (const v of versions) {
          out.push({
            ...v,
            variant_id: variant.id,
            variant_name: variant.name,
            modelscope_repo: v.modelscope_repo || variant.modelscope_repo || engine.modelscope_repo
          });
        }
      }
      return out;
    }
    return [];
  }

  getEngineVersionInfo(engineId, version) {
    const engine = this.getEngine(engineId);
    if (!engine) return null;
    const versions = this._getEngineVersions(engine);
    return versions.find(v => v.version === version) || null;
  }

  getEngineVersions(engineId) {
    const engine = this.getEngine(engineId);
    return this._getEngineVersions(engine);
  }

  /**
   * 初始化：加载本地 engines.json，尝试从服务器更新
   */
  async init() {
    console.log('Initializing EngineManager...');

    // 加载本地配置
    if (fs.existsSync(this.enginesFilePath)) {
      const data = fs.readFileSync(this.enginesFilePath, 'utf-8');
      this.engines = JSON.parse(data);
      console.log(`Loaded ${Object.keys(this.engines.engines).length} engine definitions`);
    } else {
      console.warn('engines.json not found, using empty configuration');
      this.engines = { version: '1.0.0', engines: {} };
    }

    // TODO: 尝试从服务器更新（后续实现）
    // await this._updateFromServer();
  }

  /**
   * 获取所有引擎定义
   */
  getEngines() {
    return this.engines?.engines || {};
  }

  /**
   * 获取单个引擎定义
   */
  getEngine(engineId) {
    // 直接 key 匹配
    const byKey = this.engines?.engines?.[engineId];
    if (byKey) return byKey;

    // variants 匹配（如 ASR/TTS）
    for (const eng of Object.values(this.engines?.engines || {})) {
      const variants = eng.variants || [];
      for (const v of variants) {
        if (v.id === engineId) return { ...v, _parentKey: eng.id, modelscope_repo: v.modelscope_repo || eng.modelscope_repo };
      }
    }
    return null;
  }

  /**
   * 获取已安装的引擎版本列表
   * 扫描 external/{engineId}/ 目录，通过文件修改时间判断安装时间
   */
  getInstalledVersions(engineId) {
    const engine = this.getEngine(engineId);
    if (!engine) return [];

    const installed = [];

    // variants 引擎：扫描每个 variant 的子目录
    if (engine.variants && !engine._parentKey) {
      for (const variant of engine.variants) {
        const varPath = path.join(PROJECT_ROOT, 'external', engineId, variant.id);
        if (!fs.existsSync(varPath)) continue;
        const verDirs = fs.readdirSync(varPath, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const vd of verDirs) {
          const versionPath = path.join(varPath, vd.name);
          if (this._isValidEngineDir(engineId, versionPath)) {
            const marker = JSON.parse(fs.readFileSync(path.join(versionPath, '.installed'), 'utf-8'));
            installed.push({
              version: marker.version || vd.name,
              path: versionPath,
              installed_at: marker.installed_at || '',
              variant_id: variant.id,
              variant_name: variant.name
            });
          }
        }
      }
      // 也扫描旧格式目录（无 variant 包裹的版本）
      const legacyPath = path.join(PROJECT_ROOT, 'external', engineId);
      if (fs.existsSync(legacyPath)) {
        for (const d of fs.readdirSync(legacyPath, { withFileTypes: true }).filter(x => x.isDirectory())) {
          const vp = path.join(legacyPath, d.name);
          if (this._isValidEngineDir(engineId, vp)) {
            const isVariantDir = engine.variants.some(v => v.id === d.name);
            if (isVariantDir) continue; // 跳过 variant 目录本身
            const marker = JSON.parse(fs.readFileSync(path.join(vp, '.installed'), 'utf-8'));
            installed.push({
              version: marker.version || d.name,
              path: vp,
              installed_at: marker.installed_at || '',
              variant_id: null,
              legacy: true
            });
          }
        }
      }
    } else {
      // 单个引擎或 variant 引擎
      const dirName = engine._parentKey ? path.join(engine._parentKey, engineId) : engineId;
      const basePath = path.join(PROJECT_ROOT, 'external', dirName);
      if (fs.existsSync(basePath)) {
        for (const d of fs.readdirSync(basePath, { withFileTypes: true }).filter(x => x.isDirectory())) {
          const versionPath = path.join(basePath, d.name);
          if (this._isValidEngineDir(engineId, versionPath)) {
            const marker = JSON.parse(fs.readFileSync(path.join(versionPath, '.installed'), 'utf-8'));
            installed.push({
              version: marker.version || d.name,
              path: versionPath,
              installed_at: marker.installed_at || ''
            });
          }
        }
      }
    }

    installed.sort((a, b) => b.version.localeCompare(a.version));
    return installed;
  }

  /**
   * 验证引擎目录完整性：只检查 .installed 标记文件
   */
  _isValidEngineDir(engineId, dirPath) {
    if (!fs.existsSync(dirPath)) return false;
    return fs.existsSync(path.join(dirPath, '.installed'));
  }

  /**
   * 检查目录是否损坏（目录存在但缺少 .installed）
   */
  _isBrokenEngineDir(engineId, dirPath) {
    if (!fs.existsSync(dirPath)) return false;
    return !fs.existsSync(path.join(dirPath, '.installed'));
  }

  /**
   * 获取损坏的版本列表（目录存在但 .installed 缺失）
   */
  getBrokenVersions(engineId) {
    const engine = this.getEngine(engineId);
    if (!engine) return [];

    const broken = [];

    const checkDir = (basePath) => {
      if (!fs.existsSync(basePath)) return;
      for (const dir of fs.readdirSync(basePath, { withFileTypes: true })) {
        if (dir.isDirectory() && this._isBrokenEngineDir(engineId, path.join(basePath, dir.name))) {
          broken.push({ version: dir.name, path: path.join(basePath, dir.name) });
        }
      }
    };

    if (engine._parentKey) {
      // variant 引擎：external/{parentKey}/{variantId}/
      checkDir(path.join(PROJECT_ROOT, 'external', engine._parentKey, engineId));
    } else if (engine.variants) {
      // 父引擎有 variants：扫描每一 variant
      for (const v of engine.variants) {
        checkDir(path.join(PROJECT_ROOT, 'external', engineId, v.id));
      }
    } else {
      // 独立引擎：external/{engineId}/
      checkDir(path.join(PROJECT_ROOT, 'external', engineId));
    }
    return broken;
  }

  /**
   * 获取默认版本（最新安装的版本）
   * 按 engines.json 中 versions 数组的顺序确定最新版本（第一个已安装的）
   */
  getDefaultVersion(engineId) {
    const engine = this.getEngine(engineId);
    const availableVersions = this._getEngineVersions(engine);
    const installedSet = new Set(
      this.getInstalledVersions(engineId).map(v => v.version)
    );
    for (const v of availableVersions) {
      if (installedSet.has(v.version)) {
        return v.version;
      }
    }
    return null;
  }

  /**
   * 检查引擎是否已安装
   */
  isInstalled(engineId, version = null) {
    const installed = this.getInstalledVersions(engineId);
    if (version) {
      return installed.some(v => v.version === version);
    }
    return installed.length > 0;
  }

  /**
   * 验证依赖是否满足
   */
  checkDependencies(engineId, version) {
    const engine = this.getEngine(engineId);
    if (!engine) {
      return { satisfied: false, missing: [], error: 'Engine not found' };
    }

    const versionInfo = this.getEngineVersionInfo(engineId, version);
    if (!versionInfo) {
      return { satisfied: false, missing: [], error: 'Version not found' };
    }

    const missing = [];

    const deps = (engine.dependencies || []).filter(d => d && d.trim());
    for (const depId of deps) {
      const depVersions = this.getInstalledVersions(depId);
      if (depVersions.length === 0) {
        missing.push({ id: depId, reason: '未安装' });
      } else if (versionInfo.rocm_version) {
        // 检查特定版本依赖
        const hasMatch = depVersions.some(v => v.version === versionInfo.rocm_version);
        if (!hasMatch) {
          missing.push({
            id: depId,
            reason: `需要版本 ${versionInfo.rocm_version}`
          });
        }
      }
    }

    return { satisfied: missing.length === 0, missing };
  }

  /**
   * 标记版本已安装（已废弃，保留空实现以兼容）
   * 现在通过扫描文件系统自动检测，无需手动标记
   */
  async markInstalled(engineId, version, installPath) {
    // 不再需要写入 config.json，扫描文件系统即可
    console.log(`Engine ${engineId} version ${version} installed at ${installPath}`);
  }

  /**
   * 卸载指定版本目录（Windows 上对瞬时占用做短暂重试）
   */
  async _removeVersionDirWithRetry(dirPath, maxRetries = 6) {
    let lastError = null;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        return true;
      } catch (err) {
        lastError = err;
        const transientBusy = err.code === 'EPERM' || err.code === 'EBUSY';
        if (!transientBusy || i === maxRetries) {
          throw err;
        }
        const waitMs = 120 * (i + 1);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    if (lastError) throw lastError;
    return false;
  }


  async uninstall(engineId, version) {
    // 先查已安装版本，找不到再查残损版本
    const installed = this.getInstalledVersions(engineId);
    let versionInfo = installed.find(v => v.version === version);

    if (!versionInfo) {
      const broken = this.getBrokenVersions(engineId);
      versionInfo = broken.find(v => v.version === version);
    }

    if (!versionInfo) {
      throw new Error('版本不存在');
    }

    if (!fs.existsSync(versionInfo.path)) {
      return; // 目录已不存在，视为成功
    }

    try {
      await this._removeVersionDirWithRetry(versionInfo.path);
      console.log(`Uninstalled ${engineId} version ${version}`);
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EBUSY') {
        throw new Error('部分文件正被系统占用，请停止所有相关模型后重试，或重启后再卸载');
      }
      throw err;
    }
  }

  /**
   * 获取引擎安装路径
   * @param {string} engineId - 引擎ID
   * @param {string} version - 版本号，如果不指定则使用最新版本
   */
  getEnginePath(engineId, version = null) {
    const targetVersion = version || this.getDefaultVersion(engineId);
    if (!targetVersion) return null;

    const installed = this.getInstalledVersions(engineId);
    const versionInfo = installed.find(v => v.version === targetVersion);
    return versionInfo?.path || null;
  }

  /**
   * 重新加载引擎定义（远程配置更新后调用）
   */
  getEngineRuntime(engineId, runtimeId) {
    const engine = this.getEngine(engineId);
    if (!engine) return null;
    const runtimes = engine.runtimes || [];
    // 也检查 variants
    const variants = engine.variants || [];
    for (const v of variants) {
      runtimes.push(...(v.runtimes || []));
    }
    return runtimes.find(r => r.id === runtimeId) || null;
  }

  reload(data) {
    this.engines = data;
    console.log(`[engineManager] 已重新加载 ${Object.keys(data.engines || {}).length} 个引擎定义`);
  }
}

export default new EngineManager();

