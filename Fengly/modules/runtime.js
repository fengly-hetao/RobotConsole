'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 打包后运行时位于 resources/runtime，开发时位于项目根目录 runtime/
// 注意：绿色版 runtime 里【没有 node.exe】，所以不能用 node.exe 作为判断依据，
// 否则会永远 fallback 到不存在的 resources/app/runtime，导致运行时永远补不全。
function getBundledPath() {
  const packaged = path.join(process.resourcesPath || '', 'runtime');
  // 用 NapCat 启动器 / VERSION 判断，这两个才是运行时一定有的标志文件
  if (fs.existsSync(path.join(packaged, 'napcat', 'NapCatWinBootMain.exe'))) return packaged;
  if (fs.existsSync(path.join(packaged, 'VERSION'))) return packaged;
  if (fs.existsSync(path.join(packaged, 'qq', 'QQ.exe'))) return packaged;

  const dev = path.join(__dirname, '..', 'runtime');
  if (fs.existsSync(path.join(dev, 'napcat', 'NapCatWinBootMain.exe'))) return dev;
  if (fs.existsSync(path.join(dev, 'VERSION'))) return dev;
  return dev;
}

function getRuntimePath() {
  return path.join(app.getPath('userData'), 'runtime');
}

function exists(p) { return fs.existsSync(p); }

// 首次运行：把打包内的运行时解压到可写目录；后续运行保留用户改动，仅补齐缺失文件
function readVersion(dir) {
  try { return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); }
  catch (e) { return ''; }
}

function preserveUserData(dst, tmpBase) {
  // 把用户数据先搬到临时目录，升级代码后搬回
  const moves = [
    [path.join(dst, 'napcat', 'config'), path.join(tmpBase, 'napcat-config')],
    [path.join(dst, 'napcat', 'cache'), path.join(tmpBase, 'napcat-cache')],
    [path.join(dst, 'napcat', 'logs'), path.join(tmpBase, 'napcat-logs')],
    [path.join(dst, 'tianlu_bot', '.env'), path.join(tmpBase, 'bot-env')],
    [path.join(dst, 'tianlu_bot', '.env.prod'), path.join(tmpBase, 'bot-env-prod')],
    [path.join(dst, 'tianlu_bot', 'data'), path.join(tmpBase, 'bot-data')],
    [path.join(dst, 'tianlu_bot', 'ai_data'), path.join(tmpBase, 'bot-ai-data')],
    [path.join(dst, 'tianlu_bot', 'images'), path.join(tmpBase, 'bot-images')],
    [path.join(dst, 'tianlu_bot', 'logs'), path.join(tmpBase, 'bot-logs')],
    [path.join(dst, 'tianlu_bot', 'game_data'), path.join(tmpBase, 'bot-game-data')]
  ];
  const moved = [];
  for (const [from, to] of moves) {
    try {
      if (exists(from)) { fs.renameSync(from, to); moved.push([from, to]); }
    } catch (e) { try { fs.cpSync(from, to, { recursive: true, force: true }); fs.rmSync(from, { recursive: true, force: true }); moved.push([from, to]); } catch (e2) {} }
  }
  return moved;
}

function restoreUserData(moved) {
  for (const [from, to] of moved.reverse()) {
    try { fs.renameSync(to, from); }
    catch (e) { try { fs.cpSync(to, from, { recursive: true, force: true }); fs.rmSync(to, { recursive: true, force: true }); } catch (e2) {} }
  }
}

// 运行时完整性校验：必须同时满足这些关键文件存在，才算"已就绪"。
// 只判断 qq 目录是否存在是不够的 —— 复制中断会留下空壳目录，
// 之后每次启动都会被误判为"已解压"，导致永远不再补齐，NapCat 永远起不来。
const REQUIRED_RUNTIME = [
  'napcat/NapCatWinBootMain.exe',
  'napcat/NapCatWinBootHook.dll',
  'napcat/napcat.mjs',
  'qq/QQ.exe',
  'tianlu_bot/bot.py'
];

