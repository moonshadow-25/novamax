/**
 * engine/lifecycle + registry 集成测试。
 * 测试引擎发现、注册、生命周期状态转换。
 */
import { describe, it } from 'node:test';
import { assertEqual, assert } from './test-setup.js';
import { createRegistry } from '../../src/tts/engine/registry.js';
import { getStatus } from '../../src/tts/engine/lifecycle.js';

describe('engine/registry', () => {
  it('新注册表为空', () => {
    const registry = createRegistry();
    assert(!registry.has('any-engine'));
  });

  it('getStatus 空注册表返回 idle', () => {
    const registry = createRegistry();
    const status = getStatus(registry);
    assertEqual(status.status, 'idle');
    assert(!status.running);
    assertEqual(Object.keys(status.engines).length, 0);
  });

  it('getIdleEngines 返回空闲引擎', () => {
    const registry = createRegistry();
    registry.set('test-engine', {
      status: 'running', activeTasks: 0,
      lastActiveTime: Date.now() - 10 * 60 * 1000, // 10 分钟前
    });

    registry.setIdleTimeoutGetter(() => 5 * 60 * 1000);
    const idle = registry.getIdleEngines();
    assertEqual(idle.length, 1);
    assertEqual(idle[0].type, 'test-engine');
  });

  it('getIdleEngines 不返回活跃引擎', () => {
    const registry = createRegistry();
    registry.set('test-engine', {
      status: 'running', activeTasks: 1,
      lastActiveTime: Date.now(),
    });

    registry.setIdleTimeoutGetter(() => 1);
    const idle = registry.getIdleEngines();
    assertEqual(idle.length, 0);
  });

  it('getIdleEngines 不返回非 running 状态引擎', () => {
    const registry = createRegistry();
    registry.set('test-engine', {
      status: 'idle', activeTasks: 0,
      lastActiveTime: Date.now() - 10 * 60 * 1000,
    });

    registry.setIdleTimeoutGetter(() => 1);
    const idle = registry.getIdleEngines();
    assertEqual(idle.length, 0);
  });

  it('getStatus 检测引擎状态', () => {
    const registry = createRegistry();
    registry.set('engine-A', {
      status: 'running', activeTasks: 0, report: {},
      lastActiveTime: Date.now(), _alive: true,
    });

    const status = getStatus(registry);
    assert(status.running);
    assertEqual(status.engines['engine-A'].status, 'running');
  });

  it('getStatus 检测 busy 状态', () => {
    const registry = createRegistry();
    registry.set('engine-A', {
      status: 'running', activeTasks: 1, report: {},
      lastActiveTime: Date.now(), _alive: true,
    });

    const status = getStatus(registry);
    assertEqual(status.engines['engine-A'].status, 'busy');
  });

  it('getStatus 检测 error 状态（unhealthy）', () => {
    const registry = createRegistry();
    registry.set('engine-A', {
      status: 'running', activeTasks: 0,
      report: { health: { status: 'unhealthy' } },
      lastActiveTime: Date.now(), _alive: true,
    });

    const status = getStatus(registry);
    assertEqual(status.status, 'error');
  });
});
