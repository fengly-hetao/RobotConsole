'use strict';
// 消息记录目录迁移
// ================
// 用户把消息目录改到别处时，已有的 .log 文件要搬过去：
//   1. 新旧目录相同 → 什么都不做
//   2. 新目录不存在 → 创建
//   3. 新目录已有同名文件 → 不覆盖，改名为 xxx.1.log / xxx.2.log（保留两边数据）
//   4. 复制成功后删除原目录里的已复制文件（原目录空了就一并删掉）
//
// 之所以「复制 + 删除源文件」而不是直接 move：
//   跨盘 move 本来就是复制+删除；但先复制能保证中途失败不丢数据。

const fs = require('fs');
const path = require('path');

function norm(p) {
  try { return path.resolve(p).toLowerCase().replace(/[\\/]+$/, ''); } catch (e) { return String(p || '').toLowerCase(); }
}

/**
 * 列出一个目录里的 .log 文件
 */
function listLogs(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.log'));
  } catch (e) { return []; }
}

/**
 * 给冲突文件找一个不重复的名字：xxx.log → xxx.1.log → xxx.2.log …
 */
function uniqueName(dir, name) {
  const dst = path.join(dir, name);
  if (!fs.existsSync(dst)) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = base + '.' + i + ext;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return base + '.' + Date.now() + ext;
}

/**
 * 迁移消息目录
 * @param {object} opts
 * @param {string} opts.from        原目录（可为空/不存在）
 * @param {string} opts.to          目标目录
 * @param {boolean} [opts.dryRun]   只统计不实际执行
 * @returns {{ok:boolean, copied:string[], renamed:string[], removed:string[], removedDirs:string[], error?:string}}
 */
function migrateMessages(opts) {
  const from = opts && opts.from;
  const to = opts && opts.to;
  const dryRun = !!(opts && opts.dryRun);

  const result = { ok: false, copied: [], renamed: [], removed: [], removedDirs: [], error: '' };

  if (!from || !to) {
    result.error = '缺少 from / to 参数';
    return result;
  }
  if (norm(from) === norm(to)) {
    // 同一个目录，无需迁移
    result.ok = true;
    return result;
  }

  // 源目录不存在 = 没有历史数据，只需创建目标目录
  if (!fs.existsSync(from)) {
    if (!dryRun) {
      try { fs.mkdirSync(to, { recursive: true }); } catch (e) {
        result.error = '无法创建目标目录: ' + e.message;
        return result;
      }
    }
    result.ok = true;
    return result;
  }

  // 创建目标目录
  if (!dryRun) {
    try { fs.mkdirSync(to, { recursive: true }); } catch (e) {
      result.error = '无法创建目标目录: ' + e.message;
      return result;
    }
  }

  const logs = listLogs(from);

  // ---------- 复制 ----------
  for (const name of logs) {
    const src = path.join(from, name);
    let targetName = name;
    try {
      if (fs.existsSync(path.join(to, name))) {
        targetName = uniqueName(to, name);
      }
      if (!dryRun) {
        fs.copyFileSync(src, path.join(to, targetName));
      }
      result.copied.push(targetName);
      if (targetName !== name) result.renamed.push(name + ' → ' + targetName);
    } catch (e) {
      result.error = '复制失败（' + name + '）: ' + e.message;
      return result;   // 中途失败：已复制的保留，源文件一个不动
    }
  }

  // ---------- 删除源文件（只删已成功复制的） ----------
  if (!dryRun) {
    for (const name of logs) {
      const src = path.join(from, name);
      try {
        // 校验：目标里确实存在同名或改名后的文件，且大小一致，才敢删
        const candidates = [name, ...listLogs(to).filter((x) => x.startsWith(name.replace(/\.log$/i, '.')))];
        const found = candidates.find((c) => {
          const p = path.join(to, c);
          return fs.existsSync(p) && fs.statSync(p).size === fs.statSync(src).size;
        });
        if (!found) continue;   // 没找到对应的，不删（保守）
        fs.unlinkSync(src);
        result.removed.push(name);
      } catch (e) {
        result.error = '删除源文件失败（' + name + '）: ' + e.message;
        // 不中断，继续删其他
      }
    }

    // ---------- 源目录空了就删掉 ----------
    try {
      const rest = fs.readdirSync(from);
      if (rest.length === 0) {
        fs.rmdirSync(from);
        result.removedDirs.push(from);
      } else {
        // 尝试把空的父目录也清掉（logs 目录下如果只剩 messages 就删 logs）
        void 0;
      }
    } catch (e) { /* 目录删不掉不影响 */ }
  }

  result.ok = !result.error;
  return result;
}

/**
 * 预览迁移（只统计，不动文件）
 */
function previewMigrate(from, to) {
  const r = migrateMessages({ from, to, dryRun: true });
  return {
    ok: r.ok,
    count: r.copied.length,
    files: r.copied,
    error: r.error,
    same: norm(from) === norm(to)
  };
}

module.exports = { migrateMessages, previewMigrate, listLogs, resolveNorm: norm };
