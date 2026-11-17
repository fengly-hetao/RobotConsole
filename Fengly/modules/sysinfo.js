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
      const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"', { encoding: 'utf8', windowsHide: true, timeout: 4000 });
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

let _netCache = { rx: 0, tx: 0, t: 0 };
function networkBytes() {
  // 缓存 20 秒，避免频繁 spawn PowerShell
  const now = Date.now();
  if (now - _netCache.t < 20000) return _netCache;
  try {
    const out = execSync('powershell -NoProfile -Command "Get-NetAdapterStatistics | Measure-Object -Property ReceivedBytes,SentBytes -Sum | Select-Object -ExpandProperty Sum"', { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const vals = out.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
    _netCache = { rx: vals[0] || 0, tx: vals[1] || 0, t: now };
    return _netCache;
  } catch (e) {
    return _netCache;
  }
}

function sample() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disk = diskInfo();
  const net = networkBytes();
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

module.exports = { sample, cpuUsage };
