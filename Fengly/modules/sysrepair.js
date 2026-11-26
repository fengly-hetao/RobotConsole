'use strict';
// 系统文件修复
// ============
// 只调用微软官方工具，不下载、不替换任何文件：
//   1. sfc /scannow        检查并修复受保护的系统文件（需要管理员）
//   2. DISM /RestoreHealth 修复系统映像（sfc 修不了时用）
//
// 为什么不能「下载 dll 替换」：
//   · 系统 DLL 由 WinSxS 组件仓库管理，每个补丁版本对应不同文件
//   · 强行替换错误版本 = 蓝屏 / 无法开机
//   · 网上所谓「DLL 修复工具」绝大多数是木马
//
// 这两条命令是微软官方唯一推荐的系统文件修复方式。

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 检查当前是否管理员
 */
function isAdmin() {
  return new Promise((resolve) => {
    const ps = `$ErrorActionPreference='SilentlyContinue'; ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`;
    require('child_process').exec(
      'powershell -NoProfile -Command "' + ps + '"',
      { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve(false);
        resolve(String(stdout || '').trim().toLowerCase() === 'true');
      }
    );
  });
}

/**
 * 跑一条命令并把输出逐行回调
 * @param {string} cmd
 * @param {string[]} args
 * @param {function} onLine
 * @returns {Promise<{ok:boolean, code:number, lines:string[]}>}
 */
function runStreaming(cmd, args, onLine) {
  return new Promise((resolve) => {
    const lines = [];
    let child;
    try {
      child = spawn(cmd, args || [], { windowsHide: true });
    } catch (e) {
      onLine('启动失败: ' + e.message);
      return resolve({ ok: false, code: -1, lines });
    }

    const handle = (buf, isErr) => {
      const s = buf.toString('utf8');
      // sfc 输出用 \r 刷新进度，按 \r 和 \n 都切
      for (const piece of s.split(/[\r\n]+/)) {
        const line = piece.trim();
        if (!line) continue;
        lines.push(line);
        try { onLine(line); } catch (e) {}
      }
    };

    if (child.stdout) child.stdout.on('data', (b) => handle(b, false));
    if (child.stderr) child.stderr.on('data', (b) => handle(b, true));

    child.on('error', (e) => {
      onLine('进程错误: ' + e.message);
      resolve({ ok: false, code: -1, lines });
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, code, lines });
    });
  });
}

/**
 * 执行 sfc /scannow
 * 注意：这条命令需要管理员权限，非管理员会报「必须作为管理员运行」
 */
async function runSfc(onLine) {
  const cb = onLine || (() => {});
  cb('=== 开始 SFC 系统文件检查 ===');
  cb('提示：这条命令通常需要 5~15 分钟，请耐心等待，不要关闭窗口。');
  cb('');

  const r = await runStreaming('sfc', ['/scannow'], cb);

  cb('');
  if (r.ok) {
    cb('=== SFC 完成 ===');
  } else {
    if (r.code === 5 || r.lines.some((l) => /管理员|administrator/i.test(l))) {
      cb('❌ 需要管理员权限。请右键以管理员身份运行本程序后重试。');
    } else {
      cb('=== SFC 结束（退出码 ' + r.code + '）===');
    }
  }
  return r;
}

/**
 * 执行 DISM /Online /Cleanup-Image /RestoreHealth
 */
async function runDism(onLine) {
  const cb = onLine || (() => {});
  cb('=== 开始 DISM 系统映像修复 ===');
  cb('提示：需要联网下载修复源，可能耗时 10~30 分钟。');
  cb('');

  const r = await runStreaming('DISM', [
    '/Online', '/Cleanup-Image', '/RestoreHealth'
  ], cb);

  cb('');
  cb(r.ok ? '=== DISM 完成 ===' : '=== DISM 结束（退出码 ' + r.code + '）===');
  return r;
}

/**
 * 收集系统健康信息（给用户看个大概）
 */
async function getHealthInfo() {
  const info = {
    os: '',
    build: '',
    admin: await isAdmin(),
    wuService: '',
    diskFreeGB: 0
  };
  try {
    info.os = os.type() + ' ' + os.release();
    info.build = String(os.version ? os.version() : '');
  } catch (e) {}

  // 系统盘剩余空间
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'powershell -NoProfile -Command "(Get-PSDrive C).Free"',
      { timeout: 10000, windowsHide: true, encoding: 'utf8' }
    );
    const bytes = Number(String(out || '').trim());
    if (bytes > 0) info.diskFreeGB = Math.round(bytes / 1024 / 1024 / 1024 * 10) / 10;
  } catch (e) {}

  // Windows Update 服务状态（DISM 需要）
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'powershell -NoProfile -Command "(Get-Service wuauserv).Status"',
      { timeout: 10000, windowsHide: true, encoding: 'utf8' }
    );
    info.wuService = String(out || '').trim();
  } catch (e) {}

  return info;
}

module.exports = { isAdmin, runSfc, runDism, getHealthInfo };
