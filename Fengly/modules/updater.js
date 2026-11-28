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
      // ★ 顺序原则（2026-11 重新排序）：
      //   1. gh-proxy.com 排第一 —— 国内实测最快（1.8s），且是实时代理不改内容
      //   2. ghfast.top 第二
      //   3. raw.githubusercontent.com 第三 —— 实时但国内常被墙（8 秒超时）
      //   4. jsdelivr 系列放最后 —— 缓存 3~12 小时，可能给旧版本，
      //      只在前面全挂时兜底（checkUpdate 里有「旧版本跳过」保护）
      //   每个地址都带 ?t=<时间戳> 做 cache-busting。
      const bust = '?t=' + Date.now();
      out.push(
        `https://gh-proxy.com/${rawUrl}${bust}`,
        `https://ghfast.top/${rawUrl}${bust}`,
        rawUrl + bust,
        `https://fastly.jsdelivr.net/gh/${user}/${repo}@${br}/${p}${bust}`,
        `https://cdn.jsdelivr.net/gh/${user}/${repo}@${br}/${p}${bust}`
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

  // ★ 逐个源尝试，跳过「返回的版本比当前还旧」的缓存响应。
  //   踩过的坑：jsdelivr 缓存 3~12 小时，主镜像挂了之后会落到它上面，
  //   拿到上上个版本的 update.json，用户看到的就是「为什么还是旧版本」。
  const skipped = [];
  let got = null;
  let data = null;

  for (let i = 0; i < targets.length; i++) {
    const one = await fetchFirstOk([targets[i]]);
    if (!one.ok) {
      skipped.push('源 ' + (i + 1) + ' 连不上');
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(one.text);
    } catch (e) {
      skipped.push('源 ' + (i + 1) + ' 不是 JSON');
      continue;
    }
    const v = String(parsed.version || '');
    // 拿到的版本比当前还旧 → 一定是缓存，跳过
    if (v && currentVersion && compareVersions(v, currentVersion) < 0) {
      console.warn('[update] 源 ' + (i + 1) + ' 返回旧版本 ' + v + '（当前 ' + currentVersion + '），判定为缓存，跳过');
      skipped.push('源 ' + (i + 1) + ' 是旧缓存 ' + v);
      continue;
    }
    got = one;
    data = parsed;
    console.log('[update] 使用源 ' + (i + 1) + '/' + targets.length + '：version=' + v);
    break;
  }

  if (!got || !data) {
    return {
      hasUpdate: false,
      error: '所有更新源都拿不到有效数据' + (skipped.length ? '（' + skipped.join('；') + '）' : ''),
    };
  }

  const latest = String(data.version || '');
  const dlUrl = String(data.url || '');
  const notes = String(data.notes || '');
  const force = !!data.force;
  const hasUpdate = latest && compareVersions(latest, currentVersion) > 0;

  // 增量补丁：只对「当前版本 → 最新版本」这一跳有效
  // update.json 里的 patch 可以是单个对象，也可以是数组（多条升级路径）
  let patch = null;
  try {
    const rawPatch = data.patch;
    if (rawPatch) {
      const list = Array.isArray(rawPatch) ? rawPatch : [rawPatch];
      // 统一去掉 v/V 前缀再比较，避免 "v1.9.5" 与 "1.9.5" 匹配不上
      const norm = (v) => String(v || '').trim().replace(/^[vV]/, '');
      const cur = norm(currentVersion);
      const lat = norm(latest);
      patch = list.find((p) => p && norm(p.from) === cur && norm(p.to) === lat) || null;
      if (patch && (!patch.url || !patch.sha256)) patch = null;   // 信息不全就不用
    }
  } catch (e) { patch = null; }

  return { hasUpdate, latest, url: dlUrl, notes, force, raw: data, feedUrl: got.url, patch };
}

