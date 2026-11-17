'use strict';
// 更新检查模块：拉取 update.json 比对版本 → 下载 zip → 解压出安装包
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// 简单 HTTPS/HTTP GET 跟随重定向，返回 {status, headers, body(Buffer), finalUrl}
function fetchBuffer(url, redirects = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('重定向过多'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.123pan.com/', ...extraHeaders } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(new URL(res.headers.location, url).href, redirects + 1, extraHeaders));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: url }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('请求超时')); });
  });
}

// 从 123 网盘分享页解析出文件列表 + 直链
// 分享页结构：先请求页面拿 shareKey，再调公开 API 取文件列表和下载地址
async function resolve123panShare(shareUrl) {
  const page = await fetchBuffer(shareUrl);
  const html = page.body.toString('utf8');
  // 从页面里抠出 shareKey（形如 ijXeMh-WS6c3）
  const m = html.match(/shareKey["'\s:=]+([A-Za-z0-9_-]{6,40})/i)
    || shareUrl.match(/\/s\/([A-Za-z0-9_-]{6,40})/)
    || shareUrl.match(/\/([A-Za-z0-9_-]{6,40})$/);
  const shareKey = m ? m[1] : '';
  if (!shareKey) throw new Error('解析不到分享码');

  // 123 网盘公开接口：先用 shareKey 换 info（文件名/大小/fileId）
  const api = `https://www.123pan.com/api/share/info?shareKey=${encodeURIComponent(shareKey)}`;
  const infoRes = await fetchBuffer(api, 0, { 'Referer': shareUrl, 'Accept': 'application/json' });
  let info = null;
  try { info = JSON.parse(infoRes.body.toString('utf8')); } catch (e) {}
  return { shareKey, html, apiRaw: info };
}

// 生成 123 网盘直链（鉴权关闭时直接拼，开启时算 md5）
function build123panDirectUrl(uid, filePath, opts = {}) {
  const base = `https://${uid}.cdn.123clouddisk.com/${uid}/${String(filePath).replace(/^\//, '')}`;
  if (!opts.secret) return base; // 鉴权关闭
  const crypto = require('crypto');
  const ts = opts.expire || Math.floor(Date.now() / 1000) + 3600;
  const rand = opts.rand || String(Math.floor(Math.random() * 1000));
  const md5 = crypto.createHash('md5')
    .update(`/${uid}/${String(filePath).replace(/^\//, '')}-${ts}-${rand}-${uid}-${opts.secret}`)
    .digest('hex');
  return `${base}?auth_key=${ts}-${rand}-${uid}-${md5}`;
}

// 把用户填写的更新源展开成「多个候选地址」。
// 目的：GitHub 在国内经常连不上，自动准备多个镜像，依次尝试，
//      用户不需要自己挂代理/节点就能检查更新。
// 支持填法：
//   https://github.com/user/repo                      → 自动找 main/master 分支下的 update.json
//   https://github.com/user/repo/tree/dev             → 指定分支
//   https://raw.githubusercontent.com/u/r/main/x.json  → 直接用
//   https://xxx.com/dir                               → 目录 + /update.json
//   https://xxx.com/update.json                       → 直接用
function expandFeedTargets(feedUrl) {
  const raw = String(feedUrl || '').trim();
  if (!raw) return [];

  // ---- GitHub 仓库地址 → 多镜像候选 ----
  const ghRepo = raw.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\?#]+)\/([^\/\?#]+)(?:\/tree\/([^\/\?#]+))?/i);
  if (ghRepo) {
    const user = ghRepo[1];
    const repo = ghRepo[2].replace(/\.git$/i, '');
    const branches = ghRepo[3] ? [ghRepo[3]] : ['main', 'master'];
    const out = [];
    for (const br of branches) {
      const p = 'update.json';
      const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${br}/${p}`;
      out.push(
        rawUrl,                                                          // ① 官方 raw（无缓存，最准确；实测国内多数可直连）
        `https://gh-proxy.com/${rawUrl}`,                                // ② 代理原站（无缓存，~1s）
        `https://ghproxy.net/${rawUrl}`,                                 // ③ 代理原站备用
        `https://cdn.jsdelivr.net/gh/${user}/${repo}@${br}/${p}`,        // ④ jsDelivr（最快 ~0.7s，但有缓存延迟）
        `https://fastly.jsdelivr.net/gh/${user}/${repo}@${br}/${p}`      // ⑤ jsDelivr 备用节点
      );
    }
    return out;
  }

  // ---- 普通地址 ----
  const u = raw.replace(/\/+$/, '');
  return /\.json$/i.test(u) ? [u] : [u, u + '/update.json'];
}

// 依次尝试候选地址，返回第一个成功的结果
async function fetchFirstOk(targets, timeoutMs = 8000) {
  let lastErr = '';
  for (const u of targets) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(u, {
        signal: ctrl.signal,
        headers: { 'Cache-Control': 'no-cache', 'User-Agent': UA },
        // redirect: 'follow' 是默认值，Cloudflare/GitHub 的跳转能自动跟随
      });
      clearTimeout(timer);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      const text = await res.text();
      return { ok: true, text, url: u };
    } catch (e) {
      lastErr = (e && e.name === 'AbortError') ? '超时' : (e.message || String(e));
    }
  }
  return { ok: false, error: lastErr };
}

