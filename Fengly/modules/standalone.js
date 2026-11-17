'use strict';
// 独立启动器：不打开主程序界面，直接拉起 NapCat 或机器人（备用手段）
// 由 napcat.bat / bot.bat 通过 Node 模式调用：
//   electron.exe modules/standalone.js napcat
//   electron.exe modules/standalone.js bot
//
// 复用主程序同一套模块（ports 探测 / network 同步 / procman 启动），
// 因此端口冲突时的自动顺延行为与主程序完全一致。

const path = require('path');
const fs = require('fs');

const appDir = path.join(__dirname, '..');       // resources/app
const resourcesDir = path.dirname(appDir);       // resources

const USERDATA_NAME = 'robot-bot-console';
const userData = process.env.APPDATA ? path.join(process.env.APPDATA, USERDATA_NAME) : '';
const settingsFile = userData ? path.join(userData, 'settings.json') : '';

function say(msg) {
  process.stdout.write(msg + '\n');
  appendLog(msg);
}
function fail(msg) {
  process.stderr.write(msg + '\n');
  appendLog(msg);
}

// 实时日志文件：不依赖 bat 的 Tee（Tee 有缓冲，进程崩溃时会丢日志）
let LOG_FILE = '';
function appendLog(text) {
  if (!LOG_FILE) return;
  try { fs.appendFileSync(LOG_FILE, text + '\n', 'utf8'); } catch (e) {}
}
function initLog(kind) {
  try {
    const dir = path.join(process.env.APPDATA || '', 'robot-bot-console', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    LOG_FILE = path.join(dir, kind + '-' + ts + '.log');
    appendLog('=== ' + new Date().toISOString() + ' ' + kind + ' ===');
  } catch (e) { LOG_FILE = ''; }
}

// 运行时完整性检查清单（缺任何一项都无法启动对应组件）
const REQUIRED_ITEMS = [
  ['napcat/NapCatWinBootMain.exe', 'NapCat 启动器'],
  ['napcat/NapCatWinBootHook.dll', 'NapCat Hook'],
  ['napcat/napcat.mjs', 'NapCat 主程序'],
  ['qq/QQ.exe', 'QQ 运行环境']
];

function existsIn(dir, rel) {
  return !!dir && fs.existsSync(path.join(dir, rel.split('/').join(path.sep)));
}

function missingItems(dir) {
  return REQUIRED_ITEMS.filter(([rel]) => !existsIn(dir, rel)).map(([rel, name]) => ({ rel, name }));
}

function isComplete(dir) {
  return missingItems(dir).length === 0;
}

// 从绿色版内置资源(runtime)把缺失的顶层目录补到用户运行时目录，保证主程序与
// 独立启动器共用同一份 runtime（配置不会分裂）。首次补齐可能要几分钟。
function repairFromBundled(userRt, bundled, note) {
  const missing = missingItems(userRt);
  if (!missing.length) return true;
  if (!bundled || !fs.existsSync(bundled)) {
    note('  内置运行时也不存在：' + (bundled || '(未知)'));
    return false;
  }

  const tops = new Set();
  for (const m of missing) tops.add(m.rel.split('/')[0]);

  for (const top of tops) {
    const src = path.join(bundled, top);
    const dst = path.join(userRt, top);
    if (!fs.existsSync(src)) {
      note('  内置运行时里也没有 "' + top + '"，无法补齐。');
      return false;
    }
    try {
      note('  正在补齐 "' + top + '" …（首次启动需要几分钟，请勿关闭窗口）');
      fs.mkdirSync(userRt, { recursive: true });
      fs.cpSync(src, dst, { recursive: true, force: true });
      note('  已补齐 "' + top + '"');
    } catch (e) {
      note('  补齐 "' + top + '" 失败: ' + (e && e.message ? e.message : String(e)));
      return false;
    }
  }
  return isComplete(userRt);
}

function resolveRuntimePath() {
  const userRt = userData ? path.join(userData, 'runtime') : '';
  const bundled = path.join(resourcesDir, 'runtime');

  // 1) 用户运行时完整 → 直接用（主程序正常安装/运行过的场景）
  if (isComplete(userRt)) return { path: userRt, source: 'user' };

  // 2) 内置运行时完整 → 用它（绿色版刚解压、用户目录还没准备时的场景）
  if (isComplete(bundled)) {
    noteLines.push('用户运行时目录不完整（' + missingItems(userRt).map(m => m.name).join('、') + '）');
    noteLines.push('将使用绿色版自带运行时: ' + bundled);
    return { path: bundled, source: 'bundled' };
  }

  // 3) 用户目录不完整但内置完整 → 尝试补齐用户目录
  if (fs.existsSync(userRt) && fs.existsSync(bundled)) {
    const ok = repairFromBundled(userRt, bundled, (m) => noteLines.push(m));
    if (ok) {
      noteLines.push('用户运行时已补齐: ' + userRt);
      return { path: userRt, source: 'user-repaired' };
    }
  }

  // 4) 用户目录不存在但内置存在 → 整体用内置（不复制，省时间）
  if (fs.existsSync(bundled)) {
    noteLines.push('将使用绿色版自带运行时: ' + bundled);
    return { path: bundled, source: 'bundled' };
  }

  return { path: userRt || bundled, source: 'unknown' };
}

const noteLines = [];

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { return {}; }
}

