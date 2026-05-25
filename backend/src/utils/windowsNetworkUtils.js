import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEFAULT_MASK = '255.255.0.0';
const DEFAULT_MTU = 1500;

async function runPowerShell(script, timeout = 10000) {
  const fullScript = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    script
  ].join('\n');
  const encoded = Buffer.from(fullScript, 'utf16le').toString('base64');
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { encoding: 'utf-8', timeout }
  );
  return stdout;
}

async function getNetshInterfaceNames() {
  if (process.platform !== 'win32') return [];

  try {
    const raw = await runPowerShell('netsh interface show interface', 10000);

    const lines = String(raw || '').split(/\r?\n/);
    const names = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.includes('---')) continue;
      const parts = line.split(/\s{2,}/).map(v => v.trim()).filter(Boolean);
      if (parts.length >= 4) {
        names.push(parts[parts.length - 1]);
      }
    }

    return [...new Set(names)];
  } catch {
    return [];
  }
}

export async function getUSB4Adapters() {
  if (process.platform !== 'win32') return [];

  const interfaceNames = await getNetshInterfaceNames();
  const netshNameSet = new Set(interfaceNames);

  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    '$adapters = Get-NetAdapter | ForEach-Object {',
    '  $ips = @(Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -ExpandProperty IPAddress)',
    '  @{ name=$_.Name; ifIndex=$_.ifIndex; description=$_.InterfaceDescription; status=$_.Status; ips=$ips }',
    '}',
    '$adapters | ConvertTo-Json -Compress'
  ].join('\n');

  const raw = (await runPowerShell(script, 12000)).trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : [parsed];

  const includeKeyword = /(usb|rndis|remote\s*ndis|usb\s*ethernet|thunderbolt|usb4|p2p\s*network)/i;
  const excludeKeyword = /(vmware|hyper-v|loopback|bluetooth|wireless|wi-fi|wlan|tap|vpn|virtualbox)/i;

  const filterAdapters = (items, requireNetshMatch) => items.filter((a) => {
    if (!a || !a.name) return false;
    const description = String(a.description || '');
    const status = String(a.status || '').toLowerCase();

    if (!includeKeyword.test(description)) return false;
    if (excludeKeyword.test(description)) return false;
    if (status.includes('disabled')) return false;

    if (requireNetshMatch && netshNameSet.size > 0 && !netshNameSet.has(a.name)) {
      return false;
    }
    return true;
  });

  let filtered = filterAdapters(arr, true);
  // 某些系统下 netsh 输出编码/命名与 Get-NetAdapter 不一致，放宽匹配避免误判“未检测到”
  if (filtered.length === 0) {
    filtered = filterAdapters(arr, false);
  }

  return filtered.map((a) => ({
    ...a,
    ip: Array.isArray(a.ips) ? (a.ips[0] || null) : null
  }));
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
  const fullBody = '[Console]::OutputEncoding = [Text.Encoding]::UTF8\n' + scriptBody;
  const encodedBody = Buffer.from(fullBody, 'utf16le').toString('base64');
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

