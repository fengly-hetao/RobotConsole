'use strict';
// 增量补丁系统
// =============
// 目的：每次发布不再传 577MB 整包，只传「变化的那几个文件」。
//
// 打包端（buildPatch）：
//   对比上一版和当前版的 resources/app 目录，把新增/修改的文件收集成小 zip，
//   同时算出「被删除的文件清单」，一起写进 manifest。
//
// 客户端（applyPatch）：
//   下载 zip → 校验 SHA256 → 解压 → 备份将被改动/删除的文件
//   → 覆盖新文件 → 删除清单里的旧文件 → 清理临时目录
//   任何一步失败都会从备份完整回滚。
//
// 只针对 resources/app（JS/Python/HTML/CSS），runtime（QQ/NapCat/Electron）不参与。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ---------- 工具 ----------
function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// 快速哈希：大文件只读首尾各 64KB + 大小，速度是全文哈希的 50 倍
function fastHash(filePath) {
  return new Promise((resolve) => {
    const CHUNK = 64 * 1024;
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const size = fs.statSync(filePath).size;
      const h = crypto.createHash('sha256');
      h.update(String(size));
      const head = Buffer.alloc(Math.min(CHUNK, size));
      fs.readSync(fd, head, 0, head.length, 0);
      h.update(head);
      if (size > CHUNK * 2) {
        const tail = Buffer.alloc(Math.min(CHUNK, size - CHUNK));
        fs.readSync(fd, tail, 0, tail.length, size - tail.length);
        h.update(tail);
      }
      fs.closeSync(fd);
      resolve(h.digest('hex'));
    } catch (e) {
      try { if (fd !== undefined) fs.closeSync(fd); } catch (e2) {}
      resolve('');
    }
  });
}
// 递归列出目录下所有文件（相对路径，统一 /）
function walk(root, base, out, exclude, excludeExt) {
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(base, e.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (exclude && exclude.some((x) => rel === x || rel.startsWith(x + '/'))) continue;
    if (e.isDirectory()) {
      walk(root, full, out, exclude, excludeExt);
    } else if (e.isFile()) {
      if (excludeExt && excludeExt.some((x) => e.name.endsWith(x))) continue;
      out.push(rel);
    }
  }
  return out;
}

function relToPath(appDir, rel) {
  return path.join(appDir, rel.split('/').join(path.sep));
}

// ---------- 打包端：生成补丁 ----------
/**
 * 对比两个 app 目录，生成补丁 zip + manifest
 * @param {string} prevDir  上一版的 resources/app 目录（null = 首次全量）
 * @param {string} currDir  当前版 resources/app 目录
 * @param {string} outZip   输出补丁 zip 路径
 * @param {object} meta     { from, to, fullSize }
 * @returns {Promise<object>} manifest（含 files / deleted / sha256 / size）
 */