function savePort(scope, port) {
  try {
    if (!settingsFile || !port) return;
    const s = readSettings();
    if (!s[scope]) s[scope] = {};
    s[scope].port = port;
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {}
}

const resolved = resolveRuntimePath();
const runtimePath = resolved.path;
const settings = readSettings();

if (!runtimePath || missingItems(runtimePath).length) {
  const miss = missingItems(runtimePath);
  fail('[错误] 运行时目录不完整：' + (runtimePath || '(未找到)'));
  fail('  缺少: ' + (miss.length ? miss.map(m => m.name + '（' + m.rel + '）').join('、') : '未知'));
  fail('');
  fail('解决办法（任选其一）：');
  fail('  1) 先双击「启动机器人控制台.bat」运行一次主程序，让它把运行时准备完整；');
  fail('  2) 确认绿色版解压完整（resources\\runtime 目录应约 1.8GB）。');
  process.exit(1);
}

const { ProcessManager } = require(path.join(appDir, 'modules', 'procman.js'));
const network = require(path.join(appDir, 'modules', 'network.js'));

function makeManager() {
  const pm = new ProcessManager();
  pm.send = (channel, payload) => {
    if (channel === 'proc:log' && payload && payload.data) {
      process.stdout.write(payload.data);
      appendLog(payload.data.replace(/\r?\n$/, ''));
    }
  };
  return pm;
}

function pickWebuiPort() {
  const p = parseInt((settings.webui && settings.webui.port) || 0, 10);
  return Number.isFinite(p) && p > 0 ? p : 8899;
}
function pickBotPort() {
  const p = parseInt((settings.bot && settings.bot.port) || 0, 10);
  return Number.isFinite(p) && p > 0 ? p : 18080;
}

// 用系统默认浏览器打开地址
function openBrowser(url) {
  try {
    const { spawn } = require('child_process');
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch (e) { return false; }
}

// 轮询等待 WebUI 真的可访问（NapCat 起来到 WebUI 监听之间有延迟）
// isAlive: 可选，返回 false 时立即判定失败（进程已崩，不必干等）
// 返回: true=就绪 / 'dead'=进程已退出 / false=超时
function waitWebui(port, maxMs, isAlive) {
  const http = require('http');
  const deadline = Date.now() + maxMs;
  const startAt = Date.now();
  let lastLog = 0;

  const probe = () => new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    const req = http.get({ host: '127.0.0.1', port: port, path: '/webui', timeout: 1500 }, (r) => {
      r.resume();
      finish(true);
    });
    req.on('error', () => finish(false));
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(false); });
  });

  return (async () => {
    while (Date.now() < deadline) {
      if (typeof isAlive === 'function' && !isAlive()) return 'dead';
      if (await probe()) return true;
      // 每 5 秒提示一次进度，避免用户以为卡死
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        const secs = Math.round((Date.now() - startAt) / 1000);
        say('  …等待 WebUI 就绪 ' + secs + ' 秒（最长 45 秒）');
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  })();
}

// 启动前清掉本组件自己的旧残留（scope 隔离：napcat 不动 bot，bot 不动 napcat）
function cleanBeforeStart(scope) {
  try {
    const { killRelated } = require(path.join(appDir, 'modules', 'killer.js'));
    const r = killRelated({
      runtimePath: runtimePath,
      pid: process.pid,
      processName: 'electron',
      scope: scope
    });
    if (r.killed && r.killed.length) {
      say('已清理旧进程: ' + r.killed.join(', '));
    }
  } catch (e) {
    say('清理旧进程失败（可忽略）: ' + (e && e.message ? e.message : String(e)));
  }
}