async function getAdapterIPv4ListByIfIndex(ifIndex) {
  if (process.platform !== 'win32' || !Number.isInteger(ifIndex)) return [];

  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    `$ips = @(Get-NetIPAddress -InterfaceIndex ${ifIndex} -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -ExpandProperty IPAddress)`,
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
  const prefix = maskToPrefix(mask);
  const targetIp = normalizeIPv4(ip);

  let lastError = null;
  let appliedMethod = 'unknown';

  netlog.info(`[windowsNetworkUtils] 开始配置IP: adapter=${adapterName}, ifIndex=${resolvedIfIndex || 'N/A'}, target=${targetIp}/${mask}`);

  // 尝试设置 IP（按优先级依次尝试不同方法，直到写后校验通过）
  const methods = [];

  // 方法 1：ifIndex + 先删后设（Remove-NetIPAddress + netsh，解决网桥 APIPA 残留问题）
  if (resolvedIfIndex) {
    methods.push({
      name: 'remove-then-netsh-ifindex',
      fn: async () => {
        const script = [
          '$ErrorActionPreference="SilentlyContinue"',
          `$idx=${resolvedIfIndex}`,
          // 先删除接口上所有现有 IPv4 地址（关键：清除网桥创建时 Windows 自动分配的 APIPA）
          `Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue`,
          // 再用 netsh 设置静态 IP（禁用 DHCP + 写入静态地址）
          `netsh interface ipv4 set address interface=$idx static ${targetIp} ${mask}`,
          // 若 netsh 未生效，用 New-NetIPAddress 兜底写入
          `$current = @(Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue | Select-Object -ExpandProperty IPAddress)`,
          `if ($current -notcontains '${targetIp}') { New-NetIPAddress -InterfaceIndex $idx -IPAddress '${targetIp}' -PrefixLength ${prefix} -EA SilentlyContinue | Out-Null }`,
          'Write-Output "OK"'
        ].join('\n');
        await runElevatedPowerShell(script, 30000);
      }
    });
  }

  // 方法 2：参考 Python 项目 — netsh interface ip set address name="name" static ip mask
  methods.push({
    name: 'netsh-ip-name',
    fn: async () => {
      const cmd = `netsh interface ip set address name="${adapterName}" static ${targetIp} ${mask}`;
      try {
        await runCommand(cmd, 10000);
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('requires elevation')) {
          await runElevatedCommandChain([cmd]);
        } else {
          throw e;
        }
      }
    }
  });

  // 方法 3：netsh interface ipv4 set address interface="name"
  methods.push({
    name: 'netsh-ipv4-name',
    fn: async () => {
      const cmd = `netsh interface ipv4 set address interface="${adapterName}" static ${targetIp} ${mask}`;
      try {
        await runCommand(cmd, 10000);
      } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('requires elevation')) {
          await runElevatedCommandChain([cmd]);
        } else {
          throw e;
        }
      }
    }
  });

  // 方法 4：ifIndex + 纯 PowerShell（Remove + New-NetIPAddress）
  if (resolvedIfIndex) {
    methods.push({
      name: 'remove-then-new-netip',
      fn: async () => {
        const script = [
          '$ErrorActionPreference="SilentlyContinue"',
          `$idx=${resolvedIfIndex}`,
          `Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -EA SilentlyContinue | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue`,
          `New-NetIPAddress -InterfaceIndex $idx -IPAddress '${targetIp}' -PrefixLength ${prefix} -EA SilentlyContinue | Out-Null`,
          'Write-Output "OK"'
        ].join('\n');
        await runElevatedPowerShell(script, 30000);
      }
    });
  }

  // 依次尝试
  for (const method of methods) {
    try {
      netlog.info(`[windowsNetworkUtils] 尝试方法: ${method.name}`);
      await method.fn();
      appliedMethod = method.name;
      netlog.info(`[windowsNetworkUtils] 方法完成: ${method.name}（等待校验）`);
    } catch (e) {
      lastError = e;
      netlog.warn(`[windowsNetworkUtils] 方法失败: ${method.name} -> ${e.message}`);
      continue;
    }

    // 写后校验
    let appliedIpList = [];
    for (let i = 0; i < 10; i++) {
      const listByAlias = await getAdapterIPv4List(adapterName);
      const listByIfIndex = await getAdapterIPv4ListByIfIndex(resolvedIfIndex);
      appliedIpList = [...new Set([...listByAlias, ...listByIfIndex])];
      if (appliedIpList.includes(targetIp)) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (appliedIpList.includes(targetIp)) {
      netlog.info(`[windowsNetworkUtils] IP 配置成功: method=${appliedMethod}, applied=${targetIp}, current=${appliedIpList.join(', ')}`);

      // MTU 设置（网桥使用名称方式，参考 Python addcommand_set_ip_and_mtu）
      const mtuScript = [
        '$ErrorActionPreference="SilentlyContinue"',
        `netsh interface ipv4 set subinterface "${adapterName}" mtu=${mtu} store=persistent`,
        'Write-Output "OK"'
      ].join('\n');
      try {
        await runElevatedPowerShell(mtuScript, 15000);
      } catch (e) {
        netlog.warn(`[windowsNetworkUtils] MTU 设置失败（忽略）: ${e.message}`);
      }

      return { applied_ip: targetIp, ip_list: appliedIpList };
    }

    netlog.warn(`[windowsNetworkUtils] 方法 ${method.name} 校验未通过: 当前IP列表=${appliedIpList.join(', ') || '未读取到'}`);
  }

  throw new Error(`网络配置失败 (${adapterName}): 目标IP=${targetIp}${lastError?.message ? `，最后错误=${lastError.message}` : ''}。请确认已授予管理员权限，或在 Windows 网络适配器里手动将该网卡IPv4改为 ${targetIp}/${mask}`);
}

