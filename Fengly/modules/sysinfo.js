'use strict';
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

let lastCpu = null;
let _cpuCache = { v: 0, t: 0 };

function cpuUsage() {
  // Windows 上 os.cpus() 的 times 差值算法不可靠（Node 已知问题），
  // 改用系统原生的 LoadPercentage（和任务管理器显示的一致）。
  if (process.platform === 'win32') {
    const now = Date.now();
    if (now - _cpuCache.t < 1500) return _cpuCache.v; // 缓存 1.5 秒，避免频繁 exec
    try {
      const out = runPs('(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average', 5000);
      const v = parseFloat(out.trim());
      if (!isNaN(v)) { _cpuCache = { v: Math.min(100, Math.max(0, v)), t: now }; }
    } catch (e) { /* 失败保持上次值 */ }
    return _cpuCache.v;
  }
  // Linux/macOS：累计节拍差值
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const t of Object.keys(c.times)) total += c.times[t];
    idle += c.times.idle;
  }
  const cur = { idle, total };
  let usage = 0;
  if (lastCpu) {
    const dIdle = cur.idle - lastCpu.idle;
    const dTotal = cur.total - lastCpu.total;
    usage = dTotal > 0 ? Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100)) : 0;
  }
  lastCpu = cur;
  return usage;
}

function diskInfo() {
  try {
    const s = fs.statfsSync(process.env.SystemDrive || 'C:\\');
    const total = (s.blocks * s.bsize) || 0;
    const free = (s.bavail * s.bsize) || 0;
    return { total, free, used: total - free };
  } catch (e) {
    return { total: 0, free: 0, used: 0 };
  }
}

// ==================== 网络 ====================
// 需要「实时速率」，所以除了累计字节，还要记住上次采样算差值。
let _netCache = { rx: 0, tx: 0, t: 0, rxSpeed: 0, txSpeed: 0 };

function networkBytes() {
  const now = Date.now();
  // 累计值缓存 5 秒；速率用两次采样的差值算
  if (now - _netCache.t < 5000) {
    return {
      rx: _netCache.rx,
      tx: _netCache.tx,
      rxSpeed: _netCache.rxSpeed,
      txSpeed: _netCache.txSpeed,
      t: _netCache.t
    };
  }
  try {
    const ps = 'Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 0 } | Measure-Object -Property ReceivedBytes,SentBytes -Sum | Select-Object -ExpandProperty Sum';
    const out = runPs(ps, 6000);
    const vals = String(out || '').trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
    const rx = vals[0] || 0;
    const tx = vals[1] || 0;

    // 计算速率（字节/秒）
    let rxSpeed = 0, txSpeed = 0;
    if (_netCache.t) {
      const dt = (now - _netCache.t) / 1000;
      if (dt > 0.5) {
        rxSpeed = Math.max(0, (rx - _netCache.rx) / dt);
        txSpeed = Math.max(0, (tx - _netCache.tx) / dt);
      }
    }

    _netCache = { rx, tx, t: now, rxSpeed, txSpeed };
    return { rx, tx, rxSpeed, txSpeed, t: now };
  } catch (e) {
    return {
      rx: _netCache.rx,
      tx: _netCache.tx,
      rxSpeed: _netCache.rxSpeed,
      txSpeed: _netCache.txSpeed,
      t: _netCache.t
    };
  }
}

// ==================== PowerShell 执行辅助 ====================
// 直接用 execSync('powershell -Command "..."') 时，Windows 会经过 cmd.exe，
// 命令里的双引号/竖线极易被 cmd 解析成自己的语法（实测出现过 "Remote 不是命令"）。
// 统一改成写临时 .ps1 再执行，彻底避开转义问题。
let _psTmpDir = '';

function runPs(script, timeout) {
  const path = require('path');
  const tmpdir = os.tmpdir();
  if (!_psTmpDir) {
    _psTmpDir = path.join(tmpdir, 'rc-ps-' + process.pid);
    try { fs.mkdirSync(_psTmpDir, { recursive: true }); } catch (e) {}
  }
  const file = path.join(_psTmpDir, 'x' + (Date.now() % 100000) + '.ps1');
  // PowerShell 5.1 读 UTF-8 需要 BOM，否则中文乱码
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  fs.writeFileSync(file, Buffer.concat([bom, Buffer.from(script, 'utf8')]));
  try {
    return execSync('powershell -NoProfile -ExecutionPolicy Bypass -File "' + file + '"', {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeout || 8000
    });
  } finally {
    try { fs.unlinkSync(file); } catch (e) {}
  }
}
// ==================== GPU ====================
// 显卡型号从 WMI 拿（Win32_VideoController）；
// 显存占用优先用 nvidia-smi（NVIDIA 独显），没有就退回 WMI 的 AdapterRAM。
let _gpuCache = { data: null, t: 0 };