function isRuntimeComplete(dir) {
  if (!dir || !exists(dir)) return false;
  for (const rel of REQUIRED_RUNTIME) {
    if (!exists(path.join(dir, rel.split('/').join(path.sep)))) return false;
  }
  return true;
}

// 用 robocopy 复制目录（Windows 原生，能可靠处理 QQ 这种超大/长路径目录；
// fs.cpSync 在 1GB+ 深层目录上会静默失败，只复制一部分且不报错）
// /E 所有子目录   /XC /XN /XO 只补缺失(不覆盖已存在)   /R:1 /W:1 失败重试1次
function copyDirRobocopy(src, dst, report) {
  const { execFileSync } = require('child_process');
  try {
    if (report) report('正在复制 ' + path.basename(dst) + ' …');
  } catch (e) {}
  try {
    mkdirp(dst);
    execFileSync('robocopy', [
      src, dst, '/E', '/XC', '/XN', '/XO',
      '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
    ], { windowsHide: true, timeout: 600000, stdio: 'ignore' });
    return true;
  } catch (e) {
    // robocopy 退出码 0-7 都算成功（0=无变化, 1=已复制 ...），>=8 才是真失败
    const code = typeof e.status === 'number' ? e.status : 99;
    if (code < 8) return true;
    console.error('[runtime] robocopy 失败(' + code + '): ' + e.message);
    return false;
  }
}

function mkdirp(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) {}
}

