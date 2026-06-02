export function createRegistry() {
  const engines = new Map();
  let idleTimeoutGetter = () => 5 * 60 * 1000;

  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    get(engineType) { return engines.get(norm(engineType)); },
    set(engineType, entry) { engines.set(norm(engineType), entry); },
    delete(engineType) { engines.delete(norm(engineType)); },
    has(engineType) { return engines.has(norm(engineType)); },
    entries() { return engines.entries(); },
    values() { return engines.values(); },

    setIdleTimeoutGetter(fn) { idleTimeoutGetter = fn; },
    getIdleTimeoutMs() { return idleTimeoutGetter(); },

    getIdleEngines() {
      const now = Date.now();
      const timeoutMs = idleTimeoutGetter();
      const result = [];
      for (const [type, entry] of engines) {
        if (entry.status !== 'running') continue;
        if (entry.activeTasks > 0) continue;
        if (now - entry.lastActiveTime < timeoutMs) continue;
        result.push({ type, entry });
      }
      return result;
    }
  };
}
