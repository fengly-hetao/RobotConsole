'use strict';
// 端口探测与选择模块
// 解决 Windows 端口冲突两大来源：
//   1) EACCES / WinError 10013：端口落在系统「端口排除范围」内（WinNAT/Hyper-V/WSL 动态保留）
//   2) EADDRINUSE / WinError 10048：端口被其它进程占用
// 做法：真实 bind 一次（listen 后立刻 close），能同时捕获以上两种冲突。

const net = require('net');

// 探测单个端口是否可用（真实 bind 测试）
function probePort(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const done = (ok, code) => {
      if (settled) return;
      settled = true;
      try { server.close(); } catch (e) {}
      resolve({ ok, code: code || '' });
    };

    const timer = setTimeout(() => done(false, 'TIMEOUT'), timeoutMs);

    server.once('error', (err) => {
      clearTimeout(timer);
      done(false, err && err.code ? err.code : 'ERROR');
    });
    server.once('listening', () => {
      clearTimeout(timer);
      done(true, '');
    });

    try {
      server.listen(port, host);
    } catch (e) {
      clearTimeout(timer);
      done(false, e && e.code ? e.code : 'SYNC_ERROR');
    }
  });
}

// 从 preferred 开始找一个可用端口：
//  - preferred 可用 → 直接用（保持用户习惯）
//  - 否则向上顺延，命中排除段/占用会立刻失败，顺延很快
//  - 全部失败 → 让系统分配临时端口兜底
async function findFreePort(preferred, host = '127.0.0.1', maxTries = 300) {
  const start = parseInt(preferred, 10);
  if (!Number.isFinite(start) || start < 1024 || start > 65535) {
    return { port: await findEphemeralPort(host), changed: true, reason: 'invalid-preferred' };
  }

  // 1) 优先复用原端口
  const first = await probePort(start, host);
  if (first.ok) return { port: start, changed: false, reason: '' };

  // 2) 向上顺延
  const upper = Math.min(65535, start + maxTries);
  for (let p = start + 1; p <= upper; p++) {
    const r = await probePort(p, host);
    if (r.ok) return { port: p, changed: true, reason: first.code || 'unavailable' };
  }

  // 3) 兜底：系统分配临时端口
  return { port: await findEphemeralPort(host), changed: true, reason: 'fallback-ephemeral' };
}

// 让系统分配一个空闲端口（listen 0）
function findEphemeralPort(host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(0));
    server.listen(0, host, () => {
      const addr = server.address();
      const port = addr && addr.port ? addr.port : 0;
      try { server.close(); } catch (e) {}
      resolve(port);
    });
  });
}

// 读取 Windows 端口排除范围（仅用于诊断展示，不参与决策）
function listExcludedRanges() {
  const { execSync } = require('child_process');
  const out = [];
  try {
    const text = execSync('netsh interface ipv4 show excludedportrange protocol=tcp', {
      encoding: 'utf8', windowsHide: true, timeout: 5000
    });
    for (const line of String(text).split(/\r?\n/)) {
      const m = line.trim().match(/^(\d{1,5})\s+(\d{1,5})/);
      if (m) out.push({ start: parseInt(m[1], 10), end: parseInt(m[2], 10) });
    }
  } catch (e) {}
  return out;
}

module.exports = { probePort, findFreePort, findEphemeralPort, listExcludedRanges };