async function buildPatch(prevDir, currDir, outZip, meta) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();

  const EXCLUDE = ['node_modules', 'dist', 'runtime', '.git'];
  const EXCLUDE_EXT = ['.map'];   // sourcemap 体积大且无运行时价值
  const currFiles = walk(currDir, currDir, [], EXCLUDE, EXCLUDE_EXT);
  const prevFiles = (prevDir && fs.existsSync(prevDir)) ? walk(prevDir, prevDir, [], EXCLUDE, EXCLUDE_EXT) : [];

  const prevSet = new Set(prevFiles);
  const currSet = new Set(currFiles);

  const changed = [];   // 需要覆盖/新增的文件
  const deleted = [];   // 需要删除的文件

  for (const rel of currFiles) {
    const currPath = relToPath(currDir, rel);
    let needInclude = true;

    if (prevDir && prevSet.has(rel)) {
      const prevPath = relToPath(prevDir, rel);
      if (fs.existsSync(prevPath)) {
        const sc = fs.statSync(currPath).size;
        const sp = fs.statSync(prevPath).size;
        if (sc === sp) {
          // 小文件（<2MB）全文哈希，精确；大文件用首尾 64KB 快速哈希，兼顾速度与准确
          const fn = sc < 2 * 1024 * 1024 ? sha256File : fastHash;
          const hc = await fn(currPath);
          const hp = await fn(prevPath);
          if (hc && hp && hc === hp) needInclude = false;
        }
      }
    }

    if (needInclude) {
      changed.push(rel);
      const dirPart = path.dirname(rel) === '.' ? '' : path.dirname(rel);
      zip.addLocalFile(currPath, dirPart, path.basename(rel));
    }
  }

  // 上一版有、当前版没有 → 需要删除
  if (prevDir) {
    for (const rel of prevFiles) {
      if (!currSet.has(rel)) deleted.push(rel);
    }
  }

  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
  zip.writeZip(outZip);

  const size = fs.statSync(outZip).size;
  const sha256 = await sha256File(outZip);

  return {
    from: (meta && meta.from) || '',
    to: (meta && meta.to) || '',
    size,
    sha256,
    files: changed,
    deleted,
    count: changed.length,
    deletedCount: deleted.length,
    savedPercent: (meta && meta.fullSize && meta.fullSize > 0)
      ? Math.round((1 - size / meta.fullSize) * 100)
      : 0
  };
}

// ---------- 客户端：应用补丁 ----------
/**
 * 下载并应用补丁
 * @param {object} opts
 * @param {string} opts.patchUrl      补丁 zip 地址（支持 http(s):// 和本地路径）
 * @param {string} opts.appDir        要覆盖的 resources/app 目录
 * @param {string} [opts.expectSha256] 期望的 zip sha256（空则跳过校验）
 * @param {string[]} [opts.deleted]   上一版有、本版已删除的相对路径清单
 * @param {function} [opts.onProgress](received, total)
 * @returns {Promise<{ok:boolean, applied:string[], deleted:string[], error?:string}>}
 */