// 执行 netsh 命令（当前用户会话直接运行），返回 { exitCode, output }
async function execNetsh(args, { timeout = 15000 } = {}) {
  const script = [
    `$output = netsh ${args} 2>&1`,
    'Write-Output "NETSH_EXIT:$LASTEXITCODE"',
    'Write-Output $output',
    'exit 0'
  ].join('\n');

  let stdout;
  try {
    stdout = await runPowerShell(script, timeout);
  } catch (e) {
    stdout = e.stdout || e.stderr || String(e.message || '');
  }

  const text = String(stdout || '');
  const exitMatch = text.match(/NETSH_EXIT:(\d+)/);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : -1;

  return { exitCode, output: text };
}

// 严格模式：netsh 非 0 即抛错
async function runNetsh(args, opts = {}) {
  const { exitCode, output } = await execNetsh(args, opts);
  if (exitCode !== 0) {
    const body = output.replace(/NETSH_EXIT:\d+/, '').trim();
    throw new Error(`netsh 命令失败 (exit=${exitCode}): ${body || '无输出'}`);
  }
  return output;
}

// 检查网桥是否已存在（通过 netsh bridge list 查询是否存在 GUID 条目）
// 不依赖英文适配器名，兼容中文 Windows（桥名可能是"网桥"）
async function isBridgePresent() {
  try {
    const { output } = await execNetsh('bridge list', { timeout: 8000 });
    return /\{[0-9A-Fa-f-]+\}/.test(output);
  } catch {
    return false;
  }
}

// 从 netsh bridge list 解析实际桥适配器名称（中文 Windows 可能是"网桥"）
async function getBridgeName() {
  try {
    const { output } = await execNetsh('bridge list', { timeout: 8000 });
    const m = output.match(/\{[0-9A-Fa-f-]+\}\s+(.+)/);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

// 从 netsh bridge list 解析桥接 GUID
async function getBridgeGuid() {
  try {
    const { output } = await execNetsh('bridge list', { timeout: 8000 });
    const m = output.match(/\{[0-9A-Fa-f-]+\}/);
    if (m) return m[0];
  } catch {}
  return null;
}

// 从 netsh bridge show adapter 输出中解析适配器名称 → IfIndex 的映射
// netsh bridge create 使用 IfIndex 作为 adapter ID（数字，避免中文名编码问题）
async function getBridgeAdapterIdsByName(names) {
  const { output } = await execNetsh('bridge show adapter', { timeout: 10000 });
  const result = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+\{[0-9A-Fa-f-]+\}\s+(.+?)\s{2,}/);
    if (match) {
      const ifIndex = match[1];
      const name = match[2].trim();
      if (names.includes(name)) {
        result.set(name, ifIndex);
      }
    }
  }
  return result;
}

// 获取所有现有网桥 GUID 列表（参考 Python get_all_bridge_guids）
async function getAllBridgeGuids() {
  try {
    const { output } = await execNetsh('bridge list', { timeout: 8000 });
    const matches = output.match(/\{[0-9A-Fa-f-]+\}/g);
    return matches ? [...new Set(matches)] : [];
  } catch {
    return [];
  }
}

