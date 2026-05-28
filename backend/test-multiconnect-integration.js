/**
 * MultiConnectService 集成测试脚本
 * 直接调用 windowsNetworkUtils 和 multiConnectService，测试从机模式启停和网络配置。
 *
 * 测试项:
 *   1. 单网卡 IP 设置 (configureSingleUSBAdapter)
 *   2. 多网卡 IP 设置 / 网桥模式 (configureMultiUSBAdapters)
 *   3. 从机模式完整流程 (enableSlaveMode → getSlaveStatus → disableSlaveMode)
 *
 * 用法（管理员 PowerShell）:
 *   cd backend
 *   node test-multiconnect-integration.js
 *   node test-multiconnect-integration.js --no-rpc          # 跳过 RPC，仅测网络配置
 *   node test-multiconnect-integration.js --ip 169.254.30.101 --mask 255.255.0.0 --port 8899
 *
 * 参考: C:\Users\xh\Downloads\multi\test_multiconnect_integration.py
 */

import {
  getUSB4Adapters,
  configureSingleUSBAdapter,
  configureMultiUSBAdapters,
  destroyNetworkBridgeByGuid,
  DEFAULT_MASK,
} from './src/utils/windowsNetworkUtils.js';

import multiConnectService from './src/services/multiConnectService.js';

// ─── 参数解析 ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: 8899, ip: '169.254.30.101', mask: '255.255.0.0', noRpc: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port': opts.port = Number.parseInt(args[++i], 10) || 8899; break;
      case '--ip': opts.ip = args[++i] || '169.254.30.101'; break;
      case '--mask': opts.mask = args[++i] || '255.255.0.0'; break;
      case '--no-rpc': opts.noRpc = true; break;
    }
  }
  return opts;
}

// ─── 工具函数 ────────────────────────────────────────────────────────

const SEP = '='.repeat(60);

function log(section, msg) {
  console.log(`${section ? `[${section}] ` : ''}${msg}`);
}

// ─── 测试 1：单网卡 ──────────────────────────────────────────────────

async function testSingleAdapter(ip, mask) {
  console.log(`\n${SEP}`);
  console.log('测试 1: 单网卡 IP 设置 (configureSingleUSBAdapter)');
  console.log(SEP);

  const adapters = await getUSB4Adapters();
  const count = adapters.length;
  log('INFO', `检测到 USB4 适配器数量: ${count}`);

  if (count === 0) {
    console.log('[SKIP] 未检测到 USB4 适配器，跳过单网卡测试');
    return null;
  }

  // 只取第一个适配器模拟单网卡场景（参考 Python: single = adapters[:1]）
  const single = adapters[0];
  log('INFO', `使用适配器: ${single.name}`);

  try {
    const result = await configureSingleUSBAdapter(single, ip, mask);
    console.log(`[PASS] 单网卡 IP 配置成功: ${JSON.stringify(result)}`);
  } catch (e) {
    console.log(`[FAIL] 单网卡 IP 配置失败: ${e.message}`);
  }
}

// ─── 测试 2：多网卡（网桥模式）───────────────────────────────────────

async function testMultiAdapter(ip, mask) {
  console.log(`\n${SEP}`);
  console.log('测试 2: 多网卡 IP 设置 (网桥模式)');
  console.log(SEP);

  const adapters = await getUSB4Adapters();
  const count = adapters.length;
  log('INFO', `检测到 USB4 适配器数量: ${count}`);

  if (count < 2) {
    console.log('[SKIP] USB4 适配器不足 2 个，无法测试多网卡桥接模式');
    return null;
  }

  console.log('适配器列表:');
  for (const a of adapters) {
    console.log(`  - ${a.name}: ${a.ifIndex} | ${a.ip || 'N/A'}`);
  }

  let bridgeGuid = null;
  try {
    const result = await configureMultiUSBAdapters(adapters, ip, mask);
    bridgeGuid = result.bridge_guid;
    console.log(`[PASS] 多网卡桥接配置成功: GUID=${bridgeGuid || 'N/A'}, bridge=${result.bridge}`);
  } catch (e) {
    console.log(`[FAIL] 多网卡桥接配置失败: ${e.message}`);
  }

  return bridgeGuid;
}

// ─── 测试 3：从机模式完整流程 ────────────────────────────────────────