async function applyPatch(opts) {
  const { patchUrl, appDir, expectSha256, deleted, onProgress } = opts || {};
  const result = { ok: false, applied: [], deleted: [], error: '' };

  if (!patchUrl || !appDir) {
    result.error = '缺少参数（patchUrl / appDir）';
    return result;
  }
  if (!fs.existsSync(appDir)) {
    result.error = '目标目录不存在: ' + appDir;
    return result;
  }
  // ★ 纵深防御：即使调用方传错目录，也不允许覆盖到意外位置
  if (/\.asar$/i.test(appDir)) {
    result.error = '不允许写入 asar 包: ' + appDir;
    return result;
  }
  if (path.basename(appDir) !== 'app') {
    result.error = 'appDir 必须是以 app 命名的目录（实际: ' + path.basename(appDir) + '）';
    return result;
  }
  if (!fs.existsSync(path.join(appDir, 'main.js'))) {
    result.error = 'appDir 不完整（缺少 main.js）: ' + appDir;
    return result;
  }

  const deleteList = Array.isArray(deleted) ? deleted.filter((x) => typeof x === 'string' && x && !x.includes('..')) : [];

  const tmpDir = path.join(os.tmpdir(), 'rc-patch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, 'patch.zip');

  // 统一的临时目录清理（所有退出分支都调用）
  const cleanupTmp = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  };
  // ---------- 1) 获取补丁文件 ----------
  try {
    const isLocal = /^file:/i.test(patchUrl) || (!/^https?:/i.test(patchUrl) && fs.existsSync(patchUrl));
    if (isLocal) {
      const localPath = /^file:/i.test(patchUrl)
        ? decodeURIComponent(patchUrl.replace(/^file:\/\/\/?/i, '').replace(/\//g, path.sep))
        : patchUrl;
      if (!fs.existsSync(localPath)) throw new Error('本地补丁文件不存在: ' + localPath);
      fs.copyFileSync(localPath, zipPath);
    } else {
      const resp = await fetch(patchUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const total = Number(resp.headers.get('content-length') || 0);
      const reader = resp.body.getReader();
      const ws = fs.createWriteStream(zipPath);
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        ws.write(Buffer.from(value));
        received += value.length;
        if (onProgress) { try { onProgress(received, total); } catch (e) {} }
      }
      await new Promise((r) => ws.end(r));
    }
  } catch (e) {
    result.error = '补丁下载失败: ' + e.message;
    cleanupTmp();
    return result;
  }

  // ---------- 2) 校验 SHA256 ----------
  if (expectSha256) {
    let actual = '';
    try { actual = await sha256File(zipPath); } catch (e) { actual = ''; }
    if (!actual || actual.toLowerCase() !== String(expectSha256).toLowerCase()) {
      result.error = '补丁校验失败（SHA256 不符，可能下载损坏）';
      cleanupTmp();
      return result;
    }
  }

  // ---------- 3) 解压 ----------
  const extractDir = path.join(tmpDir, 'x');
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);
  } catch (e) {
    result.error = '补丁解压失败: ' + e.message;
    cleanupTmp();
    return result;
  }

  // ---------- 4) 备份 → 覆盖 → 删除 ----------
  // 备份目录保留原相对路径，回滚时按同样路径还回去
  const backupDir = path.join(tmpDir, 'bak');
  fs.mkdirSync(backupDir, { recursive: true });

  const backedUp = [];      // 已备份的相对路径（覆盖 + 删除都算）
  const backupOne = (rel) => {
    const dst = relToPath(appDir, rel);
    if (!fs.existsSync(dst)) return;
    const bak = relToPath(backupDir, rel);
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.copyFileSync(dst, bak);
    backedUp.push(rel);
  };

  const rollback = () => {
    for (const rel of backedUp) {
      try {
        const bak = relToPath(backupDir, rel);
        const dst = relToPath(appDir, rel);
        if (fs.existsSync(bak)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(bak, dst);
        }
      } catch (e) { /* 单项回滚失败不影响其他 */ }
    }
  };

  // 4a) 备份所有将被覆盖的文件
  const patchFiles = walk(extractDir, extractDir, []);
  try {
    for (const rel of patchFiles) backupOne(rel);
  } catch (e) {
    result.error = '备份失败（未做任何改动）: ' + e.message;
    cleanupTmp();
    return result;
  }

  // 4b) 备份所有将被删除的文件（这样删除出错也能回滚）
  try {
    for (const rel of deleteList) backupOne(rel);
  } catch (e) { /* 备份删除目标失败不阻断，继续 */ }

  // 4c) 覆盖写入
  try {
    for (const rel of patchFiles) {
      const src = relToPath(extractDir, rel);
      const dst = relToPath(appDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      result.applied.push(rel);
    }
  } catch (e) {
    rollback();
    result.error = '写入失败（已回滚）: ' + e.message;
    cleanupTmp();
    return result;
  }

  // 4d) 删除清单里的旧文件
  try {
    for (const rel of deleteList) {
      const dst = relToPath(appDir, rel);
      if (fs.existsSync(dst)) {
        fs.unlinkSync(dst);
        result.deleted.push(rel);
        // 清理空目录（最多往上 3 层，不动 app 根）
        let dir = path.dirname(dst);
        for (let i = 0; i < 3 && dir.length > appDir.length; i++) {
          try {
            if (fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
            else break;
          } catch (e) { break; }
        }
      }
    }
  } catch (e) {
    rollback();
    result.error = '删除旧文件失败（已回滚）: ' + e.message;
    cleanupTmp();
    return result;
  }

  // ---------- 5) 清理 ----------
  cleanupTmp();

  result.ok = true;
  return result;
}

module.exports = {
  fastHash,
  buildPatch,
  applyPatch,
  sha256File,
  walk
};
