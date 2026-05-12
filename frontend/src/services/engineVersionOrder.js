export function orderInstalledVersionsByAvailable(availableVersions = [], installedVersions = []) {
  const availableIndexMap = new Map(
    (availableVersions || []).map((v, index) => [v?.version, index])
  );

  return [...(installedVersions || [])].sort((a, b) => {
    const ai = availableIndexMap.has(a?.version) ? availableIndexMap.get(a.version) : Number.MAX_SAFE_INTEGER;
    const bi = availableIndexMap.has(b?.version) ? availableIndexMap.get(b.version) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return String(b?.version || '').localeCompare(String(a?.version || ''));
  });
}

export function getLatestInstalledVersion(availableVersions = [], installedVersions = []) {
  const installedSet = new Set((installedVersions || []).map(v => v?.version));
  return (availableVersions || []).find(v => installedSet.has(v?.version))?.version || null;
}

export function resolveVersionOrder(availableVersions = [], installedVersions = []) {
  const orderedInstalledVersions = orderInstalledVersionsByAvailable(availableVersions, installedVersions);
  const latestInstalledVersion = getLatestInstalledVersion(availableVersions, orderedInstalledVersions);
  return { orderedInstalledVersions, latestInstalledVersion };
}
