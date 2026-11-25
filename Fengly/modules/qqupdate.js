'use strict';
// QQ 版本检测与更新引导
//
// 背景：NapCat 依赖特定版本的 NTQQ（当前环境是 9.9.33）。QQ 自动更新后旧版协议端
// 可能无法注入，导致扫码登录失败、NapCat 起不来。用户看到的就是"二维码不出/登录失败"。
//
// 本模块负责：
//   1. 读取本地 QQ 版本（从 runtime/qq/versions/ 与 QQ.exe 版本信息）
//   2. 查询 QQ 官方最新版本号
//   3. 比对后给出是否需要更新
//   4. 优先尝试自动下载安装包；拿不到地址就返回官网链接让界面打开

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 已知可用的协议端兼容表：协议端 → 支持的 QQ 版本前缀
// 数据来自各项目 README；不在表里的版本视为"未知"，不做强制拦截，只提示。
const COMPAT = {
  'NapCat 4.18.41': { qq: ['9.9.33'], note: '需要 QQ 9.9.33-52230' },
  'SnowCat': { qq: ['9.9.37'], note: '适配 QQ 9.9.37-54395（V8 通道注入）' }
};

function httpGet(url, timeoutMs = 15000, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 6) return resolve({ ok: false, error: '重定向过多' });
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*' },
      timeout: timeoutMs
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(httpGet(next, timeoutMs, redirects + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers
      }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, error: '超时' }); });
  });
}

// 读本地 QQ 版本
function readLocalQQVersion(runtimePath) {
  const qqDir = path.join(runtimePath, 'qq');
  const out = { exe: '', versions: [], current: '' };

  // 1) 从 versions 目录名推断（最可靠，NapCat 就是按这个选的）
  try {
    const list = fs.readdirSync(path.join(qqDir, 'versions'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => /^\d+\.\d+\.\d+/.test(n));
    out.versions = list;
    if (list.length) {
      // 取最大版本
      out.current = list.sort((a, b) => {
        const pa = a.split(/[.-]/).map(Number);
        const pb = b.split(/[.-]/).map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const x = pa[i] || 0, y = pb[i] || 0;
          if (x !== y) return y - x;
        }
        return 0;
      })[0];
    }
  } catch (e) {}

  // 2) 从 QQ.exe 版本信息补充
  try {
    const v = require('child_process').execFileSync('powershell', [
      '-NoProfile', '-Command',
      `(Get-Item '${path.join(qqDir, 'QQ.exe').replace(/'/g, "''")}').VersionInfo.FileVersion`
    ], { encoding: 'utf8', windowsHide: true, timeout: 8000 }).trim();
    if (v) out.exe = v;
  } catch (e) {}

  // 3) 短版本号（9.9.33 这种）
  const m = /(\d+\.\d+\.\d+)/.exec(out.current || out.exe || '');
  out.short = m ? m[1] : '';

  return out;
}

// 查 QQ 官方最新版本
// 真实接口来自 im.qq.com/pcqq 页面引用的 windowsConfig.js（2026-11 实测可用）：
//   var params = {"version":"9.9.37","updateDate":"...","ntDownloadX64Url":"https://qqdl.gtimg.cn/..."}
async function fetchLatestQQVersion() {
  const CONFIG_URL = 'https://cdn-go.cn/qq-web/im.qq.com_new/latest/rainbow/windowsConfig.js';

  const r = await httpGet(CONFIG_URL);
  if (!r.ok || !r.body) {
    return { ok: false, error: '无法访问 QQ 版本配置接口' };
  }

  // 从 JS 里抠出 params JSON
  const m = /var\s+params\s*=\s*(\{[\s\S]*?\});/.exec(r.body);
  if (!m) return { ok: false, error: '版本接口格式变化，解析失败' };

  let cfg;
  try { cfg = JSON.parse(m[1]); }
  catch (e) { return { ok: false, error: '版本配置 JSON 解析失败' }; }

  return {
    ok: true,
    version: String(cfg.version || ''),
    updateDate: String(cfg.updateDate || ''),
    // x64 安装包直链（优先）
    downloadUrl: String(cfg.ntDownloadX64Url || cfg.ntDownloadUrl || ''),
    downloadUrlX86: String(cfg.ntDownloadUrl || ''),
    downloadUrlARM: String(cfg.ntDownloadARMUrl || ''),
    legacyUrl: String(cfg.downloadUrl || ''),
    source: CONFIG_URL
  };
}

// 比较版本：返回 1=本地新 / 0=相同 / -1=本地旧
function compareVersion(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// 每个协议端要求的 QQ 版本是否满足
function checkCompat(protocolName, localShort) {
  const rule = COMPAT[protocolName];
  if (!rule) return { known: false, ok: true, note: '未知协议端，跳过兼容检查' };
  if (!localShort) return { known: true, ok: false, note: '读不到本地 QQ 版本' };
  const ok = rule.qq.some((v) => localShort.startsWith(v) || v.startsWith(localShort));
  return { known: true, ok, note: rule.note, expect: rule.qq };
}

// 综合检查：返回给界面用的完整信息
async function checkQQUpdate(runtimePath, opts) {
  const protocolName = (opts && opts.protocol) || 'NapCat 4.18.41';
  const local = readLocalQQVersion(runtimePath);
  const compat = checkCompat(protocolName, local.short);

  let remote = null;
  try { remote = await fetchLatestQQVersion(); } catch (e) { remote = { ok: false, error: e.message }; }

  const latest = (remote && remote.ok) ? remote.version : '';
  const cmp = latest ? compareVersion(local.current || local.short, latest) : 0;

  return {
    ok: true,
    local: {
      version: local.current || local.short || '未知',
      short: local.short,
      exeVersion: local.exe,
      installed: local.versions
    },
    latest: latest || '未知',
    latestFetched: !!(remote && remote.ok),
    fetchError: (remote && remote.error) || '',
    updateDate: (remote && remote.updateDate) || '',
    downloadUrl: (remote && remote.downloadUrl) || '',
    // needUpdate：官网版本比本地新
    needUpdate: !!(remote && remote.ok) && cmp < 0,
    // direction：-1 表示本地比官网旧
    direction: cmp,
    compat,
    protocol: protocolName,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  readLocalQQVersion,
  fetchLatestQQVersion,
  compareVersion,
  checkCompat,
  checkQQUpdate,
  COMPAT
};
