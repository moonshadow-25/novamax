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
    return this.engines?.engines?.[engineId] || null;
  }

  /**
   * 获取已安装的引擎版本列表
   * 扫描 external/{engineId}/ 目录，通过文件修改时间判断安装时间
   */
  getInstalledVersions(engineId) {
    const engine = this.getEngine(engineId);
    if (!engine) return [];

    const installed = [];
    const basePath = path.join(PROJECT_ROOT, 'external', engineId);

    if (!fs.existsSync(basePath)) return [];

    const versionDirs = fs.readdirSync(basePath, { withFileTypes: true });
    for (const dir of versionDirs) {
      if (dir.isDirectory()) {
        const versionPath = path.join(basePath, dir.name);
        if (this._isValidEngineDir(engineId, versionPath)) {
          const stats = fs.statSync(path.join(versionPath, '.installed'));
          const marker = JSON.parse(fs.readFileSync(path.join(versionPath, '.installed'), 'utf-8'));
          installed.push({
            version: dir.name,
            path: versionPath,
            installed_at: marker.installed_at || stats.mtime.toISOString()
          });
        }
      }
    }

    // 按安装时间倒序排序（最新的在前）
    installed.sort((a, b) => {
      const timeA = new Date(a.installed_at).getTime();
      const timeB = new Date(b.installed_at).getTime();
      return timeB - timeA;
    });

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
    const basePath = path.join(PROJECT_ROOT, 'external', engineId);
    if (!fs.existsSync(basePath)) return [];

    const broken = [];
    const versionDirs = fs.readdirSync(basePath, { withFileTypes: true });
    for (const dir of versionDirs) {
      if (dir.isDirectory()) {
        const versionPath = path.join(basePath, dir.name);
        if (this._isBrokenEngineDir(engineId, versionPath)) {
          broken.push({ version: dir.name, path: versionPath });
        }
      }
    }
    return broken;
  }

  /**
   * 获取默认版本（最新安装的版本）
   */
  getDefaultVersion(engineId) {
    const installed = this.getInstalledVersions(engineId);
    if (installed.length === 0) return null;
    return installed[0].version;
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

    const versionInfo = engine.versions.find(v => v.version === version);
    if (!versionInfo) {
      return { satisfied: false, missing: [], error: 'Version not found' };
    }

    const missing = [];

    for (const depId of engine.dependencies || []) {
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
   * 卸载指定版本
   */
  async uninstall(engineId, version) {
    const installed = this.getInstalledVersions(engineId);
    const versionInfo = installed.find(v => v.version === version);

    if (!versionInfo) {
      throw new Error('Version not installed');
    }

    // 删除文件目录
    if (fs.existsSync(versionInfo.path)) {
      fs.rmSync(versionInfo.path, { recursive: true, force: true });
      console.log(`Uninstalled ${engineId} version ${version}`);
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
  reload(data) {
    this.engines = data;
    console.log(`[engineManager] 已重新加载 ${Object.keys(data.engines || {}).length} 个引擎定义`);
  }
}

export default new EngineManager();