async function startNapcat() {
  initLog('napcat');
  const preferred = pickWebuiPort();
  say('');
  say('========== 机器人控制台 · NapCat 独立启动 ==========');
  say('运行时: ' + runtimePath + '（来源: ' + resolved.source + '）');
  say('日志: ' + (LOG_FILE || '(无法创建日志文件)'));
  for (const line of noteLines) say(line);
  say('首选 WebUI 端口: ' + preferred + '（冲突会自动顺延）');
  say('');

  cleanBeforeStart('napcat');

  const pm = makeManager();
  const r = await pm.startNapcat(runtimePath, { webuiPort: preferred });

  if (!r.ok) {
    fail('');
    fail('[NapCat] 启动失败: ' + (r.error || '未知错误'));
    fail('提示：若提示缺少 QQ 环境，请先运行一次主程序，让它解压运行时。');
    process.exit(1);
  }

  if (r.webuiPortChanged && r.webuiPort) savePort('webui', r.webuiPort);

  say('');
  say('  NapCat 已启动  PID=' + r.pid);
  say('  WebUI 地址: http://127.0.0.1:' + r.webuiPort + '/webui?token=tianlu');
  say('  本窗口保持打开用于显示日志；关闭窗口或 Ctrl+C 即停止 NapCat。');

  // 等 WebUI 真正监听后再开浏览器（NapCat 启动到 WebUI 就绪有几秒延迟）
  const webuiUrl = 'http://127.0.0.1:' + r.webuiPort + '/webui?token=tianlu';
  say('');
  say('  等待 NapCat 把 WebUI 启动起来…');
  const ready = await waitWebui(r.webuiPort, 45000, () => {
    try { return pm.status('napcat').running; } catch (e) { return true; }
  });

  if (ready === true) {
    say('  WebUI 已就绪（端口 ' + r.webuiPort + '）');
    if (!process.env.NC_NO_BROWSER) {
      if (openBrowser(webuiUrl)) say('  已在浏览器中打开 WebUI');
    } else {
      say('  （已设置 NC_NO_BROWSER，跳过自动打开浏览器）');
    }
  } else if (ready === 'dead') {
    say('');
    say('  [失败] NapCat 进程启动后立即退出了。');
    say('  常见原因（按可能性排序）：');
    say('    1. 程序路径含中文/空格/括号 → QQ 注入失败（最常见）');
    say('    2. 还有旧 QQ 进程占着登录态（可先跑 诊断.bat 查看）');
    say('    3. QQ 运行环境不完整');
    say('');
    say('  请把本窗口上面的日志发给开发者。');
  } else {
    say('');
    say('  [失败] 45 秒内 WebUI 仍未就绪（NapCat 可能启动了但 WebUI 起不来）。');
    say('  请把本窗口上面的日志发给开发者。');
  }
  say('');

  const child = pm.procs.napcat;
  if (child) {
    child.on('exit', (code) => {
      say('[NapCat] 进程已退出，code=' + code);
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

async function startBot() {
  initLog('bot');
  const preferred = pickBotPort();
  const py = (settings.bot && settings.bot.pythonPath) || 'python';

  say('');
  say('========== 机器人控制台 · 机器人独立启动 ==========');
  say('运行时: ' + runtimePath + '（来源: ' + resolved.source + '）');
  say('日志: ' + (LOG_FILE || '(无法创建日志文件)'));
  for (const line of noteLines) say(line);
  say('首选 bot 端口: ' + preferred + '（冲突会自动顺延）');
  say('Python: ' + py);
  say('');

  cleanBeforeStart('bot');

  const pm = makeManager();
  const r = await pm.startBot(runtimePath, { port: preferred, pythonPath: py });

  // 给 python 一点启动时间，判断是否真的起来了（例如 python 未安装会立刻失败）
  await new Promise((res) => setTimeout(res, 2500));
  const st = pm.status('bot');

  if (!r.ok || !st.running) {
    fail('');
    fail('[Bot] 启动失败' + (r.error ? ': ' + r.error : '（Python 可能未安装或路径不对）'));
    fail('提示：可在主程序「设置」里点「一键安装 Python」，或把 settings.json 的 bot.pythonPath 指向 python.exe。');
    process.exit(1);
  }

  if (r.botPortChanged && r.botPort) {
    savePort('bot', r.botPort);
    // 端口变了 → 保证 NapCat 的反向 WS 指向新端口
    try {
      network.applyNetworkConfig(runtimePath, {
        webuiPort: pickWebuiPort(), webuiHost: '127.0.0.1',
        botPort: r.botPort, botHost: '127.0.0.1'
      });
    } catch (e) {}
  }

  say('');
  say('  机器人已启动  PID=' + r.pid);
  say('  监听: ws://127.0.0.1:' + r.botPort + '/onebot/v11/ws');
  say('  本窗口保持打开用于显示日志；关闭窗口或 Ctrl+C 即停止机器人。');
  say('');

  const child = pm.procs.bot;
  if (child) {
    child.on('exit', (code) => {
      say('[Bot] 进程已退出，code=' + code);
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

const target = (process.argv[2] || '').toLowerCase();
(async () => {
  try {
    if (target === 'napcat') await startNapcat();
    else if (target === 'bot') await startBot();
    else {
      fail('用法: electron.exe modules/standalone.js <napcat|bot>');
      process.exit(2);
    }
  } catch (e) {
    fail('[standalone] 异常: ' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
})();

// Ctrl+C 时顺带停掉子进程
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => { process.exit(0); });
});