// 下载更新包到指定目录，返回本地路径
// 用全局 fetch（走 Chromium 网络栈 → 自动使用系统代理），
// 所以开了代理/节点的用户下载也能通。
  // ★ 下载地址多源：GitHub Release 直连在国内常被墙，这里按顺序试镜像。
  //   update.json 里只要写 GitHub 原始地址即可，程序自动套镜像。
  function buildDownloadTargets(dlUrl) {
    const raw = String(dlUrl || '');
    const out = [];
    if (!raw) return out;

    const isGithub = /^https?:\/\/(github\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com|codeload\.github\.com)\//i.test(raw);

    if (isGithub) {
      // 2026-11 实测速度（577MB 整包，下载 3MB 测速）：
      //   gh-proxy.com  935 KB/s  ← 最快
      //   GitHub 直连    766 KB/s
      //   ghfast.top    712 KB/s
      //   ghproxy.net   完全无响应（已剔除）
      out.push('https://gh-proxy.com/' + raw);
      out.push('https://ghfast.top/' + raw);
      out.push(raw);   // 官方兜底（部分网络下反而比镜像快）
    } else {
      // 非 GitHub（123 网盘等）：原样 + 无镜像
      out.push(raw);
    }

    // 去重
    return Array.from(new Set(out));
  }

