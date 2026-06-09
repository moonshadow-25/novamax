import fs from 'fs';
import path from 'path';
import { normalizeEngineType } from '../../utils/engineTypeHelper.js';

export function discoverEngines(enginesDir) {
  if (!enginesDir || !fs.existsSync(enginesDir)) return [];

  const matches = [];
  const variantDirs = fs.readdirSync(enginesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_temp_'));

  for (const variantEntry of variantDirs) {
    const variantPath = path.join(enginesDir, variantEntry.name);
    const candidateDirs = [variantPath];

    let versionDirs;
    try {
      versionDirs = fs.readdirSync(variantPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_temp_'));
    } catch {
      versionDirs = [];
    }
    for (const vd of versionDirs) {
      candidateDirs.push(path.join(variantPath, vd.name));
    }

    for (const dir of candidateDirs) {
      const contractPath = path.join(dir, 'contract.json');
      const adapterPath = path.join(dir, 'adapter.js');
      const installedPath = path.join(dir, '.installed');

      if (!fs.existsSync(contractPath) || !fs.existsSync(adapterPath) || !fs.existsSync(installedPath)) continue;

      let contract;
      try {
        contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
      } catch {
        continue;
      }

      const engineType = contract?.engine?.type;
      if (!engineType) continue;

      let installedVersion = contract.engine?.version || '0.0.0';
      try {
        const m = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
        installedVersion = m.version || installedVersion;
      } catch {}

      const priority = normalizeEngineType(variantEntry.name) === normalizeEngineType(engineType) ? 1 : 0;
      matches.push({ engineType, adapterPath, installDir: dir, version: installedVersion, priority, contract });
    }
  }

  // 只按优先级分组，不排序版本——调用方按 engines.json 顺序决定
  matches.sort((a, b) => b.priority - a.priority);

  return matches;
}