async function checkUpdate(feedUrl, currentVersion) {
  if (!feedUrl) return { hasUpdate: false, disabled: true };
  const targets = expandFeedTargets(feedUrl);
  if (!targets.length) return { hasUpdate: false, disabled: true };

  const got = await fetchFirstOk(targets);
  if (!got.ok) {
    return { hasUpdate: false, error: '所有更新源都连不上（' + got.error + '）。如果是 GitHub，可换成国内镜像或改用 QQ 群更新。' };
  }

  let data;
  try { data = JSON.parse(got.text); }
  catch (e) { return { hasUpdate: false, error: 'JSON 解析失败（拿到的可能不是 update.json）：' + got.url }; }

  const latest = String(data.version || '');
  const dlUrl = String(data.url || '');
  const notes = String(data.notes || '');
  const force = !!data.force;
  const hasUpdate = latest && compareVersions(latest, currentVersion) > 0;
  return { hasUpdate, latest, url: dlUrl, notes, force, raw: data, feedUrl: got.url };
}

// 下载更新包到指定目录，返回本地路径
// 用全局 fetch（走 Chromium 网络栈 → 自动使用系统代理），
// 所以开了代理/节点的用户下载也能通。
async function downloadUpdate(dlUrl, destDir, onProgress) {
  fs.mkdirSync(destDir, { recursive: true });

  // 先确定保存文件名（从 URL 推断；123 网盘直链形如 xxx.exe）
  let finalUrl = dlUrl;
  let contentType = '';
  let name = 'update-download';

  const guessName = (u) => {
    const bare = String(u).split('?')[0];
    const bn = path.basename(bare);
    if (bn && /\.\w{2,5}$/.test(bn)) {
      try { return decodeURIComponent(bn); } catch (e) { return bn; }
    }
    return '';
  };

  const initial = guessName(dlUrl);
  if (initial) name = initial;

  // ===== 优先：流式下载（不把 500MB+ 全读进内存，边下边写盘）=====
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30 * 60 * 1000); // 大文件给 30 分钟
    const res = await fetch(dlUrl, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    finalUrl = res.url || dlUrl;
    contentType = res.headers.get('content-type') || '';

    // 文件名：优先 URL，其次 Content-Disposition
    const fromUrl = guessName(finalUrl);
    if (fromUrl) name = fromUrl;
    else {
      const cd = res.headers.get('content-disposition') || '';
      const mcd = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
      if (mcd) { try { name = decodeURIComponent(mcd[1]); } catch (e) { name = mcd[1]; } }
    }
    if (!/\.\w{2,5}$/.test(name)) {
      name = 'update-' + Date.now() + (/zip/i.test(contentType) ? '.zip' : '.exe');
    }
    name = fixBakSuffix(name);

    const savePath = path.join(destDir, name);
    const expected = parseInt(res.headers.get('content-length') || '0', 10);
    let received = 0;
    let lastReport = 0;

    if (res.body && typeof res.body.getReader === 'function') {
      // 流式写盘
      const reader = res.body.getReader();
      const out = fs.createWriteStream(savePath);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          received += chunk.length;
          if (!out.write(chunk)) {
            await new Promise((r) => out.once('drain', r));
          }
          const now = Date.now();
          if (onProgress && now - lastReport > 300) {
            lastReport = now;
            onProgress(received, expected);
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
    } else {
      // 环境不支持 stream → 退回一次性读取
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      received = buf.length;
      fs.writeFileSync(savePath, buf);
    }

    if (received < 1024) throw new Error('下载内容异常（' + received + ' 字节）');
    // 有 Content-Length 时校验完整性（防止代理截断）
    if (expected > 0 && received !== expected) {
      throw new Error('下载不完整：期望 ' + expected + ' 字节，实际 ' + received + ' 字节');
    }
    if (onProgress) onProgress(received, expected || received);
    return { path: savePath, size: received, name };
  } catch (e) {
    console.error('[updater] 流式下载失败，回退整块下载: ' + e.message);
  }

  // ===== 回退：整块下载（小文件或 stream 不可用时）=====
  let buf = null;
  try {
    const r = await fetchBuffer(dlUrl);
    if (r.status !== 200) throw new Error('下载失败 HTTP ' + r.status);
    buf = r.body;
    finalUrl = r.finalUrl;
  } catch (e) {
    throw new Error('下载失败: ' + (e.message || String(e)));
  }
  if (!buf || buf.length < 1024) throw new Error('下载内容异常（' + (buf ? buf.length : 0) + ' 字节）');

  const fromUrl2 = guessName(finalUrl);
  if (fromUrl2) name = fromUrl2;
  name = fixBakSuffix(name);
  const savePath = path.join(destDir, name);
  fs.writeFileSync(savePath, buf);
  if (onProgress) onProgress(buf.length, buf.length);
  return { path: savePath, size: buf.length, name };
}

// 修正 123 云盘的 .bak 后缀：xxx.exe.bak → xxx.exe
function fixBakSuffix(fileName) {
  const s = String(fileName || '');
  if (/\.bak$/i.test(s)) return s.replace(/\.bak$/i, '');
  return s;
}

// 如果下载到的是 zip，解出里面的 exe（自动处理 .bak 后缀）
function extractSetup(zipPath, destDir) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const exeEntry = entries.find(e => !e.isDirectory && /\.exe(\.bak)?$/i.test(e.entryName));
  if (!exeEntry) throw new Error('压缩包里没找到 .exe');
  fs.mkdirSync(destDir, { recursive: true });
  const outName = fixBakSuffix(path.basename(exeEntry.entryName));
  const outPath = path.join(destDir, outName);
  fs.writeFileSync(outPath, exeEntry.getData());
  return outPath;
}

// 校验下载到的文件是否为有效 PE 可执行文件（防止下到 HTML 错误页）
function isExecutable(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 1024) return false;
    // PE 文件头：MZ
    return buf[0] === 0x4D && buf[1] === 0x5A;
  } catch (e) {
    return false;
  }
}

module.exports = {
  checkUpdate, compareVersions,
  resolve123panShare, build123panDirectUrl,
  downloadUpdate, extractSetup,
  fixBakSuffix, isExecutable
};