async function downloadUpdateSingle(dlUrl, destDir, onProgress) {
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

      // ★ 卡住检测：连续 STALL_MS 毫秒没收到任何字节 → 判定源挂了，立刻 abort 整个请求
      //
      //   坑：reader.cancel() 不会立刻让阻塞的 read() 返回（实测要等几十秒，
      //   因为底层 TCP 连接还在）。必须用 AbortController.abort() 才能真正断开。
      const STALL_MS = 8000;
      let lastDataAt = Date.now();
      let stalled = false;
      let abortCtrl = null;

      // 外部传入的 ctrl 已经 abort 过一次（30 分钟超时），这里新建一个专门给卡住检测用
      // 用 res.body 的 cancel + 强制错误抛出组合

      let _rejectStall = null;
      const stallPromise = new Promise((_, reject) => { _rejectStall = reject; });

      const stallTimer = setInterval(() => {
        if (Date.now() - lastDataAt > STALL_MS && !stalled) {
          stalled = true;
          clearInterval(stallTimer);
          const secs = Math.round((Date.now() - lastDataAt) / 1000);
          console.warn('[download] 源卡住 ' + secs + ' 秒无数据，切换下一个');
          // 尝试取消 body（有些实现会立刻让 read 抛错）
          try { reader.cancel().catch(() => {}); } catch (e) {}
          try { _rejectStall(new Error('下载卡住（' + secs + ' 秒无数据）')); } catch (e) {}
        }
      }, 1000);

      try {
        for (;;) {
          if (stalled) throw new Error('下载卡住（' + (STALL_MS / 1000) + ' 秒无数据）');

          // 竞速：read 或 卡住信号，谁先完成算谁
          const result = await Promise.race([
            reader.read(),
            stallPromise,
          ]);

          if (stalled) throw new Error('下载卡住（' + (STALL_MS / 1000) + ' 秒无数据）');

          const { done, value } = result;
          if (done) break;

          const chunk = Buffer.from(value);
          received += chunk.length;
          lastDataAt = Date.now();

          if (!out.write(chunk)) {
            await new Promise((r) => out.once('drain', r));
          }
          const now = Date.now();
          if (onProgress && now - lastReport > 300) {
            lastReport = now;
            onProgress(received, expected);
          }
        }
      } catch (e) {
        // 卡住或网络中断：立刻销毁写入流并删掉半截文件
        try { out.destroy(); } catch (e2) {}
        try { fs.unlinkSync(savePath); } catch (e2) {}
        throw e;
      } finally {
        clearInterval(stallTimer);
        if (!stalled && !out.destroyed) {
          try { await new Promise((r) => out.end(r)); } catch (e) {}
        }
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
    // ★ 卡住 / 网络中断 / 内容异常 → 直接抛出，让外层换下一个源。
    //   不能「回退到整块下载」——同一个源刚才已经卡住了，再请求一次只会白等。
    const msg = (e && e.message) || String(e);
    const noFallback = /卡住|请求超时|aborted|AbortError|下载内容异常|下载不完整|network|ECONN|ETIMEDOUT/i.test(msg);
    if (noFallback) {
      console.warn('[updater] 流式下载失败（不再回退）: ' + msg);
      throw e;
    }
    console.error('[updater] 流式下载失败，回退整块下载: ' + msg);
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

// ★ 对外接口：多源自动重试 + 卡住检测
//   GitHub Release 直连在国内常被墙，按镜像顺序试。
//   update.json 里只要写 GitHub 原始地址即可，镜像由这里自动套。
//
//   实测速度（2026-11，577MB 整包）：
//     gh-proxy.com 935 KB/s / GitHub 直连 766 KB/s / ghfast.top 712 KB/s
//   也就是说整包最快也要 10 分钟，所以：
//     ① 优先走补丁（几十 KB，秒完成）
//     ② 整包下载必须能检测「卡住」并快速换源，不能干等 30 分钟
async function downloadUpdate(dlUrl, destDir, onProgress) {
  const targets = buildDownloadTargets(dlUrl);
  if (!targets.length) throw new Error('下载地址为空');

  let lastErr = null;
  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    const label = (function (u) {
      try { return new URL(u).hostname; } catch (e) { return u.substring(0, 30); }
    })(url);
    try {
      if (i > 0) console.log('[download] 切换下载源 ' + (i + 1) + '/' + targets.length + ': ' + label);
      const r = await downloadUpdateSingle(url, destDir, onProgress);
      console.log('[download] 成功（源: ' + label + '）');
      return r;
    } catch (e) {
      lastErr = e;
      console.warn('[download] 源 ' + label + ' 失败: ' + (e && e.message));
      if (i < targets.length - 1) {
        await new Promise(function (r) { setTimeout(r, 500); });
      }
    }
  }

  throw new Error('所有下载源都失败：' + ((lastErr && lastErr.message) || '未知错误'));
}

// 修正 123 云盘的 .bak 后缀：xxx.exe.bak → xxx.exe
// 修正被 CDN / 浏览器改坏的文件后缀。
// 123 网盘的坑：
//   ① 响应头 Content-disposition 带 .bak       → xxx.exe.bak
//   ② 浏览器按 MIME 猜后缀，application/octet-stream 在手机上会被存成 .apk
//   ③ 有些 CDN 会加 .download / .bin / .tmp
// 这里统一纠正回真实后缀（以文件名里出现的第一个真实扩展名为准）。
function fixBakSuffix(fileName) {
  const s = String(fileName || '').trim();
  if (!s) return s;

  // 去掉连续的尾部垃圾后缀：.bak / .apk / .download / .bin / .tmp / .part / .crdownload
  // 只要前面还存在 .exe/.zip/.msi 就恢复它
  const junk = /\.(bak|apk|download|bin|tmp|part|crdownload|unknown)$/i;
  let out = s;
  while (junk.test(out)) {
    const stripped = out.replace(junk, '');
    // 剥掉后仍需以真实后缀结尾，否则停止（避免把 legit 文件名切成空）
    if (/\.(exe|zip|msi|7z|rar)$/i.test(stripped)) {
      out = stripped;
    } else {
      break;
    }
  }
  // 兜底：若名字里带 .exe 但结尾是垃圾后缀，直接截断到 .exe
  if (!/\.(exe|zip|msi|7z|rar)$/i.test(out)) {
    const m = /\.(exe|zip|msi|7z|rar)(?=\.)/i.exec(out);
    if (m) out = out.slice(0, m.index + m[0].length);
  }
  return out;
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

const patcher = require('./patcher');

module.exports = {
  patcher,
  checkUpdate, compareVersions,
  resolve123panShare, build123panDirectUrl,
  downloadUpdate, extractSetup,
  fixBakSuffix, isExecutable
};