function gpuInfo() {
  const now = Date.now();
  if (_gpuCache.data && now - _gpuCache.t < 30000) return _gpuCache.data;

  const result = {
    name: '',
    vendor: '',
    driver: '',
    vramTotal: 0,
    vramUsed: 0,
    vramUsage: 0,
    usage: -1,          // -1 表示拿不到占用率
    temperature: -1,    // -1 表示拿不到温度
    fanSpeed: -1,
    powerDraw: -1,
    source: ''
  };

  if (process.platform !== 'win32') {
    _gpuCache = { data: result, t: now };
    return result;
  }

  // ① 型号 / 驱动 / 显存（WMI）
  // 注意：Windows 上 execSync 会走 cmd.exe，PowerShell 里的双引号必须转义，
  // 之前直接用 " 导致 cmd 把 Remote 当成命令执行。这里改写成 .ps1 临时文件执行。
  try {
    // 系统里可能有多个显示设备：核显 + 独显 + 各种虚拟屏（向日葵/ToDesk/AskLink 等）。
    // 必须优先选真正的显卡，否则会显示成「AskLink Display Adapter」这种虚拟设备。
    const ps = [
      'Get-CimInstance Win32_VideoController',
      '| Select-Object Name,DriverVersion,AdapterRAM,VideoProcessor',
      '| ConvertTo-Json -Compress'
    ].join(' ');
    const out = runPs(ps, 10000);
    let list = JSON.parse(String(out || '[]').trim() || '[]');
    if (!Array.isArray(list)) list = [list];

    // 虚拟屏关键词（命中即排除）
    const VIRTUAL_RE = /basic display|remote|mirror|virtual|vmware|parsec|asklink|oray|sunlogin|todesk|idddriver|虚拟/i;
    function gpuScore(name) {
      const n = String(name || '').toLowerCase();
      if (!n || VIRTUAL_RE.test(n)) return -1;
      if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('gtx') || n.includes('quadro')) return 100;
      if (n.includes('amd') || n.includes('radeon') || n.includes('firepro')) return 90;
      if (n.includes('arc')) return 80;
      if (n.includes('intel') || n.includes('uhd') || n.includes('iris') || n.includes('hd graphics')) return 50;
      return 10;
    }

    let best = null, bestScore = -1;
    for (const it of list) {
      const sc = gpuScore(it.Name);
      if (sc > bestScore) { bestScore = sc; best = it; }
    }

    if (best && bestScore > 0) {
      result.name = String(best.Name || '').trim();
      result.driver = String(best.DriverVersion || '').trim();
      const ram = Number(best.AdapterRAM) || 0;
      if (ram > 0) result.vramTotal = ram;
      const n = result.name.toLowerCase();
      if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('gtx') || n.includes('quadro')) result.vendor = 'NVIDIA';
      else if (n.includes('amd') || n.includes('radeon') || n.includes('firepro')) result.vendor = 'AMD';
      else if (n.includes('intel') || n.includes('uhd') || n.includes('iris') || n.includes('arc')) result.vendor = 'Intel';
      result.source = 'wmi';
    }
  } catch (e) { /* ignore */ }

  // ② 实时占用 / 温度 / 功耗（nvidia-smi，NVIDIA 独显才有）
  if (result.vendor === 'NVIDIA') {
    try {
      const args = '--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,fan.speed,power.draw --format=csv,noheader,nounits';
      const out = execSync('nvidia-smi ' + args, { encoding: 'utf8', windowsHide: true, timeout: 6000 });
      const line = String(out || '').trim().split('\n')[0] || '';
      const p = line.split(',').map(x => x.trim());
      if (p.length >= 7) {
        if (p[0]) result.name = p[0];
        const mt = parseFloat(p[1]), mu = parseFloat(p[2]);
        if (!isNaN(mt)) result.vramTotal = mt * 1024 * 1024;
        if (!isNaN(mu)) result.vramUsed = mu * 1024 * 1024;
        const u = parseFloat(p[3]);
        if (!isNaN(u)) result.usage = Math.min(100, Math.max(0, u));
        const temp = parseFloat(p[4]);
        if (!isNaN(temp)) result.temperature = temp;
        const fan = parseFloat(p[5]);
        if (!isNaN(fan)) result.fanSpeed = fan;
        const pw = parseFloat(p[6]);
        if (!isNaN(pw)) result.powerDraw = pw;
        result.source = 'nvidia-smi';
      }
    } catch (e) { /* 没有 nvidia-smi，保持 WMI 数据 */ }
  }

  if (result.vramTotal > 0) {
    result.vramUsage = Math.min(100, (result.vramUsed / result.vramTotal) * 100);
  }

  _gpuCache = { data: result, t: now };
  return result;
}

function sample() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disk = diskInfo();
  const net = networkBytes();
  const gpu = gpuInfo();
  const interfaces = Object.entries(os.networkInterfaces()).map(([name, addrs]) => {
    const ipv4 = (addrs || []).find(a => a.family === 'IPv4' && !a.internal);
    return { name, address: ipv4 ? ipv4.address : '' };
  }).filter(i => i.address);

  return {
    cpu: {
      model: os.cpus()[0] ? os.cpus()[0].model : '',
      cores: os.cpus().length,
      usage: cpuUsage(),
      load: os.loadavg()
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usage: totalMem ? ((totalMem - freeMem) / totalMem * 100) : 0
    },
    disk: {
      total: disk.total,
      free: disk.free,
      used: disk.used,
      usage: disk.total ? (disk.used / disk.total * 100) : 0
    },
    gpu,
    network: net,
    interfaces,
    os: {
      platform: os.platform(),
      release: os.release(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      arch: os.arch()
    }
  };
}

module.exports = { sample, cpuUsage, gpuInfo };
