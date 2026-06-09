import modelManager from '../services/modelManager.js';
import processManager from '../services/processManager.js';
import { normalizeEngineType } from '../utils/engineTypeHelper.js';

export function resolveModelDir(engineType) {
  const models = modelManager.getByType('tts');
  const norm = normalizeEngineType(engineType);
  const m = models.find(m =>
    normalizeEngineType(m.engine_version) === norm || normalizeEngineType(m.id) === norm
  );
  return m?.local_path || '';
}

export function findLlmPort() {
  const running = processManager.getAllRunning();
  const llm = running.find(p => p.type === 'llm');
  return llm?.port || 0;
}