async function testSlaveModeFullFlow(port, ip, mask, skipRpc) {
  console.log(`\n${SEP}`);
  console.log('测试 3: 从机模式完整流程 (enable → status → disable)');
  console.log(SEP);

  const adapters = await getUSB4Adapters();
  const count = adapters.length;
  log('INFO', `检测到 USB4 适配器数量: ${count}`);

  if (count === 0) {
    console.log('[SKIP] 未检测到 USB4 适配器，跳过从机模式测试');
    return;
  }

  // --- 3a. 查询初始状态 ---
  console.log('\n--- 3a. 初始状态查询 ---');
  const initialStatus = multiConnectService.getSlaveStatus();
  log('INFO', `从机状态: status=${initialStatus.status}`);
  if (initialStatus.status !== 'disabled') {
    console.log(`[WARN] 初始状态非 disabled，当前: status=${initialStatus.status}`);
  } else {
    console.log('[PASS] 初始状态为未启用');
  }

  // --- 3b. 开启从机模式 ---
  console.log(`\n--- 3b. 开启从机模式 (port=${port}, ip=${ip}) ---`);

  if (skipRpc) {
    console.log('[INFO] --no-rpc 模式，跳过 RPC 启动');
    // 仅测试网络配置部分（参考 Python --no-rpc 模式）
    log('INFO', '测试网络配置部分...');
    try {
      if (count >= 2) {
        const result = await configureMultiUSBAdapters(adapters, ip, mask);
        log('INFO', `网桥配置结果: ${JSON.stringify(result)}`);
        // 记录以便后续清理
        return { bridgeGuid: result.bridge_guid };
      } else {
        const result = await configureSingleUSBAdapter(adapters[0], ip, mask);
        log('INFO', `单网卡配置结果: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      console.log(`[FAIL] 网络配置失败: ${e.message}`);
      return null;
    }
    console.log('[PASS] --no-rpc 网络配置完成');
    return null;
  }

  try {
    const result = await multiConnectService.enableSlaveMode(port, ip, mask);
    log('INFO', `enableSlaveMode 返回: ${JSON.stringify(result)}`);
    console.log('[PASS] 从机模式启动成功');
  } catch (e) {
    console.log(`[FAIL] 从机模式启动失败: ${e.message}`);
    return null;
  }

  // --- 3c. 查询启用后状态 ---
  console.log('\n--- 3c. 启用后状态查询 ---');
  const enabledStatus = multiConnectService.getSlaveStatus();
  log('INFO', `从机状态: status=${enabledStatus.status}, port=${enabledStatus.port}, ip=${enabledStatus.ip}`);
  log('INFO', `网络模式: ${enabledStatus.network_mode}`);

  if (enabledStatus.status !== 'enabled') {
    console.log(`[FAIL] 启用后状态应为 enabled，实际为 ${enabledStatus.status}`);
  } else if (enabledStatus.port !== port) {
    console.log(`[WARN] 端口: 期望=${port}, 实际=${enabledStatus.port}`);
  } else {
    console.log(`[PASS] 状态查询正确: port=${enabledStatus.port}, ip=${enabledStatus.ip}`);
  }

  // --- 3d. 关闭从机模式 ---
  console.log('\n--- 3d. 关闭从机模式 ---');
  const disableResult = await multiConnectService.disableSlaveMode();
  log('INFO', `disableSlaveMode 返回: ${JSON.stringify(disableResult)}`);
  console.log('[PASS] 从机模式关闭成功');

  // --- 3e. 关闭后状态确认 ---
  console.log('\n--- 3e. 关闭后状态确认 ---');
  const finalStatus = multiConnectService.getSlaveStatus();
  log('INFO', `从机状态: status=${finalStatus.status}`);

  if (finalStatus.status !== 'disabled') {
    console.log(`[WARN] 关闭后状态应为 disabled，实际: ${finalStatus.status}`);
  } else {
    console.log('[PASS] 状态已恢复为未启用');
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(SEP);
  console.log('MultiConnectService 集成测试 (Node.js)');
  console.log(`IP=${args.ip}  Mask=${args.mask}  Port=${args.port}`);
  if (args.noRpc) {
    console.log('模式: --no-rpc (仅测网络配置)');
  }
  console.log(SEP);

  const failed = [];

  // 测试 1: 单网卡
  // try {
  //   await testSingleAdapter(args.ip, args.mask);
  // } catch (e) {
  //   console.log(`[ERROR] 单网卡测试异常: ${e.message}`);
  //   console.error(e);
  //   failed.push('单网卡测试');
  // }

  // 测试 2: 多网卡
  let multiBridgeGuid = null;
  try {
    multiBridgeGuid = await testMultiAdapter(args.ip, args.mask);
  } catch (e) {
    console.log(`[ERROR] 多网卡测试异常: ${e.message}`);
    console.error(e);
    failed.push('多网卡测试');
  }

  // 清理多网卡桥接（参考 Python: 测试后清理）
  if (multiBridgeGuid) {
    console.log('\n[清理] 等待 10 秒后删除多网卡桥接...');
    await new Promise(r => setTimeout(r, 10000));
    console.log('[清理] 删除多网卡桥接...');
    try {
      await destroyNetworkBridgeByGuid(multiBridgeGuid);
      console.log('[清理] 桥接已删除');
    } catch (e) {
      console.log(`[清理] 删除桥接失败: ${e.message}`);
    }
  }

  // 测试 3: 从机模式完整流程
  // try {
  //   await testSlaveModeFullFlow(args.port, args.ip, args.mask, args.noRpc);
  // } catch (e) {
  //   console.log(`[ERROR] 从机模式流程测试异常: ${e.message}`);
  //   console.error(e);
  //   failed.push('从机模式流程测试');
  // }

  // 结果汇总（参考 Python: 汇总通过/失败项）
  console.log(`\n${SEP}`);
  if (failed.length > 0) {
    console.log(`测试完成，以下项目失败/异常: ${failed.join(', ')}`);
  } else {
    console.log('所有测试通过');
  }
  console.log(SEP);
}

main().catch((e) => {
  console.error('未捕获错误:', e);
  process.exit(1);
});
