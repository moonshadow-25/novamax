import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEFAULT_MASK = '255.255.0.0';
const DEFAULT_MTU = 1500;

async function runPowerShell(script, timeout = 10000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { encoding: 'utf-8', timeout }
  );
  return stdout;
}

export async function getUSB4Adapters() {
  if (process.platform !== 'win32') return [];

  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    '$adapters = Get-NetAdapter | Where-Object {',
    '  $_.InterfaceDescription -match "USB|RNDIS|P2P|Thunderbolt|USB4" -or',
    '  $_.InterfaceDescription -match "Remote NDIS|USB Ethernet"',
    '}',
    '$result = @($adapters | ForEach-Object {',
    '  $ip = (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -First 1).IPAddress',
    '  @{ name=$_.Name; ifIndex=$_.ifIndex; description=$_.InterfaceDescription; status=$_.Status; ip=$ip }',
    '})',
    '$result | ConvertTo-Json -Compress'
  ].join('\n');

  const raw = (await runPowerShell(script, 12000)).trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter(a => a && a.name);
}

async function runCommand(command, timeout = 10000) {
  try {
    return await execAsync(command, { timeout, encoding: 'utf-8' });
  } catch (e) {
    const detail = [e.stderr, e.stdout, e.message]
      .filter(Boolean)
      .map(s => String(s).trim())
      .filter(Boolean)
      .join(' | ');
    throw new Error(`命令执行失败: ${command}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function runElevatedCommandChain(commands) {
  const cmdChain = commands.join(' && ');
  const escaped = cmdChain.replace(/"/g, '\\"').replace(/'/g, "''");
  const script = [
    '$ErrorActionPreference="Stop"',
    `$args = '/c "${escaped}"'`,
    '$proc = Start-Process -FilePath "cmd.exe" -ArgumentList $args -Verb RunAs -WindowStyle Hidden -Wait -PassThru',
    'Write-Output $proc.ExitCode'
  ].join('\n');

  const out = (await runPowerShell(script, 30000)).trim();
  const exitCode = Number.parseInt(out, 10);
  if (!Number.isInteger(exitCode) || exitCode !== 0) {
    throw new Error(`提权执行失败，退出码=${Number.isInteger(exitCode) ? exitCode : 'unknown'}`);
  }
}

async function runElevatedPowerShell(scriptBody, timeout = 30000) {
  const encodedBody = Buffer.from(scriptBody, 'utf16le').toString('base64');
  const launcher = [
    '$ErrorActionPreference="Stop"',
    `$args = '-NoProfile -NonInteractive -EncodedCommand ${encodedBody}'`,
    '$proc = Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs -WindowStyle Hidden -Wait -PassThru',
    'Write-Output $proc.ExitCode'
  ].join('\n');

  const out = (await runPowerShell(launcher, timeout)).trim();
  const exitCode = Number.parseInt(out, 10);
  if (!Number.isInteger(exitCode) || exitCode !== 0) {
    throw new Error(`提权 PowerShell 执行失败，退出码=${Number.isInteger(exitCode) ? exitCode : 'unknown'}`);
  }
}

function normalizeIPv4(ip) {
  if (!ip || typeof ip !== 'string') return '';
  return ip.trim();
}

function createNetworkLogger(logger) {
  return {
    info: (message) => {
      console.log(message);
      if (typeof logger === 'function') logger('info', message);
    },
    warn: (message) => {
      console.warn(message);
      if (typeof logger === 'function') logger('warn', message);
    }
  };
}

function maskToPrefix(mask) {
  const parts = String(mask || '').split('.').map(n => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 16;
  }
  let bits = 0;
  for (const n of parts) {
    bits += n.toString(2).split('1').length - 1;
  }
  return bits;
}

async function getAdapterIfIndex(adapterName) {
  const safeName = adapterName.replace(/'/g, "''");
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    `$idx = (Get-NetAdapter -Name '${safeName}' -EA SilentlyContinue | Select-Object -First 1 -ExpandProperty ifIndex)`,
    'if ($idx) { Write-Output $idx }'
  ].join('\n');
  const out = (await runPowerShell(script, 10000)).trim();
  const idx = Number.parseInt(out, 10);
  return Number.isInteger(idx) ? idx : null;
}

export async function getAdapterIPv4List(adapterName) {
  if (process.platform !== 'win32') return [];

  const safeName = adapterName.replace(/'/g, "''");
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    `$ips = @(Get-NetIPAddress -InterfaceAlias '${safeName}' -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -ExpandProperty IPAddress)`,
    '$ips | ConvertTo-Json -Compress'
  ].join('\n');

  const out = (await runPowerShell(script, 10000)).trim();
  if (!out) return [];

  try {
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(normalizeIPv4).filter(Boolean);
  } catch {
    return out ? [normalizeIPv4(out)] : [];
  }
}

export async function setNetworkIP(adapterName, ip, mask = DEFAULT_MASK, mtu = DEFAULT_MTU, adapterIfIndex = null, logger = null) {
  if (process.platform !== 'win32') {
    throw new Error('仅支持 Windows 网络配置');
  }

  const netlog = createNetworkLogger(logger);
  const resolvedIfIndex = Number.isInteger(adapterIfIndex) ? adapterIfIndex : await getAdapterIfIndex(adapterName);

  let ipSet = false;
  let lastError = null;
  let mtuHandledByElevated = false;
  let elevationUsed = false;
  let appliedMethod = 'unknown';

  netlog.info(`[windowsNetworkUtils] 开始配置IP: adapter=${adapterName}, ifIndex=${resolvedIfIndex || 'N/A'}, target=${ip}/${mask}`);

  // 主路径：ifIndex + 提权 PowerShell（最稳定）
  if (resolvedIfIndex) {
    try {
      const prefix = maskToPrefix(mask);
      const script = [
        '$ErrorActionPreference="Stop"',
        `$idx=${resolvedIfIndex}`,
        `Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue | ForEach-Object { Remove-NetIPAddress -InterfaceIndex $idx -IPAddress $_.IPAddress -Confirm:$false -EA SilentlyContinue }`,
        `New-NetIPAddress -InterfaceIndex $idx -IPAddress '${ip}' -PrefixLength ${prefix} -Type Unicast -EA Stop`,
        'Write-Output "OK"'
      ].join('\n');
      netlog.info('[windowsNetworkUtils] 尝试主路径: elevated-powershell-ifindex-primary');
      await runElevatedPowerShell(script, 30000);
      ipSet = true;
      appliedMethod = 'elevated-powershell-ifindex-primary';
      mtuHandledByElevated = true;
      elevationUsed = true;
      netlog.info('[windowsNetworkUtils] 主路径成功: elevated-powershell-ifindex-primary');
    } catch (e) {
      lastError = e;
      netlog.warn(`[windowsNetworkUtils] 主路径失败: elevated-powershell-ifindex-primary -> ${e.message}`);
    }
  } else {
    netlog.warn('[windowsNetworkUtils] 未获取到 ifIndex，跳过主路径，进入 netsh 兜底');
  }

  // 兜底：按网卡名称执行 netsh
  if (!ipSet) {
    const fallbackCommand = `netsh interface ipv4 set address interface="${adapterName}" static ${ip} ${mask}`;
    try {
      netlog.info('[windowsNetworkUtils] 尝试兜底方法: netsh-interface-v1');
      await runCommand(fallbackCommand, 10000);
      ipSet = true;
      appliedMethod = 'netsh-interface-v1';
      netlog.info('[windowsNetworkUtils] 兜底方法成功: netsh-interface-v1');
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('requires elevation') && !elevationUsed) {
        try {
          netlog.info('[windowsNetworkUtils] 尝试兜底提权: elevated-netsh-interface-v1');
          await runElevatedCommandChain([fallbackCommand]);
          ipSet = true;
          appliedMethod = 'elevated-netsh-interface-v1';
          elevationUsed = true;
          netlog.info('[windowsNetworkUtils] 兜底提权成功: elevated-netsh-interface-v1');
        } catch (e2) {
          lastError = e2;
          netlog.warn(`[windowsNetworkUtils] 兜底提权失败: elevated-netsh-interface-v1 -> ${e2.message}`);
        }
      } else {
        netlog.warn(`[windowsNetworkUtils] 兜底方法失败: netsh-interface-v1 -> ${e.message}`);
      }
    }
  }

  if (!ipSet) {
    throw new Error(`网络配置失败 (${adapterName}): ${lastError?.message || '设置IP失败'}。请确认已授予管理员权限，或在 Windows 网络适配器里手动将该网卡IPv4改为 ${ip}/${mask}`);
  }

  // 写后校验：确认网卡IP列表包含目标值
  const targetIp = normalizeIPv4(ip);
  let appliedIpList = [];
  for (let i = 0; i < 12; i++) {
    appliedIpList = await getAdapterIPv4List(adapterName);
    if (appliedIpList.includes(targetIp)) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // 主路径/兜底返回成功但地址未切换，补一次 ifIndex 强制重写
  if (!appliedIpList.includes(targetIp)) {
    try {
      const ifIndex = resolvedIfIndex;
      if (ifIndex) {
        netlog.warn('[windowsNetworkUtils] 写后校验未命中目标IP，尝试补救: elevated-powershell-ifindex-force');
        const prefix = maskToPrefix(mask);
        const forceScript = [
          '$ErrorActionPreference="Stop"',
          `$idx=${ifIndex}`,
          `Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue | ForEach-Object { Remove-NetIPAddress -InterfaceIndex $idx -IPAddress $_.IPAddress -Confirm:$false -EA SilentlyContinue }`,
          `New-NetIPAddress -InterfaceIndex $idx -IPAddress '${targetIp}' -PrefixLength ${prefix} -Type Unicast -EA Stop`,
          'Write-Output "OK"'
        ].join('\n');
        await runElevatedPowerShell(forceScript, 30000);
        elevationUsed = true;
        mtuHandledByElevated = true;
        appliedMethod = 'elevated-powershell-ifindex-force';
        netlog.info('[windowsNetworkUtils] 补救方法成功: elevated-powershell-ifindex-force');
      } else {
        netlog.warn('[windowsNetworkUtils] 无 ifIndex，无法执行补救方法 elevated-powershell-ifindex-force');
      }
    } catch (e) {
      lastError = e;
      netlog.warn(`[windowsNetworkUtils] 补救方法失败: elevated-powershell-ifindex-force -> ${e.message}`);
    }

    for (let i = 0; i < 20; i++) {
      appliedIpList = await getAdapterIPv4List(adapterName);
      if (appliedIpList.includes(targetIp)) break;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!appliedIpList.includes(targetIp)) {
    throw new Error(`网络配置失败 (${adapterName}): 目标IP=${targetIp}，当前IP列表=${appliedIpList.join(', ') || '未读取到'}${lastError?.message ? `，补救错误=${lastError.message}` : ''}`);
  }

  netlog.info(`[windowsNetworkUtils] IP 配置完成: method=${appliedMethod}, applied=${targetIp}, current=${appliedIpList.join(', ')}`);

  // MTU 设置失败不阻断主流程（某些网卡/驱动可能不支持）
  if (!mtuHandledByElevated) {
    const mtuCommand = `netsh interface ipv4 set subinterface "${adapterName}" mtu=${mtu} store=persistent`;
    try {
      await runCommand(mtuCommand, 10000);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('requires elevation') && !elevationUsed) {
        try {
          await runElevatedCommandChain([mtuCommand]);
        } catch (e2) {
          console.warn(`[windowsNetworkUtils] MTU 设置失败（忽略）: ${e2.message}`);
        }
      } else if (!msg.includes('requires elevation')) {
        console.warn(`[windowsNetworkUtils] MTU 设置失败（忽略）: ${e.message}`);
      }
    }
  }

  return { applied_ip: targetIp, ip_list: appliedIpList };
}

export async function createNetworkBridge(adapters) {
  if (process.platform !== 'win32') {
    throw new Error('仅支持 Windows 网桥配置');
  }

  if (!Array.isArray(adapters) || adapters.length < 2) {
    throw new Error('创建网桥至少需要两个网卡');
  }

  await runCommand('netsh bridge install', 10000);
  for (const a of adapters) {
    await runCommand(`netsh bridge set adapter "${a.name}" forcecompatmode=enable`, 5000);
  }

  return { bridgeName: 'Network Bridge' };
}

export async function destroyNetworkBridge() {
  if (process.platform !== 'win32') return;
  try {
    await runCommand('netsh bridge uninstall', 10000);
  } catch (e) {
    // 部分系统不支持 bridge uninstall 子命令，静默忽略
    const msg = String(e.message || '');
    if (msg.includes('command was not found') || msg.includes('not found: bridge uninstall')) {
      return;
    }
    console.warn(`[windowsNetworkUtils] 删除网桥失败（忽略）: ${e.message}`);
  }
}

export async function configureSingleUSBAdapter(adapterNameOrAdapter, ip, mask = DEFAULT_MASK, logger = null) {
  const adapterName = typeof adapterNameOrAdapter === 'string' ? adapterNameOrAdapter : adapterNameOrAdapter?.name;
  const adapterIfIndex = typeof adapterNameOrAdapter === 'string' ? null : adapterNameOrAdapter?.ifIndex;
  const { applied_ip } = await setNetworkIP(adapterName, ip, mask, DEFAULT_MTU, adapterIfIndex, logger);
  return { network_mode: 'single', adapter: adapterName, applied_ip };
}

export async function configureMultiUSBAdapters(adapters, ip, mask = DEFAULT_MASK, logger = null) {
  const { bridgeName } = await createNetworkBridge(adapters);
  const { applied_ip } = await setNetworkIP(bridgeName, ip, mask, DEFAULT_MTU, null, logger);
  return { network_mode: 'bridge', bridge: bridgeName, applied_ip };
}

export { DEFAULT_MASK, DEFAULT_MTU };