// 补齐运行时：只补缺失文件，不覆盖用户已有配置
function repairRuntime(src, dst, report) {
  const dirs = ['napcat', 'qq', 'tianlu_bot', 'tools', 'win64'];
  for (const d of dirs) {
    const s2 = path.join(src, d);
    const d2 = path.join(dst, d);
    if (!exists(s2)) continue;
    const ok = copyDirRobocopy(s2, d2, report);
    if (!ok && report) report(d + ' 目录复制失败');
  }
  // 顶层散落的文件（VERSION 等）
  try {
    for (const f of fs.readdirSync(src, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const s3 = path.join(src, f.name);
      const d3 = path.join(dst, f.name);
      if (!exists(d3)) { try { fs.copyFileSync(s3, d3); } catch (e) {} }
    }
  } catch (e) {}
}

function ensureRuntime(onProgress) {
  const src = getBundledPath();
  const dst = getRuntimePath();
  const report = (msg) => onProgress && onProgress(msg);

  const dstOk = isRuntimeComplete(dst);
  const srcOk = isRuntimeComplete(src);

  if (!dstOk) {
    // 目标不完整（首次运行 / 上次复制中断 / 被误删）→ 补齐
    if (!srcOk) {
      console.error('[runtime] 内置运行时也不完整，无法补齐: ' + src);
      report('运行时缺失，无法自动修复');
      return dst;
    }

    const missing = REQUIRED_RUNTIME.filter((rel) => !exists(path.join(dst, rel.split('/').join(path.sep))));
    console.log('[runtime] 开始补齐运行时，src=' + src + ' dst=' + dst + ' 缺失关键项=' + missing.join(','));
    if (missing.length === REQUIRED_RUNTIME.length) {
      report('正在解压运行时（含独立 QQ 环境，首次约需 1-3 分钟，请耐心等待）…');
    } else {
      report('运行时文件不完整，正在自动修复（补齐 ' + missing.length + ' 项关键文件）…');
    }

    repairRuntime(src, dst, report);

    if (isRuntimeComplete(dst)) {
      console.log('[runtime] 运行时补齐完成');
      report('运行时准备完成');
    } else {
      const still = REQUIRED_RUNTIME.filter((rel) => !exists(path.join(dst, rel.split('/').join(path.sep))));
      console.error('[runtime] 补齐后仍缺失: ' + still.join(','));
      report('运行时仍不完整，请检查磁盘空间或权限');
    }
  } else if (readVersion(src) !== readVersion(dst)) {
    // 应用升级：只更新代码，保留用户数据（配置/密钥/人格/游戏数据）
    // 优化：不再整目录盲拷，跳过 logs/cache/node_modules 等大目录，速度提升数倍
    report('正在升级运行时（保留你的配置）…');
    const tmpBase = dst + '.userdata-' + Date.now();
    fs.mkdirSync(tmpBase, { recursive: true });
    const moved = preserveUserData(dst, tmpBase);
    // 需要跳过的目录/文件（运行时生成物，不需要从模板覆盖）
    const SKIP = new Set(['logs', 'cache', '__pycache__', 'node_modules', 'data', 'ai_data',
      'music_cache', 'tts_cache', 'voice_ref', 'images', 'backups', 'archive', 'message']);
    const copyFiltered = (srcDir, dstDir, depth) => {
      if (depth > 12) return;
      let entries = [];
      try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch (e) { return; }
      fs.mkdirSync(dstDir, { recursive: true });
      for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const s = path.join(srcDir, e.name);
        const d = path.join(dstDir, e.name);
        if (e.isDirectory()) copyFiltered(s, d, depth + 1);
        else {
          try {
            // 只在模板文件更新或目标不存在时覆盖
            const srcStat = fs.statSync(s);
            let need = true;
            try {
              const dstStat = fs.statSync(d);
              need = srcStat.mtimeMs > dstStat.mtimeMs || srcStat.size !== dstStat.size;
            } catch (e2) { need = true; }
            if (need) fs.copyFileSync(s, d);
          } catch (e2) {}
        }
      }
    };
    try {
      report('正在更新 NapCat…');
      copyFiltered(path.join(src, 'napcat'), path.join(dst, 'napcat'), 0);
      report('正在更新独立 QQ 环境…');
      copyFiltered(path.join(src, 'qq'), path.join(dst, 'qq'), 0);
      report('正在更新机器人代码…');
      copyFiltered(path.join(src, 'tianlu_bot'), path.join(dst, 'tianlu_bot'), 0);
      // 适配器与工具：仅补齐
      report('正在更新适配器…');
      const adapter = ['node.exe', 'wrapper.node', 'QQNT.dll', 'avif_convert.dll', 'broadcast_ipc.dll', 'libglib-2.0-0.dll', 'libgobject-2.0-0.dll', 'libvips-42.dll', 'LightQuic.dll', 'ncnn.dll', 'opencv.dll', 'QBar.dll', 'index.js', 'config.json', 'package.json', 'napcat.bat'];
      for (const f of adapter) {
        if (exists(path.join(src, f)) && !exists(path.join(dst, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
      if (exists(path.join(src, 'win64')) && !exists(path.join(dst, 'win64'))) fs.cpSync(path.join(src, 'win64'), path.join(dst, 'win64'), { recursive: true });
      if (exists(path.join(src, 'tools')) && !exists(path.join(dst, 'tools'))) fs.cpSync(path.join(src, 'tools'), path.join(dst, 'tools'), { recursive: true });
    } finally {
      report('正在恢复你的配置…');
      restoreUserData(moved);
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) {}
    }
    // 记录新版本号
    try { fs.writeFileSync(path.join(dst, 'VERSION'), readVersion(src), 'utf8'); } catch (e) {}
    report('运行时升级完成');
  } else {
    // 补齐缺失的顶层文件/目录
    report('verifying runtime...');
    const topDirs = ['napcat', 'qq', 'tianlu_bot', 'win64', 'tools', '说明书', '更新说明', '速查错误报告', '致谢名单'];
    for (const d of topDirs) {
      if (!exists(path.join(dst, d)) && exists(path.join(src, d))) {
        fs.cpSync(path.join(src, d), path.join(dst, d), { recursive: true, force: false });
      }
    }
    const topFiles = ['node.exe', 'wrapper.node', 'QQNT.dll', 'index.js', 'config.json', 'package.json', 'napcat.bat'];
    for (const f of topFiles) {
      if (!exists(path.join(dst, f)) && exists(path.join(src, f))) {
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
    }
    report('runtime verified');
  }

  ensureWebuiToken(dst);
  return dst;
}

// 每次启动强制重写为最小合法配置（旧版遗留的 accessControlMode 等字段会导致 NapCat 丢弃整个配置）
function ensureWebuiToken(runtimePath) {
  const cfg = path.join(runtimePath, 'napcat', 'config', 'webui.json');
  try {
    let host = '127.0.0.1';
    let port = 8899;
    try {
      const old = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (old && old.host) host = old.host;
      if (old && old.port) port = old.port;
    } catch (e) {}
    const minimal = { host, port, token: 'tianlu' };
    fs.writeFileSync(cfg + '.tmp', JSON.stringify(minimal, null, 4), 'utf8');
    try { fs.renameSync(cfg + '.tmp', cfg); } catch (e) { fs.copyFileSync(cfg + '.tmp', cfg); fs.unlinkSync(cfg + '.tmp'); }
    return 'tianlu';
  } catch (e) {
    return 'tianlu';
  }
}

// 健康自检：检测 napcat 简介里所有功能是否就绪
function healthCheck() {
  const rt = getRuntimePath();
  const items = [];
  const chk = (name, ok, detail) => items.push({ name, ok: !!ok, detail: detail || '' });

  chk('QQ 适配器 node.exe', exists(path.join(rt, 'node.exe')));
  chk('QQ 适配器 wrapper.node', exists(path.join(rt, 'wrapper.node')));
  chk('QQ 适配器 QQNT.dll', exists(path.join(rt, 'QQNT.dll')));
  chk('win64 原生库', exists(path.join(rt, 'win64', 'parent-ipc-core-x64.dll')));
  chk('NapCat 框架 napcat.mjs', exists(path.join(rt, 'napcat', 'napcat.mjs')));
  chk('NapCat 配置 napcat.json', exists(path.join(rt, 'napcat', 'config', 'napcat.json')));
  chk('NapCat 配置 onebot11.json', exists(path.join(rt, 'napcat', 'config', 'onebot11.json')));
  chk('NapCat WebUI', exists(path.join(rt, 'napcat', 'config', 'webui.json')) && exists(path.join(rt, 'napcat', 'static', 'index.html')));
  chk('机器人 bot.py', exists(path.join(rt, 'tianlu_bot', 'bot.py')));
  chk('机器人插件目录', exists(path.join(rt, 'tianlu_bot', 'plugins')));
  chk('AI 配置 ai_data', exists(path.join(rt, 'tianlu_bot', 'ai_data', 'ai_chat.env')));
  chk('.env 配置', exists(path.join(rt, 'tianlu_bot', '.env')));
  chk('Python 安装器', exists(path.join(rt, 'tools', 'python-3.10.11-amd64.exe')));

  // Python 环境
  const py = require('./python').detectPython();
  chk('Python 环境', !!py, py ? (py.path + (py.version ? ' (v' + py.version + ')' : '')) : '未检测到，可在设置中自动安装');

  // ffmpeg（可选，点歌用）
  const ff = require('./network').findFfmpeg();
  chk('ffmpeg（点歌可选）', !!ff, ff || '未安装，可下载或解压到 runtime/tools/ffmpeg');

  return { runtimePath: rt, items, allOk: items.every(i => i.ok) };
}

function listRuntimeFiles(relDir) {
  const rt = getRuntimePath();
  const base = path.join(rt, relDir || '');
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name === '__pycache__' || e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(rt, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        out.push({ type: 'dir', path: rel, name: e.name });
        walk(full, depth + 1);
      } else {
        out.push({ type: 'file', path: rel, name: e.name, size: fs.statSync(full).size });
      }
    }
  };
  walk(base, 0);
  return out;
}

module.exports = {
  getBundledPath, getRuntimePath, ensureRuntime, ensureWebuiToken,
  healthCheck, listRuntimeFiles
};
