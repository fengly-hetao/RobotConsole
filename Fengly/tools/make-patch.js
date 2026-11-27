/*
生成增量补丁包
=============
用法：
  node tools/make-patch.js <旧版本号> <新版本号> [--out <输出目录>]

原理：
  对比两个版本的 resources/app 目录（不含 node_modules / runtime / dist），
  把新增和改动的文件打成一个小 zip，并输出 patch.json 供 update.json 引用。

前置：
  需要两个版本的 app 目录。脚本会自动从以下位置找：
    - F:/RobotConsole/最新新版/<版本>/resources/app
    - F:/RobotConsole/snapshots/<版本>/app
  都没有时，用 --prev-dir / --curr-dir 手动指定。

示例：
  node tools/make-patch.js 1.9.5 1.9.6
  → 输出 F:/RobotConsole/.zuixin/patch-1.9.5-to-1.9.6.zip
  → 输出补丁信息（贴到 update.json 的 patch 字段）
*/

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');   // F:/RobotConsole
const SNAP_ROOT = path.join(ROOT, 'snapshots');
const ZUIXIN = path.join(ROOT, '.zuixin');

function usage() {
  console.log('用法: node make-patch.js <旧版本> <新版本> [--prev-dir <目录>] [--curr-dir <目录>] [--out <目录>]');
  process.exit(1);
}

function findAppDir(version, explicit) {
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    throw new Error('指定目录不存在: ' + explicit);
  }
  const candidates = [
    path.join(SNAP_ROOT, version, 'app'),
    path.join(SNAP_ROOT, version, 'resources', 'app'),
    path.join(ROOT, '最新新版', version, 'resources', 'app'),
    path.join(ROOT, '最新新版', version, 'app')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, 'main.js'))) return c;
  }
  throw new Error(
    '找不到版本 ' + version + ' 的 app 目录。\n' +
    '请用 --prev-dir / --curr-dir 指定，或先把该版本快照放到：\n  ' +
    candidates[0]
  );
}

/**
 * 保存当前版本快照（发布新版本前调用，供下次生成补丁）
 */
function snapshotAppDir(appDir, version) {
  const dest = path.join(SNAP_ROOT, version, 'app');
  if (fs.existsSync(dest)) {
    console.log('快照已存在，跳过: ' + dest);
    return dest;
  }
  fs.mkdirSync(dest, { recursive: true });
const EXCLUDE = ['node_modules', 'dist', '.git'];
// runtime 下只排除第三方二进制，Python 插件必须进补丁
const RUNTIME_HEAVY = ['qq', 'napcat', 'tools', 'win64', 'backups', 'napcat-versions'];
  copyTree(appDir, dest, EXCLUDE, "");
  console.log('已保存快照: ' + dest);
  return dest;
}

// relPrefix: 相对 appDir 的路径前缀，用于识别 runtime 下的重型子目录
function copyTree(src, dst, exclude, relPrefix) {
  let entries = [];
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const rel = relPrefix ? (relPrefix + "/" + e.name) : e.name;

    // 顶层排除：node_modules / dist / .git
    if (relPrefix === "" && exclude && exclude.includes(e.name)) continue;

    // runtime 顶部只排除第三方二进制
    if (rel === "runtime/qq" || rel === "runtime/napcat" || rel === "runtime/tools" ||
        rel === "runtime/win64" || rel === "runtime/backups" || rel === "runtime/napcat-versions") {
      continue;
    }

    // Python 缓存 / 运行时数据不进补丁
    if (e.isDirectory() && (e.name === "__pycache__" || e.name === ".cache")) continue;

    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d, exclude, rel);
    } else if (e.isFile()) {
      if (/\.pyc$/i.test(e.name)) continue;
      if (e.name === ".env" || e.name.startsWith(".env.")) continue;
      fs.copyFileSync(s, d);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) usage();

  const fromVer = argv[0];
  const toVer = argv[1];

  let prevDirArg = '';
  let currDirArg = '';
  let outDir = ZUIXIN;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--prev-dir' && argv[i + 1]) { prevDirArg = argv[++i]; }
    else if (argv[i] === '--curr-dir' && argv[i + 1]) { currDirArg = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { outDir = argv[++i]; }
  }

  const patcher = require(path.join(__dirname, '..', 'modules', 'patcher.js'));

  console.log('=== 生成增量补丁 ===');
  console.log('  从: ' + fromVer);
  console.log('  到: ' + toVer);

  const prevDir = findAppDir(fromVer, prevDirArg);
  const currDir = findAppDir(toVer, currDirArg);
  console.log('  旧版目录: ' + prevDir);
  console.log('  新版目录: ' + currDir);

  fs.mkdirSync(outDir, { recursive: true });
  const outZip = path.join(outDir, `patch-${fromVer}-to-${toVer}.zip`);

  const t0 = Date.now();
  const r = await patcher.buildPatch(prevDir, currDir, outZip, {
    from: fromVer,
    to: toVer,
    fullSize: 577 * 1024 * 1024
  });
  const ms = Date.now() - t0;

  const info = {
    from: fromVer,
    to: toVer,
    url: 'https://你的CDN地址/patch-' + fromVer + '-to-' + toVer + '.zip',
    size: r.size,
    sha256: r.sha256,
    fileCount: r.count,
    files: r.files,
    deleted: r.deleted          // ★ 客户端靠这个删除旧文件
  };

  console.log('');
  console.log('=== 完成 ===');
  console.log('  耗时: ' + ms + ' ms');
  console.log('  变更文件: ' + r.count + ' 个');
  console.log('  删除文件: ' + r.deletedCount + ' 个');
  console.log('  补丁大小: ' + (r.size / 1024).toFixed(1) + ' KB');
  console.log('  输出: ' + outZip);
  console.log('');
  console.log('=== 把下面这段贴进 update.json 的 patch 字段 ===');
  console.log(JSON.stringify({
    patch: {
      from: info.from,
      to: info.to,
      url: info.url,
      size: info.size,
      sha256: info.sha256,
      fileCount: r.count,
      deletedCount: r.deleted.length,
      deleted: r.deleted
    }
  }, null, 2));

  if (r.files.length <= 30) {
    console.log('');
    console.log('=== 变更清单 ===');
    r.files.forEach((f) => console.log('  + ' + f));
    r.deleted.forEach((f) => console.log('  - ' + f));
  }

  // 保存一份 json 方便脚本引用
  const metaPath = path.join(outDir, `patch-${fromVer}-to-${toVer}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(info, null, 2), 'utf8');
  console.log('');
  console.log('元信息已保存: ' + metaPath);
}

// 导出给其他脚本用
module.exports = { snapshotAppDir, findAppDir };

if (require.main === module) {
  main().catch((e) => {
    console.error('失败: ' + e.message);
    process.exit(1);
  });
}