export async function createNetworkBridge(adapters) {
  if (process.platform !== 'win32') {
    throw new Error('仅支持 Windows 网桥配置');
  }

  if (!Array.isArray(adapters) || adapters.length < 2) {
    throw new Error('创建网桥至少需要两个网卡');
  }

  // 正序（Windows 会保护第二个参数的活跃网卡，导致加入网桥静默失败）
  // const adapterNames = adapters.map(a => a.name);
  // console.log(`[createNetworkBridge] 适配器: ${adapterNames.join(', ')}`);

  // 逆序（将问题网卡放第一参数，Windows 主动释放其绑定，可绕开保护限制）
  const adapterNames = [...adapters].reverse().map(a => a.name);
  console.log(`[createNetworkBridge] 适配器（已逆序）: ${adapterNames.join(', ')}`);

  // 读取各网卡当前状态并记录日志
  console.log(`[createNetworkBridge] 读取各网卡信息...`);
  await Promise.allSettled(adapterNames.map(async (name) => {
    try {
      const [ifIndex, ipList] = await Promise.all([
        getAdapterIfIndex(name),
        getAdapterIPv4List(name),
      ]);
      const ips = ipList.length > 0 ? ipList.join(', ') : '(无 IPv4)';
      console.log(`[createNetworkBridge] 网卡 "${name}" ifIndex=${ifIndex ?? 'unknown'} IPs=[${ips}]`);
    } catch (e) {
      console.warn(`[createNetworkBridge] 读取网卡信息失败: "${name}" - ${e.message}`);
    }
  }));

  // 参考 Python create_network_bridge：先删除所有现有网桥，再创建新网桥
  // 使用单次提权执行所有命令（destroy + delay + create），减少 UAC 弹窗
  const existingGuids = await getAllBridgeGuids();
  const commands = [];

  for (const guid of existingGuids) {
    commands.push(`netsh bridge destroy ${guid}`);
  }
  if (existingGuids.length > 0) {
    commands.push('timeout /t 2 /nobreak >nul'); // 等待系统清理（参考 Python addcommand_delay(2)）
  }

  // 创建网桥前，清除所有待加入网卡上的现有 IP，避免 Windows 因"保护活跃连接"拒绝将网卡加入网桥
  // 先检查是否有 IP 再删除，避免无 IP 时 Remove-NetIPAddress 退出码为 1
  console.log(`[createNetworkBridge] 清理各网卡 IP（共 ${adapterNames.length} 个）...`);
  for (const name of adapterNames) {
    const safe = name.replace(/'/g, "''");
    try {
      await runElevatedPowerShell([
        '$ErrorActionPreference="SilentlyContinue"',
        `$ips = @(Get-NetIPAddress -InterfaceAlias '${safe}' -AddressFamily IPv4 -EA SilentlyContinue)`,
        `if ($ips.Count -gt 0) { $ips | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue }`,
        'exit 0'
      ].join('\n'), 8000);
      console.log(`[createNetworkBridge] 已清理 IP: ${name}`);
    } catch (e) {
      console.warn(`[createNetworkBridge] 清理 IP 失败（忽略）: ${name} - ${e.message}`);
    }
  }

  // 创建新网桥（使用前两个适配器）
  const [first, second] = adapterNames;
  console.log(`[createNetworkBridge] 同时创建网桥（首批两个适配器一起加入）: "${first}" + "${second}"`);
  commands.push(`netsh bridge create "${first}" "${second}"`);

  if (commands.length === 0) {
    throw new Error('网桥创建命令为空');
  }

  const extraAdapters = adapters.slice(2);
  if (extraAdapters.length > 0) {
    console.log(`[createNetworkBridge] 还有 ${extraAdapters.length} 个适配器将在网桥创建后逐个加入: ${extraAdapters.map(a => a.name).join(', ')}`);
  } else {
    console.log(`[createNetworkBridge] 共 ${adapters.length} 个适配器，全部一起创建网桥，无需逐个追加`);
  }

  console.log(`[createNetworkBridge] 执行 ${commands.length} 条命令（单次提权）`);
  try {
    await runElevatedCommandChain(commands);
  } catch (e) {
    console.warn(`[createNetworkBridge] 命令链执行异常: ${e.message}`);
  }

  // 等待网桥创建完成
  if (!await isBridgePresent()) {
    throw new Error(
      '网桥创建失败：未能在系统中创建网桥。\n' +
      '请确认：1) 已以管理员身份运行本程序  2) Windows Network Bridge 功能已安装'
    );
  }

  // 确保所有网卡的 ms_bridge 绑定已启用（单次提权，幂等）
  // 不做预检查：netsh bridge create 退出后 Windows 仍在异步完成绑定注册，
  // 此时任何查询（Get-NetAdapterBinding / netsh bridge show adapter）都可能读到旧状态，
  // 导致误判"未在网桥中"。直接 Enable/Add 对已在桥里的网卡是空操作，不会造成副作用。
  console.log(`[createNetworkBridge] 确保 ${adapters.length} 个网卡 ms_bridge 绑定已启用（单次提权）...`);
  const ensureLines = ['$ErrorActionPreference="SilentlyContinue"'];
  for (const a of adapters) {
    const safe = a.name.replace(/'/g, "''");
    ensureLines.push(
      `$b = Get-NetAdapterBinding -Name '${safe}' -ComponentID ms_bridge -EA SilentlyContinue`,
      `if ($b) { Enable-NetAdapterBinding -Name '${safe}' -ComponentID ms_bridge -EA SilentlyContinue }`,
      `else { Add-NetAdapterBinding -Name '${safe}' -ComponentID ms_bridge -EA SilentlyContinue }`,
    );
  }
  ensureLines.push('exit 0');
  try {
    await runElevatedPowerShell(ensureLines.join('\n'), 30000);
    console.log(`[createNetworkBridge] 所有网卡网桥绑定已确认`);
  } catch (e) {
    console.warn(`[createNetworkBridge] 网桥绑定确认失败: ${e.message}`);
  }

  // 获取实际桥名（中文 Windows 可能是"网桥"）及其 ifIndex
  const bridgeName = (await getBridgeName()) || 'Network Bridge';
  console.log(`[createNetworkBridge] 实际桥名: ${bridgeName}`);

  let bridgeIfIndex = null;
  for (let i = 0; i < 8; i++) {
    bridgeIfIndex = await getAdapterIfIndex(bridgeName);
    if (bridgeIfIndex) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  if (bridgeIfIndex) {
    console.log(`[createNetworkBridge] 网桥 ifIndex=${bridgeIfIndex}`);
  } else {
    console.warn('[createNetworkBridge] 未能获取网桥 ifIndex，后续 IP 配置将使用 netsh 兜底');
  }

  const bridgeGuid = await getBridgeGuid();
  console.log(`[createNetworkBridge] 网桥 guid=${bridgeGuid ?? 'null'}`);

  return { bridgeName, bridgeIfIndex, bridgeGuid };
}

export async function destroyNetworkBridgeByGuid(guid) {
  if (process.platform !== 'win32') return;

  if (!guid || typeof guid !== 'string') {
    console.warn('[destroyNetworkBridgeByGuid] GUID 无效，跳过');
    return;
  }

  console.log(`[destroyNetworkBridgeByGuid] 删除网桥: ${guid}`);

  // 方法 1：runElevatedCommandChain（等价于 Python BatchExecutor）
  // 使用 netsh bridge destroy（注意是 destroy 不是 delete，匹配 Python 参考项目）
  try {
    await runElevatedCommandChain([`netsh bridge destroy ${guid}`]);
    console.log('[destroyNetworkBridgeByGuid] 网桥已删除 (cmd-elevated)');

    for (let i = 0; i < 6; i++) {
      if (!await isBridgePresent()) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!await isBridgePresent()) return;
    console.log('[destroyNetworkBridgeByGuid] 网桥仍存在，尝试其他方法...');
  } catch (e) {
    console.warn(`[destroyNetworkBridgeByGuid] cmd-elevated 失败: ${e.message}`);
  }

  // 方法 2：提权 PowerShell 执行 netsh bridge destroy（备选编码路径）
  try {
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      `netsh bridge destroy ${guid}`,
      'Write-Output "OK"'
    ].join('\n');
    await runElevatedPowerShell(psScript, 15000);
    console.log('[destroyNetworkBridgeByGuid] 网桥已删除 (ps-elevated)');

    for (let i = 0; i < 6; i++) {
      if (!await isBridgePresent()) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!await isBridgePresent()) return;
    console.log('[destroyNetworkBridgeByGuid] 网桥仍存在，尝试禁用适配器...');
  } catch (e) {
    console.warn(`[destroyNetworkBridgeByGuid] ps-elevated 失败: ${e.message}`);
  }

  // 方法 3：兜底 — 禁用桥适配器（Windows 10/11 上网桥无法通过 netsh 删除时的后备方案）
  const bridgeName = await getBridgeName();
  if (bridgeName) {
    console.log(`[destroyNetworkBridgeByGuid] 兜底：禁用桥适配器 "${bridgeName}"`);
    const safe = bridgeName.replace(/'/g, "''");
    const disableScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      // 移除所有静态 IPv4 地址
      `Get-NetIPAddress -InterfaceAlias '${safe}' -AddressFamily IPv4 -EA SilentlyContinue | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue`,
      // 禁用桥适配器
      `Disable-NetAdapter -Name '${safe}' -Confirm:$false -EA SilentlyContinue`,
      'Write-Output "OK"',
    ].join('\n');
    try {
      await runElevatedPowerShell(disableScript, 15000);
      console.log('[destroyNetworkBridgeByGuid] 桥适配器已禁用（兜底成功）');
    } catch (e) {
      console.warn(`[destroyNetworkBridgeByGuid] 兜底也失败了: ${e.message}`);
    }
  }
}

export async function destroyNetworkBridge() {
  if (process.platform !== 'win32') return;

  // 优先通过 GUID 删除
  const guid = await getBridgeGuid();
  if (guid) {
    await destroyNetworkBridgeByGuid(guid);
    if (!await isBridgePresent()) {
      console.log('[destroyNetworkBridge] 网桥已清理');
      return;
    }
  }

  // 获取所有剩余 GUID 逐个删除
  const allGuids = await getAllBridgeGuids();
  if (allGuids.length > 0) {
    console.log(`[destroyNetworkBridge] 仍有 ${allGuids.length} 个网桥，逐个删除`);
    for (const g of allGuids) {
      await destroyNetworkBridgeByGuid(g);
    }
    if (!await isBridgePresent()) {
      console.log('[destroyNetworkBridge] 网桥已清理');
      return;
    }
  }

  // 最后兜底
  const bridgeName = await getBridgeName();
  if (bridgeName) {
    console.log(`[destroyNetworkBridge] 兜底：禁用桥适配器 "${bridgeName}"`);
    const safe = bridgeName.replace(/'/g, "''");
    const disableScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      `Get-NetIPAddress -InterfaceAlias '${safe}' -AddressFamily IPv4 -EA SilentlyContinue | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue`,
      `Disable-NetAdapter -Name '${safe}' -Confirm:$false -EA SilentlyContinue`,
      'Write-Output "OK"',
    ].join('\n');
    try {
      await runElevatedPowerShell(disableScript, 15000);
      console.log('[destroyNetworkBridge] 桥适配器已禁用（兜底成功）');
    } catch (e) {
      console.warn(`[destroyNetworkBridge] 兜底也失败了: ${e.message}`);
    }
  }
}

export async function configureSingleUSBAdapter(adapterNameOrAdapter, ip, mask = DEFAULT_MASK, logger = null) {
  const adapterName = typeof adapterNameOrAdapter === 'string' ? adapterNameOrAdapter : adapterNameOrAdapter?.name;
  const adapterIfIndex = typeof adapterNameOrAdapter === 'string' ? null : adapterNameOrAdapter?.ifIndex;

  if (!adapterName) {
    throw new Error('适配器名称为空');
  }

  // 参考 Python configure_single_usb_adapter：先删除所有现有网桥，再设置 IP+MTU
  const existingGuids = await getAllBridgeGuids();
  if (existingGuids.length > 0) {
    const commands = existingGuids.map(guid => `netsh bridge destroy ${guid}`);
    try {
      await runElevatedCommandChain(commands);
      console.log(`[configureSingleUSBAdapter] 已清理 ${existingGuids.length} 个现有网桥`);
    } catch (e) {
      console.warn(`[configureSingleUSBAdapter] 清理网桥失败（忽略）: ${e.message}`);
    }
  }

  const { applied_ip } = await setNetworkIP(adapterName, ip, mask, DEFAULT_MTU, adapterIfIndex, logger);
  return { network_mode: 'single', adapter: adapterName, applied_ip };
}

export async function configureMultiUSBAdapters(adapters, ip, mask = DEFAULT_MASK, logger = null) {
  if (adapters.length < 2) {
    throw new Error('至少需要2个适配器才能使用多USB模式');
  }

  // 第一步：删除所有网桥 + 创建新网桥（单次提权，参考 Python configure_multi_usb_adapters）
  const { bridgeName, bridgeIfIndex, bridgeGuid } = await createNetworkBridge(adapters);

  // 等待桥接完全初始化（网桥创建后 Windows 会分配 APIPA，需要等待网卡栈稳定后再设置 IP）
  // 参考 Python：time.sleep(1)，但网桥初始化较慢，延长到 3s
  console.log('[configureMultiUSBAdapters] 等待网桥初始化（3秒）...');
  await new Promise(r => setTimeout(r, 3000));

  // 第二步：设置桥接 IP+MTU（带重试，因为网桥 APIPA 分配可能与 IP 设置竞态）
  const netlog = createNetworkLogger(logger);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      netlog.info(`[configureMultiUSBAdapters] IP 设置尝试 ${attempt}/3`);
      const { applied_ip } = await setNetworkIP(bridgeName, ip, mask, DEFAULT_MTU, bridgeIfIndex, logger);
      return { network_mode: 'bridge', bridge: bridgeName, bridge_guid: bridgeGuid, applied_ip };
    } catch (e) {
      lastError = e;
      netlog.warn(`[configureMultiUSBAdapters] IP 设置尝试 ${attempt} 失败: ${e.message}`);
      if (attempt < 3) {
        netlog.info('[configureMultiUSBAdapters] 等待 2 秒后重试...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw lastError || new Error('网桥 IP 设置失败（已重试 3 次）');
}

export { DEFAULT_MASK, DEFAULT_MTU };
