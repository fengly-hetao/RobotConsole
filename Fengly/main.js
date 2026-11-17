'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, Tray, nativeImage } = require('electron');

// =====================================================================
// ★★★ GPU 彻底禁用（必须在最早期，用 appendArgument 硬编码命令行参数）★★★
// 向日葵(Oray)/AskLink 虚拟显卡驱动与 Electron 28 GPU 进程冲突，导致
// GPU 进程崩溃 → 渲染帧销毁 → 白屏。这里用最底层的方式强制禁用 GPU。
// =====================================================================
try {
  app.disableHardwareAcceleration();
  app.commandLine.appendArgument('--disable-gpu');
  app.commandLine.appendArgument('--disable-gpu-compositing');
  app.commandLine.appendArgument('--use-angle=swiftshader');
  app.commandLine.appendArgument('--use-gl=swiftshader');
} catch (_e) {}

// =====================================================================
// 单实例锁：程序只能运行一个实例。
// 第二次启动时聚焦到已有窗口，避免双实例冲突、splash 卡「升级完成」。
// =====================================================================
const _gotSingleLock = app.requestSingleInstanceLock();
if (!_gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 已有实例收到第二次启动请求时，聚焦主窗口
    if (app.hasSingleInstanceLock()) {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length) {
        const w = wins[0];
        if (w.isMinimized()) w.restore();
        w.focus();
      }
    }
  });
}

// =====================================================================
// 渲染初始化（Electron 28 · Win10 1809+ 兼容）
// GPU 禁用已在文件最顶部完成（appendArgument 硬编码），这里只保留
// 后台窗口不降级渲染等通用开关。
// =====================================================================
{
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const { Store } = require('./modules/store');
const runtime = require('./modules/runtime');
const { ProcessManager } = require('./modules/procman');
const python = require('./modules/python');
const network = require('./modules/network');
const sysinfo = require('./modules/sysinfo');
const updater = require('./modules/updater');
const groupupdate = require('./modules/groupupdate');
const envfile = require('./modules/envfile');

const BILIBILI = 'https://space.bilibili.com/3706994888280144?spm_id_from=333.1007.0.0';
const APP_INFO = {
  name: '机器人控制台',
  nameEn: 'Robot Console',
  version: '1.0.0',
  bilibili: BILIBILI
};

// =====================================================================
// 文件日志：把控制台输出同时写入 %APPDATA%\robot-bot-console\logs\main-*.log
// 出问题时用户可直接把日志发出来定位（不用依赖窗口里滚动的文字）
// =====================================================================
const LOG_DIR = path.join(process.env.APPDATA || '', 'robot-bot-console', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main-' + new Date().toISOString().slice(0, 10) + '.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_e) {}

function _writeLog(level, args) {
  try {
    const text = args.map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_e) { return String(a); }
    }).join(' ');
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] [' + level + '] ' + text + '\n', 'utf8');
  } catch (_e) {}
}

const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
console.log = function (...args) { _origLog(...args); _writeLog('INFO', args); };
console.error = function (...args) { _origErr(...args); _writeLog('ERROR', args); };
console.log('[main] 日志文件: ' + LOG_FILE);

// 单实例锁
console.log('[main] electron starting, version=', process.versions.electron);
const gotLock = app.requestSingleInstanceLock();
console.log('[main] single instance lock =', gotLock);
if (!gotLock) {
  console.log('[main] another instance exists, quitting');
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  let mainWindow = null;
  let splashWindow = null;
  let store = null;
  let procman = null;
  let server = null;
  let serverPort = 0;
  let runtimePath = '';
  const termSessions = new Map(); // id -> child
  const pickedFiles = new Set(); // 用户通过文件对话框明确选择的文件（唯一允许外部写入的白名单）
  let crashInfo = null;
  let quitting = false;
  let tray = null;

  // ---------- 静态文件服务器（渲染层） ----------
  function startServer(rendererDir) {
    const mime = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
      '.map': 'application/json', '.wasm': 'application/wasm'
    };
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/media/')) {
        try {
          const seg = decodeURIComponent(req.url.split('?')[0]).split('/').filter(Boolean);
          const kind = seg[1];
          const name = path.basename(seg.slice(2).join('/'));
          const base = kind === 'tts' ? path.join(runtimePath, 'tianlu_bot', 'data', 'tts_cache') : kind === 'music' ? path.join(runtimePath, 'tianlu_bot', 'data', 'music_cache') : null;
          if (base && name) {
            const fp = path.join(base, name);
            if (fp.startsWith(base) && fs.existsSync(fp)) {
              res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
              fs.createReadStream(fp).pipe(res);
              return;
            }
          }
        } catch (e) {}
        res.writeHead(404); res.end(); return;
      }
      if (req.url.startsWith('/wallpaper.jpg')) {
        const wp = path.join(app.getPath('userData'), 'wallpaper.jpg');
        if (fs.existsSync(wp)) {
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
          fs.createReadStream(wp).pipe(res);
          return;
        }
        res.writeHead(404); res.end(); return;
      }
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const full = path.join(rendererDir, path.normalize(urlPath).replace(/^([/\\])+/, ''));
        if (!full.startsWith(rendererDir)) { res.writeHead(403); res.end('forbidden'); return; }
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(full).pipe(res);
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { serverPort = server.address().port; resolve(serverPort); }));
  }

  // ---------- 原子写入（避免 JSON/配置损坏） ----------
  function writeFileAtomic(p, content) {
    const tmp = p + '.tmp-' + Date.now();
    fs.writeFileSync(tmp, content, 'utf8');
    try { fs.renameSync(tmp, p); }
    catch (e) { fs.copyFileSync(tmp, p); try { fs.unlinkSync(tmp); } catch (e2) {} }
  }

  // ---------- 缓存与日志清理（启动时执行，磁盘只减不增） ----------
  function cleanupRuntime(rt) {
    try {
      const now = Date.now();
      const days = (n) => n * 864e5;
      for (const logDir of [path.join(rt, 'napcat', 'logs'), path.join(rt, 'tianlu_bot', 'logs')]) {
        try {
          for (const f of fs.readdirSync(logDir)) {
            const p = path.join(logDir, f);
            try { if (now - fs.statSync(p).mtimeMs > days(7)) fs.unlinkSync(p); } catch (e) {}
          }
        } catch (e) {}
      }
      for (const cacheDir of [path.join(rt, 'tianlu_bot', 'data', 'tts_cache'), path.join(rt, 'tianlu_bot', 'data', 'music_cache'), path.join(rt, 'tianlu_bot', 'data', 'voice_ref')]) {
        try {
          for (const f of fs.readdirSync(cacheDir)) {
            const p = path.join(cacheDir, f);
            try { if (now - fs.statSync(p).mtimeMs > days(3)) fs.unlinkSync(p); } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // ---------- 桌面快捷方式（启动时没有就自动创建） ----------
    function ensureDesktopShortcut() {
    try {
      const os = require('os');
      const desktop = path.join(os.homedir(), 'Desktop');
      const lnk = path.join(desktop, '机器人控制台.lnk');
      if (fs.existsSync(lnk)) return;
      const exe = process.execPath;
      // 关键：必须把 app 目录作为参数传进去。
      // 绿色版主程序是 electron.exe，若只给 exe 而不给 app 参数，
      // Electron 会走默认 resources/app 加载路径，在虚拟显卡环境会白屏。
      const appDir = __dirname;
      const iconPath = path.join(appDir, 'renderer', 'icon.png');
      const q = (s) => '"' + String(s).replace(/\\/g, '\\\\') + '"';
      const vbs = [
        'Set ws = CreateObject("WScript.Shell")',
        'Set s = ws.CreateShortcut(' + q(lnk) + ')',
        's.TargetPath = ' + q(exe),
        's.Arguments = ' + q('"' + appDir + '"'),
        's.WorkingDirectory = ' + q(appDir),
        's.IconLocation = ' + q(fs.existsSync(iconPath) ? iconPath : (exe + ',0')),
        's.Description = "机器人控制台"',
        's.Save'
      ].join('\r\n');
      const vbsPath = path.join(os.tmpdir(), 'rc-desktop-shortcut.vbs');
      fs.writeFileSync(vbsPath, '\uFEFF' + vbs, 'utf16le');
      const { spawnSync } = require('child_process');
      spawnSync('wscript', ['//nologo', vbsPath], { windowsHide: true, stdio: 'ignore', timeout: 20000 });
      try { fs.unlinkSync(vbsPath); } catch (e) {}
      if (!fs.existsSync(lnk)) {
        try { fs.appendFileSync(path.join(app.getPath('userData'), 'shortcut.log'), new Date().toISOString() + ' create failed\n'); } catch (e) {}
      }
    } catch (e) { console.error('[shortcut] create failed', e); }
  }

  // ---------- 安装代码签名证书到用户信任列表（一次） ----------
  function installTrustCert() {
    try {
      if (store.get('certInstalled')) return;
      const cer = path.join(process.resourcesPath, 'codesign.cer');
      if (!fs.existsSync(cer)) return;
      const { spawnSync } = require('child_process');
      const run = (storeName) => {
        const r = spawnSync('certutil', ['-user', '-addstore', '-f', storeName, cer], { windowsHide: true, stdio: 'ignore', timeout: 20000 });
        return r.status === 0;
      };
      const okRoot = run('Root');
      const okPub = run('TrustedPublisher');
      if (okRoot || okPub) store.set('certInstalled', true);
      console.log('[cert] install result:', okRoot, okPub);
    } catch (e) { console.error('[cert] install failed', e); }
  }

  // ---------- 更新检查（bootstrap 顶层作用域，定时器可直接调用） ----------
  // 可靠获取当前版本号：读 asar 内主 package.json（排到 app.getVersion 可能读错依赖版本的问题）
  function currentAppVersion() {
    try {
      // 直接读打包进来的主 package.json（asar 内 /package.json 就是应用的）
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      const v = pkg && pkg.version;
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
      if (m) return String(m[0]);
    } catch (e) {}
    // 回退：app.getVersion
    try {
      const v2 = app.getVersion();
      const m2 = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v2 || ''));
      if (m2) return String(m2[0]);
    } catch (e2) {}
    return '1.0.0';
  }
  async function runUpdateCheck(manual) {
    const feed = store.get('updateUrl') || '';
    const groupId = store.get('updateGroupId') || '';
    let info = null;
    let source = 'url';
    let groupError = '';
    // ① 优先：QQ 群文件里的 update.json（你发群就生效，不用碰网盘）
    if (groupId) {
      try {
        const gr = await groupupdate.fetchUpdateFromGroup(groupId, {
          host: store.get('bot').host || '127.0.0.1',
          port: store.get('napcatApiPort') || 16200,
          token: store.get('bot').token || ''
        });
        if (gr.ok && gr.data && gr.data.version) {
          const latest = String(gr.data.version || '');
          const hasUpdate = updater.compareVersions(latest, currentAppVersion()) > 0;
          info = { hasUpdate, latest, url: String(gr.data.url || ''), notes: String(gr.data.notes || ''), force: !!gr.data.force };
          source = 'qqgroup';
        } else {
          // 之前这里把错误完全吞掉了，界面上只显示"无更新"，用户无从判断原因
          groupError = gr.error || '群文件里没有可用的 update.json';
          console.log('[update] Q群更新失败: ' + groupError);
        }
      } catch (e) {
        groupError = e.message;
        console.log('[update] 群文件读取异常:', e.message);
      }
    }
    // ② 回退：网盘 update.json
    if (!info && feed) {
      info = await updater.checkUpdate(feed, currentAppVersion());
      source = 'url';
    }
    if (!info) {
      info = { hasUpdate: false, disabled: !feed && !groupId };
      // 两个源都没有结果时，把 Q 群的失败原因暴露给界面
      if (groupId && groupError) info.error = groupError;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:status', { checking: false, manual, hasUpdate: !!(info && info.hasUpdate), latest: info && info.latest, url: info && info.url, notes: info && info.notes, error: info && info.error, disabled: info && info.disabled, current: currentAppVersion(), source });
    }
    return { hasUpdate: !!(info && info.hasUpdate), latest: info && info.latest, url: info && info.url, notes: info && info.notes, error: info && info.error, current: currentAppVersion(), source };
  }

  // ---------- 读取文档（自动识别 UTF-8 / GBK） ----------
  function readTextSmart(p) {
    try {
      const buf = fs.readFileSync(p);
      let s = buf.toString('utf8');
      if (!s.includes('\uFFFD')) return s;
      try { return new TextDecoder('gbk').decode(buf); } catch (e) { return s; }
    } catch (e) { return ''; }
  }

  function collectAboutData() {
    const updates = [];
    const dir = path.join(runtimePath, '更新说明');
    try {
      for (const f of fs.readdirSync(dir).sort()) {
        if (f.endsWith('.txt')) updates.push({ file: f, text: readTextSmart(path.join(dir, f)) });
      }
    } catch (e) {}
    const credits = [
      { name: 'NapCat', desc: 'QQ NT 无头机器人框架' },
      { name: 'NoneBot2', desc: 'Python 机器人框架' },
      { name: '臻煞', desc: '机器人作者 · 项目发起与维护' },
      
      { name: '所有使用与反馈的用户', desc: '感谢每一份支持' }
    ];
    return { app: APP_INFO, credits, updates, bilibili: BILIBILI };
  }


  // ---------- 系统托盘 ----------
  function createTray() {
    try {
      const iconPath = path.join(__dirname, 'renderer', 'icon.png');
      let img = nativeImage.createFromPath(iconPath);
      if (img.isEmpty()) img = nativeImage.createEmpty();
      tray = new Tray(img.resize({ width: 16, height: 16 }));
      tray.setToolTip('机器人控制台');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示主界面', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { type: 'separator' },
        { label: '退出程序', click: () => { quitting = true; app.quit(); } }
      ]));
      tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    } catch (e) { console.error('[tray] failed', e); }
  }

  // ---------- 崩溃处理 ----------
  function handleCrash(err) {
    const msg = err && err.stack ? err.stack : String(err);
    crashInfo = { time: new Date().toISOString(), message: msg };
    try {
      fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `[${crashInfo.time}]\n${msg}\n\n`, 'utf8');
    } catch (e) {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('crash', crashInfo);
    } else {
      dialog.showErrorBox('程序崩溃', '发生了一个错误。请将以下信息复制并喂给 AI 分析：\n\n' + msg);
    }
  }
  process.on('uncaughtException', handleCrash);
  process.on('unhandledRejection', (r) => handleCrash(r && r.stack ? r : r));

  // ---------- 终端（管道式 cmd） ----------
  function termCreate() {
    const { spawn } = require('child_process');
    const id = crypto.randomBytes(4).toString('hex');
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/q', '/k', 'chcp 65001 >nul'], { cwd: runtimePath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const push = (data) => { if (mainWindow) mainWindow.webContents.send('term:data', { session: id, data: data.toString('utf8') }); };
    child.on('error', (e) => { push('\n[终端启动失败: ' + e.message + ']\n'); });
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('exit', () => { if (mainWindow) mainWindow.webContents.send('term:data', { session: id, data: '\n[进程已退出]\n' }); termSessions.delete(id); });
    termSessions.set(id, child);
    return id;
  }

  // ---------- IPC ----------
  function registerIpc() {
    ipcMain.handle('app:info', () => ({ ...APP_INFO, runtimePath, bundledPath: runtime.getBundledPath() }));

    ipcMain.handle('runtime:ensure', async () => {
      const p = runtime.ensureRuntime((msg) => { if (splashWindow) splashWindow.webContents.send('progress', msg); });
      runtimePath = p;
      return { ok: true, runtimePath };
    });

    ipcMain.handle('runtime:health', () => runtime.healthCheck());
    ipcMain.handle('runtime:listFiles', (e, relDir) => runtime.listRuntimeFiles(relDir));
    ipcMain.handle('runtime:openFolder', () => {
      try {
        shell.openPath(runtimePath).catch(err => console.error('[main] openPath failed:', err.message));
      } catch (err) { console.error('[main] openPath threw:', err.message); }
      return true;
    });

    ipcMain.handle('file:read', (e, rel) => {
      const p = path.join(runtimePath, rel);
      if (!p.startsWith(runtimePath)) throw new Error('forbidden');
      return readTextSmart(p);
    });
    ipcMain.handle('file:write', (e, rel, content) => {
      const p = path.join(runtimePath, rel);
      if (!p.startsWith(runtimePath)) throw new Error('forbidden');
      fs.writeFileSync(p, content, 'utf8');
      return { ok: true };
    });

    ipcMain.handle('env:read', (e, rel) => envfile.readEnvFile(path.join(runtimePath, rel)));
    ipcMain.handle('env:write', (e, rel, entries) => { envfile.updateEnv(path.join(runtimePath, rel), entries); return { ok: true }; });

    // ---------- API 用量/余额查询 ----------
    const usage = require('./modules/usage');
    ipcMain.handle('usage:query', async (e, kind) => {
      try {
        // 从 .env 读对应密钥
        const lines = envfile.readEnvFile(path.join(runtimePath, 'tianlu_bot', '.env'));
        const getVal = (key) => { const l = lines.find(x => x.type === 'key' && x.key === key); return l ? l.value : ''; };
        let apiKey = '';
        if (kind === 'deepseek') apiKey = getVal('DEEPSEEK_API_KEY');
        else if (kind === 'zhipu') apiKey = getVal('ZHIPU_API_KEY');
        else if (kind === 'minimax') apiKey = getVal('MINIMAX_API_KEY');
        return await usage.queryUsage(kind, apiKey);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    ipcMain.handle('proc:status', () => procman.allStatus());
    ipcMain.handle('proc:startNapcat', async (e, opts) => {
      const o = Object.assign({}, opts || store.get('memory'));
      // 首选端口用 settings 里记住的值；procman 会真实探测并在冲突时自动顺延
      o.webuiPort = store.get('webui').port;
      const r = await procman.startNapcat(runtimePath, o);
      // 端口被自动切换 → 回写 settings，下次优先用新端口（并让 UI 立即感知）
      if (r && r.ok && r.webuiPortChanged && r.webuiPort) {
        const w = store.get('webui');
        w.port = r.webuiPort;
        store.set('webui', w);
        console.log('[main] WebUI 端口已更新为 ' + r.webuiPort);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('webui:portChanged', { port: r.webuiPort });
        }
      }
      return r;
    });
    ipcMain.handle('proc:stopNapcat', () => procman.stopNapcat());
    ipcMain.handle('proc:startBot', async (e, opts) => {
      const o = opts || {};
      const sendLog = (msg) => { if (mainWindow) mainWindow.webContents.send('python:log', msg); };
      // 自动检测 Python：没有 → 静默安装内置 Python → 装库（全自动）
      let py = python.detectPython();
      if (!py) {
        sendLog('[自动] 未检测到 Python，开始安装内置 Python 3.10.11…\n');
        const r = await python.setupPython(runtimePath, sendLog);
        if (!r.ok || !r.path) { return { ok: false, error: 'Python 安装失败，请到设置页点「一键安装」重试：' + (r.path || '') }; }
        py = { path: r.path };
        const s = store.get('bot'); s.pythonPath = r.path; store.set('bot', s);
      }
      // 依赖库检测：nonebot 没装 → 自动 pip 安装
      try {
        const { execSync } = require('child_process');
        execSync('"' + py.path + '" -c "import nonebot"', { stdio: 'ignore', windowsHide: true, timeout: 30000 });
      } catch (e) {
        sendLog('[自动] 检测到依赖库缺失，开始安装机器人依赖（约 1-3 分钟）…\n');
        const r = await python.setupPython(runtimePath, sendLog);
        if (!r.ok) { return { ok: false, error: '依赖安装失败，请到设置页点「一键安装」重试' }; }
        const s = store.get('bot'); s.pythonPath = r.path; store.set('bot', s);
      }
      o.pythonPath = o.pythonPath || store.get('bot').pythonPath || py.path || 'python';
      // 首选端口用 settings 里记住的值；procman 会真实探测并在冲突时自动顺延
      o.port = o.port || store.get('bot').port;
      const rb = await procman.startBot(runtimePath, o);
      if (rb && rb.ok && rb.botPortChanged && rb.botPort) {
        const bs = store.get('bot');
        bs.port = rb.botPort;
        store.set('bot', bs);
        console.log('[main] bot 端口已更新为 ' + rb.botPort);
      }
      return rb;
    });
    ipcMain.handle('proc:stopBot', () => procman.stopBot());

    ipcMain.handle('python:detect', () => python.detectPython());
    ipcMain.handle('python:setup', async () => {
      const r = await python.setupPython(runtimePath, (msg) => { if (mainWindow) mainWindow.webContents.send('python:log', msg); });
      if (r.path) { const s = store.get('bot'); s.pythonPath = r.path; store.set('bot', s); }
      return r;
    });

    ipcMain.handle('network:read', () => network.readNetworkConfig(runtimePath));
    ipcMain.handle('network:apply', (e, cfg) => {
      // 补上 OneBot HTTP API 端口（Q群更新要主动调 NapCat API）
      const merged = Object.assign({}, cfg || {}, {
        napcatApiPort: (cfg && cfg.napcatApiPort) || store.get('napcatApiPort') || 16200
      });
      if (cfg && cfg.napcatApiPort) store.set('napcatApiPort', parseInt(cfg.napcatApiPort, 10) || 16200);
      const results = network.applyNetworkConfig(runtimePath, merged);
      const s = store.get('network'); if (cfg && cfg.proxy !== undefined) s.proxy = cfg.proxy; store.set('network', s);
      return results;
    });

    ipcMain.handle('sys:info', () => sysinfo.sample());

    ipcMain.handle('term:create', () => termCreate());
    ipcMain.handle('term:write', (e, id, data) => {
      const c = termSessions.get(id);
      if (c) {
        // cmd 需要 \r\n 才执行命令，xterm 只发 \r，这里补全
        c.stdin.write(String(data).replace(/\r(?!\n)/g, '\r\n'));
      }
      return true;
    });
    ipcMain.handle('term:resize', () => true);
    ipcMain.handle('term:kill', (e, id) => { const c = termSessions.get(id); if (c) { try { c.kill(); } catch (err) {} termSessions.delete(id); } return true; });

    ipcMain.handle('settings:get', () => store.get());
    ipcMain.handle('settings:set', (e, obj) => store.merge(obj));
    ipcMain.handle('settings:reset', () => store.reset());

    ipcMain.handle('dialog:pickFile', async () => {
      const r = await dialog.showOpenDialog({ properties: ['openFile'] });
      if (r.canceled) return null;
      pickedFiles.add(r.filePaths[0]); // 用户明确选择才可写
      return { path: r.filePaths[0], content: readTextSmart(r.filePaths[0]) };
    });
    // 移除 file:readAny（任意读后门）；写入仅允许用户对话框选择过的文件
    ipcMain.handle('file:writePicked', (e, p, content) => {
      if (!pickedFiles.has(p)) return { ok: false, error: '该文件未经过用户选择，拒绝写入' };
      writeFileAtomic(p, content);
      return { ok: true };
    });

    ipcMain.handle('shell:open', (e, url) => {
      const u = String(url || '');
      if (/^https?:\/\//i.test(u)) {
        try {
          shell.openExternal(u).catch(err => console.error('[main] openExternal failed:', err.message));
        } catch (err) {
          console.error('[main] openExternal threw:', err.message);
          return { ok: false, error: '没有可用的浏览器（0x800401F5），请手动复制链接打开' };
        }
      }
      return { ok: true };
    });

    // ---------- 内置工具启动（网易云下载器等） ----------
    ipcMain.handle('tool:launch', (e, toolName) => {
      const name = String(toolName || '');
      let exe = '';
      if (name === 'netease-downloader' || name === 'music-downloader') {
        exe = path.join(runtimePath, 'tools', '网易云MP3下载器.exe');
      }
      if (!exe) return { ok: false, error: '未知工具' };
      try {
        if (!fs.existsSync(exe)) return { ok: false, error: '工具文件缺失，请重新安装' };
        // 用 shell.openPath 独立启动，不阻塞、不随应用退出
        const { spawn } = require('child_process');
        spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    ipcMain.handle('about:data', () => collectAboutData());
    ipcMain.handle('crash:last', () => crashInfo);
    ipcMain.handle('update:check', async () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', { checking: true, manual: true });
      return runUpdateCheck(true);
    });
    // ---------- 更新下载 + 安装 ----------
    ipcMain.handle('update:download', async (e, dlUrl) => {
      const send = (p) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', p); };
      try {
        const dlDir = path.join(app.getPath('temp'), 'RobotConsole-update');
        fs.mkdirSync(dlDir, { recursive: true });
        send({ stage: 'download', percent: 0, text: '正在下载更新包…' });
        const r = await updater.downloadUpdate(dlUrl, dlDir, (size) => {
          send({ stage: 'download', percent: 100, text: '下载完成（' + (size / 1024 / 1024).toFixed(1) + ' MB）' });
        });
        let setupPath = r.path;
        // 如果是 zip，自动解压出 exe
        if (/\.zip(\.bak)?$/i.test(r.path)) {
          send({ stage: 'extract', text: '正在解压…' });
          setupPath = updater.extractSetup(r.path, dlDir);
        }
        // 修正 .bak 后缀（123 云盘会给 exe 加 .bak）
        if (/\.bak$/i.test(setupPath)) {
          const fixed = setupPath.replace(/\.bak$/i, '');
          try { fs.renameSync(setupPath, fixed); setupPath = fixed; } catch (e) {}
        }
        if (!/\.exe$/i.test(setupPath)) return { ok: false, error: '下载的文件不是安装包（' + path.basename(setupPath) + '）' };
        // PE 头校验：防止下载到 HTML 错误页
        if (!updater.isExecutable(setupPath)) {
          return { ok: false, error: '下载的文件不是有效的安装程序（可能被网盘拦截），请改用「打开下载页」手动下载' };
        }
        send({ stage: 'ready', text: '下载完成，正在自动安装…' });
        // 静默安装（/S）+ 安装完自动重启程序，用户不用手动操作
        const { spawn } = require('child_process');
        try {
          spawn(setupPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        } catch (e2) {
          // 静默失败就退回到普通安装（会弹界面）
          spawn(setupPath, [], { detached: true, stdio: 'ignore' }).unref();
        }
        // 3 秒后退出当前程序，让安装程序接管（避免文件占用导致安装失败）
        setTimeout(() => {
          try {
            if (procman) { try { procman.stopNapcat(); } catch (e3) {} try { procman.stopBot(); } catch (e3) {} }
          } catch (e3) {}
          setTimeout(() => { try { app.exit(0); } catch (e3) {} }, 1200);
        }, 3000);
        return { ok: true, path: setupPath, autoInstall: true };
      } catch (err) {
        send({ stage: 'error', text: '下载失败：' + err.message });
        return { ok: false, error: err.message };
      }
    });
    ipcMain.handle('update:openPage', (e, url) => {
      if (/^https?:\/\//i.test(String(url || ''))) {
        try { shell.openExternal(String(url)); } catch (err) {}
      }
      return true;
    });

    ipcMain.handle('win:toggleFullscreen', () => {
      if (mainWindow) { mainWindow.setFullScreen(!mainWindow.isFullScreen()); return mainWindow.isFullScreen(); }
      return false;
    });
    // ---------- 代码备份 / 恢复 ----------
    function walkDir(dir, rel, zip, sub) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['logs', 'cache', '__pycache__', 'music_cache', 'tts_cache', 'voice_ref', 'images', 'backups', 'archive'].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        const r = path.join(rel, e.name);
        if (e.isDirectory()) walkDir(full, r, zip, sub);
        else zip.addLocalFile(full, path.join(sub, r));
      }
    }
    // ---------- 一键修复代码 ----------
    ipcMain.handle('code:repair', async () => {
      const { spawnSync } = require('child_process');
      const srcTb = path.join(__dirname, '..', 'runtime', 'tianlu_bot'); // 内置模板
      const dstTb = path.join(runtimePath, 'tianlu_bot');               // 用户当前代码
      const report = { backup: '', checked: 0, fixed: [], failed: [] };
      // 1) 修复前备份（永远先备份）
      try {
        const bk = path.join(runtimePath, 'backups', 'repair-' + Date.now());
        fs.mkdirSync(path.join(bk, 'tianlu_bot'), { recursive: true });
        fs.cpSync(dstTb, path.join(bk, 'tianlu_bot'), { recursive: true, force: true });
        report.backup = bk;
      } catch (e) { report.failed.push('备份失败: ' + e.message); }
      // 2) JSON 损坏检查与恢复
      const jsonFiles = ['data/qq.json', 'plugins/games/games.json'];
      for (const rel of jsonFiles) {
        report.checked++;
        const dst = path.join(dstTb, rel);
        const src = path.join(srcTb, rel);
        try {
          JSON.parse(fs.readFileSync(dst, 'utf8'));
        } catch (e) {
          try { fs.copyFileSync(src, dst); report.fixed.push('恢复损坏的 JSON: ' + rel); }
          catch (e2) { report.failed.push('恢复失败: ' + rel + ' — ' + e2.message); }
        }
      }
      // 3) Python 语法检查：坏文件从内置模板恢复
      const py = python.detectPython();
      if (py && py.path) {
        const walk = (dir, base) => {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.name === '__pycache__') continue;
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(p, base);
            else if (ent.name.endsWith('.py')) {
              const rel = path.relative(base, p).split(path.sep).join('/');
              report.checked++;
              const r = spawnSync(py.path, ['-m', 'py_compile', p], { windowsHide: true, timeout: 30000 });
              if (r.status !== 0) {
                try { fs.copyFileSync(path.join(srcTb, rel), p); report.fixed.push('语法错误已修复（恢复默认）: ' + rel); }
                catch (e) { report.failed.push('无法恢复: ' + rel); }
              }
            }
          }
        };
        const pluginsDir = path.join(dstTb, 'plugins');
        if (fs.existsSync(pluginsDir)) walk(pluginsDir, dstTb);
        report.checked++;
        const botPy = path.join(dstTb, 'bot.py');
        if (fs.existsSync(botPy)) {
          const r = spawnSync(py.path, ['-m', 'py_compile', botPy], { windowsHide: true, timeout: 30000 });
          if (r.status !== 0) { try { fs.copyFileSync(path.join(srcTb, 'bot.py'), botPy); report.fixed.push('bot.py 语法错误已恢复默认'); } catch (e) { report.failed.push('bot.py 无法恢复'); } }
        }
      } else { report.failed.push('未检测到 Python，跳过语法检查（其余项照常修复）'); }
      // 4) .env 关键键补齐（缺啥补啥，不动已填的值）
      try {
        const reqKeys = ['DEEPSEEK_API_KEY', 'ZHIPU_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_VOICE_ID', 'OWNER_ID', 'BOT_QQ', 'GROUP_ID', 'FEEDBACK_GROUP_ID', 'NETEASE_COOKIE'];
        const dstEnv = path.join(dstTb, '.env');
        const srcEnv = path.join(srcTb, '.env');
        let dst = fs.readFileSync(dstEnv, 'utf8');
        const src = fs.readFileSync(srcEnv, 'utf8');
        const appended = [];
        for (const k of reqKeys) {
          if (!new RegExp('^' + k + '=', 'm').test(dst)) {
            const sm = new RegExp('^' + k + '=.*$', 'm').exec(src);
            if (sm) { dst += '\\n' + sm[0]; appended.push(k); }
          }
        }
        if (appended.length) { fs.writeFileSync(dstEnv, dst, 'utf8'); report.fixed.push('.env 补齐缺失配置项: ' + appended.join(', ')); }
        report.checked++;
      } catch (e) { report.failed.push('.env 检查失败: ' + e.message); }
      // 5) 功能开关文件缺失键补齐
      try {
        const dstFe = path.join(dstTb, 'ai_data', '00_features.env');
        const srcFe = path.join(srcTb, 'ai_data', '00_features.env');
        if (fs.existsSync(srcFe)) {
          let d = fs.existsSync(dstFe) ? fs.readFileSync(dstFe, 'utf8') : '';
          const s = fs.readFileSync(srcFe, 'utf8');
          const sKeys = [...s.matchAll(/^(FEATURE_\\w+)=/gm)].map(x => x[1]);
          const added = [];
          for (const k of sKeys) {
            if (!new RegExp('^' + k + '=', 'm').test(d)) {
              const sm = new RegExp('^' + k + '=.*$', 'm').exec(s);
              if (sm) { d += '\\n' + sm[0]; added.push(k); }
            }
          }
          if (added.length) {
            fs.mkdirSync(path.dirname(dstFe), { recursive: true });
            fs.writeFileSync(dstFe, d, 'utf8');
            report.fixed.push('功能开关补齐: ' + added.join(', '));
          }
          report.checked++;
        }
      } catch (e) { report.failed.push('功能开关检查失败: ' + e.message); }
      // 6) 状态文件损坏重置
      for (const rel of ['data/feedback_store.json', 'data/pending_feedback.json']) {
        const p = path.join(dstTb, rel);
        if (fs.existsSync(p)) {
          try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
            fs.writeFileSync(p, '[]', 'utf8');
            report.fixed.push('重置损坏的状态文件: ' + rel);
          }
          report.checked++;
        }
      }
      return report;
    });

    ipcMain.handle('code:export', async () => {
      const r = await dialog.showSaveDialog({ defaultPath: '机器人代码备份.zip', filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      try {
        const zip = new AdmZip();
        walkDir(path.join(runtimePath, 'napcat'), '', zip, 'napcat');
        walkDir(path.join(runtimePath, 'tianlu_bot'), '', zip, 'tianlu_bot');
        zip.writeZip(r.filePath);
        return { ok: true, path: r.filePath };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    function backupCurrent() {
      const bk = path.join(runtimePath, 'backups', 'code-' + Date.now());
      fs.mkdirSync(bk, { recursive: true });
      fs.cpSync(path.join(runtimePath, 'napcat'), path.join(bk, 'napcat'), { recursive: true, force: true });
      fs.cpSync(path.join(runtimePath, 'tianlu_bot'), path.join(bk, 'tianlu_bot'), { recursive: true, force: true });
      return bk;
    }
    ipcMain.handle('code:import', async () => {
      const r = await dialog.showOpenDialog({ filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      try {
        const bk = backupCurrent();
        const zip = new AdmZip(r.filePaths[0]);
        zip.extractAllTo(runtimePath, true);
        return { ok: true, backup: bk };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('code:restore', async () => {
      try {
        const src = runtime.getBundledPath();
        const bk = backupCurrent();
        fs.cpSync(path.join(src, 'napcat'), path.join(runtimePath, 'napcat'), { recursive: true, force: true });
        fs.cpSync(path.join(src, 'tianlu_bot'), path.join(runtimePath, 'tianlu_bot'), { recursive: true, force: true });
        runtime.ensureWebuiToken(runtimePath);
        return { ok: true, backup: bk };
      } catch (e) { return { ok: false, error: e.message }; }
    });

    // ---------- 小游戏清单（games.json，带热缓存） ----------
    let _gamesCache = null;
    ipcMain.handle('games:list', () => {
      try {
        const p = path.join(runtimePath, 'tianlu_bot', 'plugins', 'games', 'games.json');
        const st = fs.statSync(p);
        if (!_gamesCache || _gamesCache.mtime !== st.mtimeMs) {
          _gamesCache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
        }
        return _gamesCache.data;
      } catch (e) { return []; }
    });

    // ---------- 备份中心 ----------
    function listBackupDirs() {
      const base = path.join(runtimePath, 'backups');
      if (!fs.existsSync(base)) return [];
      return fs.readdirSync(base).filter(n => fs.statSync(path.join(base, n)).isDirectory()).map(n => {
        const p = path.join(base, n);
        const files = [];
        const walk = (d, rel) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name.endsWith('.tmp')) continue;
            const full = path.join(d, e.name);
            const r = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) walk(full, r);
            else files.push(r);
          }
        };
        try { walk(p, ''); } catch (e) {}
        return { id: n, time: fs.statSync(p).mtimeMs, files };
      }).sort((a, b) => b.time - a.time).slice(0, 30);
    }
    ipcMain.handle('backup:list', () => listBackupDirs());
    ipcMain.handle('backup:read', (e, id, file) => {
      const p = path.join(runtimePath, 'backups', String(id), String(file));
      if (!p.startsWith(path.join(runtimePath, 'backups'))) return '';
      try { return readTextSmart(p); } catch (e) { return ''; }
    });
    ipcMain.handle('backup:apply', (e, id, file) => {
      // 把备份文件恢复到运行时（恢复前先备份当前）
      const src = path.join(runtimePath, 'backups', String(id), String(file));
      const dst = path.join(runtimePath, String(file));
      if (!src.startsWith(path.join(runtimePath, 'backups')) || !dst.startsWith(runtimePath)) return { ok: false, error: '路径非法' };
      try {
        backupCurrent(); // 先备份现有代码
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        return { ok: true, target: String(file) };
      } catch (e) { return { ok: false, error: e.message }; }
    });

    // ---------- AI 写代码（DeepSeek） ----------
    ipcMain.handle('ai:writeCode', async (e, input) => {
      try {
        const lines = envfile.readEnvFile(path.join(runtimePath, 'tianlu_bot', '.env'));
        const get = (k, d) => { const l = lines.find(x => x.type === 'key' && x.key === k); return l && l.value ? l.value : d; };
        const key = get('DEEPSEEK_API_KEY', '');
        if (!key) return { ok: false, error: '请先在设置里填写 DeepSeek API 密钥' };
        const baseUrl = get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/$/, '');
        const prompt = `你是资深程序员。请根据需求写代码。
【文件】${input.file}
【当前内容】
${input.content.slice(0, 4000)}

【需求】${input.requirement}
要求：只输出完整的新代码（或修改后的完整文件），不要解释，不要 markdown 代码块围栏。`;
        const res = await fetch(baseUrl + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: get('DEEPSEEK_MODEL', 'deepseek-chat'), messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 4000 })
        });
        const j = await res.json();
        if (!j.choices || !j.choices[0]) return { ok: false, error: 'AI 调用失败：' + JSON.stringify(j).slice(0, 150) };
        let code = j.choices[0].message.content || '';
        code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
        // 备份 + 立即应用
        const dst = path.join(runtimePath, input.file);
        if (!dst.startsWith(runtimePath)) return { ok: false, error: '路径非法' };
        backupCurrent();
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        writeFileAtomic(dst, code);
        return { ok: true, code };
      } catch (e) { return { ok: false, error: e.message }; }
    });

    // ---------- 壁纸 ----------
    ipcMain.handle('dialog:pickImage', async () => {
      const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'avif', 'tif', 'tiff'] }, { name: '所有文件', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      try {
        const src = r.filePaths[0];
        const dst = path.join(app.getPath('userData'), 'wallpaper.jpg');
        const ext = path.extname(src).toLowerCase();
        const native = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext);
        if (native) {
          try { fs.copyFileSync(src, dst); }
          catch (e1) { fs.writeFileSync(dst, fs.readFileSync(src)); } // 云端占位文件退化为读写
        } else {
          // 特殊格式（heic/avif/tiff…）用内置 ffmpeg 转成 jpg，浏览器才能显示
          const raw = path.join(app.getPath('userData'), 'wallpaper.raw');
          try { fs.copyFileSync(src, raw); } catch (e1) { fs.writeFileSync(raw, fs.readFileSync(src)); }
          const ff = path.join(runtimePath, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
          const { spawnSync } = require('child_process');
          const conv = fs.existsSync(ff) ? spawnSync(ff, ['-y', '-i', raw, '-vf', 'scale=min(2560\\,iw):-2', '-q:v', '3', dst], { windowsHide: true, stdio: 'ignore', timeout: 90000 }) : { status: -1 };
          try { fs.unlinkSync(raw); } catch (e) {}
          if (conv.status !== 0 || !fs.existsSync(dst)) {
            return { ok: false, error: '这个格式转换不了，请换 jpg/png/webp 图片' };
          }
        }
        return { ok: true, size: fs.statSync(dst).size };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('wallpaper:clear', () => {
      try { fs.unlinkSync(path.join(app.getPath('userData'), 'wallpaper.jpg')); } catch (e) {}
      return { ok: true };
    });

    // ---------- 语音克隆（一键配置） ----------
    ipcMain.handle('dialog:pickAudio', async () => {
      const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'amr', 'silk', 'mp4'] }, { name: '所有文件', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      return { ok: true, path: r.filePaths[0] };
    });
    ipcMain.handle('audio:clone', async (e, opts) => {
      try {
        const py = python.detectPython();
        if (!py) return { ok: false, error: '未检测到 Python' };
        const script = path.join(runtimePath, 'tianlu_bot', 'tools', 'clone_voice.py');
        if (!fs.existsSync(script)) return { ok: false, error: '克隆脚本缺失' };
        const { spawn } = require('child_process');
        const args = [script, '--main', opts.main, '--voice-id', opts.voiceId || 'tianlu_bot'];
        if (opts.ref) args.push('--ref', opts.ref);
        if (opts.text) args.push('--text', opts.text);
        return await new Promise((resolve) => {
          const child = spawn(py.path, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '', err = '';
          child.stdout.on('data', d => { out += d.toString('utf8'); });
          child.stderr.on('data', d => { err += d.toString('utf8'); });
          child.on('error', e => resolve({ ok: false, error: e.message }));
          child.on('exit', () => {
            try {
              const line = out.trim().split('\n').filter(x => x.trim().startsWith('{')).pop() || '{}';
              const j = JSON.parse(line);
              if (j.ok) {
                envfile.updateEnv(path.join(runtimePath, 'tianlu_bot', '.env'), { MINIMAX_VOICE_ID: j.voice_id });
                resolve({ ok: true, voiceId: j.voice_id, detail: j.detail || '' });
              } else { resolve(j); }
            } catch (e2) { resolve({ ok: false, error: (out || err || '未知错误').slice(0, 400) }); }
          });
        });
      } catch (e) { return { ok: false, error: e.message }; }
    });

    // ---------- QQ 历史消息 ----------
    ipcMain.handle('msg:list', () => {
      try {
        const d = path.join(runtimePath, 'tianlu_bot', 'logs', 'messages');
        if (!fs.existsSync(d)) return [];
        return fs.readdirSync(d).filter(f => f.endsWith('.log')).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size, mtime: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
      } catch (e) { return []; }
    });
    ipcMain.handle('msg:read', (e, name) => {
      const safe = path.basename(String(name || ''));
      if (!safe.endsWith('.log')) return '';
      try {
        const p = path.join(runtimePath, 'tianlu_bot', 'logs', 'messages', safe);
        const buf = fs.readFileSync(p);
        // 只返回最后 200KB，避免巨量内容卡界面
        const slice = buf.length > 200 * 1024 ? buf.slice(buf.length - 200 * 1024) : buf;
        let s = slice.toString('utf8');
        if (s.includes('\uFFFD')) { try { s = new TextDecoder('gbk').decode(slice); } catch (e) {} }
        return s;
      } catch (e) { return ''; }
    });

    // ---------- 生成语音 / 网易云缓存 ----------
    const listMedia = (sub) => {
      try {
        const d = path.join(runtimePath, 'tianlu_bot', 'data', sub);
        if (!fs.existsSync(d)) return [];
        return fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isFile()).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size, mtime: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
      } catch (e) { return []; }
    };
    ipcMain.handle('media:listTts', () => listMedia('tts_cache'));
    ipcMain.handle('media:listMusic', () => listMedia('music_cache'));

    // ---------- 音频上传（机器人播放用） ----------
    const audioDir = () => path.join(runtimePath, 'tianlu_bot', 'data', 'audio');
    ipcMain.handle('audio:list', () => {
      try {
        const d = audioDir();
        if (!fs.existsSync(d)) return [];
        return fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isFile()).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size }));
      } catch (e) { return []; }
    });
    ipcMain.handle('audio:upload', async () => {
      const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'amr', 'silk', 'mp4'] }, { name: '所有文件', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
      try {
        const d = audioDir();
        fs.mkdirSync(d, { recursive: true });
        const copied = [];
        for (const src of r.filePaths) {
          const name = path.basename(src);
          fs.copyFileSync(src, path.join(d, name));
          copied.push(name);
        }
        return { ok: true, copied };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('audio:delete', (e, name) => {
      const safe = path.basename(String(name || ''));
      if (!safe) return { ok: false, error: '非法文件名' };
      try { fs.unlinkSync(path.join(audioDir(), safe)); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });

    // ---------- 系统/杀毒白名单 ----------
    const detectAv = () => {
      const found = [];
      const marks = [
        ['360 安全卫士', '360Safe.exe', '360Tray.exe'],
        ['火绒安全', 'HipsTray.exe', 'HipsDaemon.exe'],
        ['腾讯电脑管家', 'QQPCTray.exe', 'QQPCRTP.exe'],
        ['金山毒霸', 'kxetray.exe', 'kxescore.exe']
      ];
      try {
        const { execSync } = require('child_process');
        const out = execSync('tasklist /fo csv /nh', { encoding: 'utf8', windowsHide: true }).toLowerCase();
        for (const [name, p1, p2] of marks) {
          if (out.includes(p1.toLowerCase()) || out.includes(p2.toLowerCase())) found.push(name);
        }
      } catch (e) {}
      return found;
    };
    const getWhitelistPaths = () => {
      const dirs = [];
      try { dirs.push(path.dirname(process.execPath)); } catch (e) {}
      try { dirs.push(app.getPath('userData')); } catch (e) {}
      try { dirs.push(runtimePath); } catch (e) {}
      return [...new Set(dirs)].filter(d => d && fs.existsSync(d));
    };
    const defenderExcluded = () => {
      try {
        const { execSync } = require('child_process');
        const out = execSync('powershell -NoProfile -Command "(Get-MpPreference).ExclusionPath"', { encoding: 'utf8', windowsHide: true, timeout: 20000 });
        const paths = getWhitelistPaths();
        const covered = paths.filter(p => out.toLowerCase().includes(p.toLowerCase()));
        return { covered, total: paths.length };
      } catch (e) { return { covered: [], total: getWhitelistPaths().length, error: e.message }; }
    };
    const runWhitelistElevated = () => {
      const paths = getWhitelistPaths();
      if (!paths.length) return { ok: false, error: 'no-paths' };
      const { execSync } = require('child_process');
      const ps1 = path.join(app.getPath('temp'), 'rc-whitelist.ps1');
      const lines = ["$ErrorActionPreference = 'SilentlyContinue'"];
      for (const p of paths) lines.push("Add-MpPreference -ExclusionPath '" + p.replace(/'/g, "''") + "'");
      lines.push("Add-MpPreference -ExclusionProcess 'RobotConsole.exe'");
      lines.push("Add-MpPreference -ExclusionProcess 'node.exe'");
      lines.push("Add-MpPreference -ExclusionProcess 'python.exe'");
      fs.writeFileSync(ps1, lines.join('\r\n'), 'utf8');
      try {
        const psCmd = "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','" + ps1 + "'";
        execSync('powershell -NoProfile -Command "' + psCmd + '"', { windowsHide: true, timeout: 120000 });
      } catch (e) {
        return { ok: false, error: 'UAC 被取消或执行失败' };
      }
      const after = defenderExcluded();
      return { ok: true, covered: after.covered, total: paths.length };
    };
    ipcMain.handle('sec:status', () => {
      const def = defenderExcluded();
      return {
        defenderOk: def.total > 0 && def.covered.length === def.total,
        covered: def.covered,
        total: def.total,
        avs: detectAv(),
        whitelistDone: !!store.get('whitelistDone')
      };
    });
    ipcMain.handle('sec:whitelist', async () => {
      const r = runWhitelistElevated();
      if (r.ok) store.merge({ whitelistDone: true });
      return { ...r, avs: detectAv() };
    });

    // ---------- 意见反馈墙（控制台 + 群聊统一：feedback_store.json） ----------
    const fbFile = () => path.join(app.getPath('userData'), 'feedback.json');
    const fbStore = () => path.join(runtimePath, 'tianlu_bot', 'data', 'feedback_store.json');
    ipcMain.handle('feedback:submit', (e, item) => {
      let list = [];
      try { list = JSON.parse(fs.readFileSync(fbFile(), 'utf8')); } catch (e) {}
      const entry = { time: Date.now(), type: String(item.type || '建议'), text: String(item.text || '').slice(0, 500), qq: String(item.qq || '') };
      list.unshift(entry);
      writeFileAtomic(fbFile(), JSON.stringify(list, null, 2));
      // 写入统一反馈库：机器人会转发到反馈群
      try {
        let store = [];
        try { store = JSON.parse(fs.readFileSync(fbStore(), 'utf8')); } catch (e) {}
        if (!Array.isArray(store)) store = [];
        store.unshift({ id: store.length + 1, time: entry.time, source: 'console', type: entry.type, text: entry.text, qq: entry.qq, status: 'open', posted: false });
        writeFileAtomic(fbStore(), JSON.stringify(store, null, 2));
      } catch (e) { console.error('[feedback] store write failed', e); }
      return { ok: true, list: store };
    });
    ipcMain.handle('feedback:markDone', (e, id) => {
      try {
        const store = JSON.parse(fs.readFileSync(fbStore(), 'utf8'));
        if (!Array.isArray(store)) return { ok: false };
        const it = store.find(x => String(x.id) === String(id));
        if (!it) return { ok: false, error: 'not-found' };
        it.status = 'done';
        it.doneTime = Date.now();
        writeFileAtomic(fbStore(), JSON.stringify(store, null, 2));
        return { ok: true, store };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('feedback:list', () => {
      // 反馈墙统一读 feedback_store.json（含群聊反馈与状态）
      try {
        const store = JSON.parse(fs.readFileSync(fbStore(), 'utf8'));
        if (Array.isArray(store)) return store;
        return [];
      } catch (e) { return []; }
    });

    // ---------- 网易云 cookie（保存一次，永久生效）----------
    ipcMain.handle('cookie:save', (e, cookie) => {
      envfile.updateEnv(path.join(runtimePath, 'tianlu_bot', '.env'), { NETEASE_COOKIE: String(cookie || '').trim() });
      return { ok: true };
    });

    // ---------- 人格 ----------
    const qqJsonPath = () => path.join(runtimePath, 'tianlu_bot', 'data', 'qq.json');
    ipcMain.handle('persona:get', () => {
      try { return JSON.parse(fs.readFileSync(qqJsonPath(), 'utf8')); }
      catch (e) { return { name: '', system_prompt: '', actions: [] }; }
    });
    ipcMain.handle('persona:save', (e, data) => {
      writeFileAtomic(qqJsonPath(), JSON.stringify({
        name: data.name || '机器人',
        system_prompt: data.system_prompt || '',
        actions: data.actions || []
      }, null, 2));
      return { ok: true };
    });
    ipcMain.handle('persona:export', async () => {
      const r = await dialog.showSaveDialog({ defaultPath: '人格配置.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const d = JSON.parse(fs.readFileSync(qqJsonPath(), 'utf8'));
      fs.writeFileSync(r.filePath, JSON.stringify(d, null, 2), 'utf8');
      return { ok: true, path: r.filePath };
    });
    ipcMain.handle('persona:import', async () => {
      const r = await dialog.showOpenDialog({ filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      try {
        const d = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
        const out = { name: d.name || '机器人', system_prompt: d.system_prompt || '', actions: d.actions || [] };
        writeFileAtomic(qqJsonPath(), JSON.stringify(out, null, 2));
        return { ok: true, data: out };
      } catch (e) { return { ok: false, error: '人格文件格式错误：' + e.message }; }
    });

    // ---------- AI 生成人格（DeepSeek）----------
    ipcMain.handle('ai:generatePersona', async (e, input) => {
      try {
        const lines = envfile.readEnvFile(path.join(runtimePath, 'tianlu_bot', '.env'));
        const get = (k, dflt) => { const l = lines.find(x => x.type === 'key' && x.key === k); return l && l.value ? l.value : dflt; };
        const key = get('DEEPSEEK_API_KEY', '');
        const baseUrl = get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
        const model = get('DEEPSEEK_MODEL', 'deepseek-chat');
        if (!key) return { ok: false, error: '请先在「设置」里填写 DeepSeek API 密钥' };
        const prompt = `请根据以下信息生成一个 QQ 机器人人格配置文件（只输出 JSON）：
【名字】${input.name || '未指定'}
【性格大概】${input.personality || '未指定'}
【配置文件要求】${input.requirements || '无特殊要求'}

JSON 必须包含以下字段：
- name：名字（字符串）
- system_prompt：详细人设与回复规则（中文，250字以内，包含说话风格、语气、动作描写要求、回复长度限制）
- actions：动作列表（5~10个简短动作，用于说话前括号动作描写，如：甩尾巴、歪头、抱胸）

只输出 JSON 本身，不要任何解释。`;
        const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.85, max_tokens: 1200 })
        });
        const j = await res.json();
        if (!j.choices || !j.choices[0]) return { ok: false, error: 'AI 调用失败：' + JSON.stringify(j).slice(0, 200) };
        const text = j.choices[0].message.content || '';
        const mm = text.match(/\{[\s\S]*\}/);
        if (!mm) return { ok: false, error: 'AI 返回内容无法解析，请重试' };
        const data = JSON.parse(mm[0]);
        const out = { name: data.name || input.name || '机器人', system_prompt: data.system_prompt || '', actions: Array.isArray(data.actions) ? data.actions : [] };
        writeFileAtomic(qqJsonPath(), JSON.stringify(out, null, 2));
        return { ok: true, data: out };
      } catch (e) { return { ok: false, error: e.message }; }
    });

  }

  // ---------- 窗口 ----------
  // 把窗口放到鼠标所在（用户真正在看的）显示器中央，避免开到虚拟显示器上
  const { screen } = require('electron');
  function cursorCenterPos(w, h) {
    try {
      const pt = screen.getCursorScreenPoint();
      const wa = screen.getDisplayNearestPoint(pt).workArea;
      return { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2) };
    } catch (e) { return { center: true }; }
  }

  function createSplash() {
    splashWindow = new BrowserWindow({
      width: 420, height: 300, frame: false, transparent: false, resizable: false,
      backgroundColor: '#e6f5ff',
      alwaysOnTop: true, ...cursorCenterPos(420, 300), webPreferences: { contextIsolation: false, nodeIntegration: true }
    });
    splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  }

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1320, height: 860, minWidth: 1100, minHeight: 700,
      show: false, frame: true, title: '机器人控制台',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#5a6b7a', height: 40 },
      backgroundColor: '#e6f5ff',
      ...cursorCenterPos(1320, 860),
      icon: path.join(__dirname, 'renderer', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        spellcheck: false
      }
    });
    mainWindow.webContents.on('did-finish-load', () => console.log('[main] renderer loaded OK'));
    mainWindow.webContents.on('did-fail-load', (e, code, desc) => console.log('[main] renderer FAILED:', code, desc));
    mainWindow.webContents.on('console-message', (e, level, message) => console.log('[renderer]', message));
    mainWindow.setMenuBarVisibility(false);
    // 安全：内置网页只允许打开本机地址
    mainWindow.webContents.on('will-attach-webview', (e, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (!params.src.startsWith('http://127.0.0.1') && !params.src.startsWith('file://')) {
        e.preventDefault();
      }
    });
    mainWindow.on('render-process-gone', (e, d) => handleCrash(new Error('渲染进程崩溃: ' + JSON.stringify(d))));
    mainWindow.on('unresponsive', () => handleCrash(new Error('窗口无响应')));
    mainWindow.once('ready-to-show', () => {
      if (splashWindow) { splashWindow.close(); splashWindow = null; }
      mainWindow.show();
    });
    // 兜底：ready-to-show 在远程桌面/核显/软件渲染下可能迟迟不触发（首次绘制卡住），
    // 8 秒后强制显示主窗口 + 关闭 splash，避免永远卡在加载画面
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        if (splashWindow) { splashWindow.close(); splashWindow = null; }
        mainWindow.show();
        console.log('[main] ready-to-show 超时，已强制显示主窗口');
      }
    }, 8000);
    mainWindow.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['隐藏到托盘', '退出程序', '取消'],
        defaultId: 0, cancelId: 2, noLink: true,
        title: '机器人控制台',
        message: '要隐藏到托盘还是退出？',
        detail: '隐藏到托盘后，NapCat 和机器人会在后台继续运行。双击托盘图标可重新打开。'
      });
      if (choice === 0) { mainWindow.hide(); }
      else if (choice === 1) { quitting = true; app.quit(); }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}/index.html`);
  }

  // ---------- 启动 ----------
  app.whenReady().then(async () => {
    console.log('[main] whenReady fired');
    store = new Store();
    procman = new ProcessManager();
    procman.setSender((channel, payload) => { if (mainWindow) mainWindow.webContents.send(channel, payload); });


    // 隐藏菜单栏（只保留复制/粘贴等快捷键，不显示 File/Edit 等菜单）
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ] }
    ]));
    registerIpc();
    createSplash();

    // 启动渲染层服务器
    await startServer(path.join(__dirname, 'renderer'));

    // 首次解压运行时（带进度）
    const firstRun = !store.get('firstRunDone');
    // 每次启动前，杀掉与本程序相关的一切残留进程：
    //   同类实例（electron.exe / RobotConsole.exe，排除自己）+ runtime 下的 QQ / NapCat / node
    //   + 跑 tianlu_bot 的 python。
    // 关键：按「可执行文件路径 / 命令行」匹配，不会误杀用户自己开着的 QQ 或其他 Python 程序。
    try {
      const { killRelated } = require('./modules/killer');
      const rtForKill = runtime.getRuntimePath();
      const kr = killRelated({ runtimePath: rtForKill, pid: process.pid, scope: 'all' });
      if (kr.killed && kr.killed.length) {
        console.log('[main] 启动前已清理残留进程: ' + kr.killed.join(', '));
      } else {
        console.log('[main] 启动前无需清理（没有残留进程）');
      }
      // 给被结束的进程一点时间释放文件句柄/端口
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {}
    runtimePath = runtime.ensureRuntime((msg) => { if (splashWindow) splashWindow.webContents.send('progress', msg); });
    store.merge({ firstRunDone: true });

    // 功能开关初始化：is_enabled() 默认返回 false（安全第一），但 .env 模板里从来没写过
    // FEATURE_* 项，导致所有功能（消息记录 / 语音 / 音乐 / AI聊天 …）默认全是关的，
    // 用户看到的就是"消息页、语音页、音乐页全是空的"。
    // 这里只在 .env 完全没有 FEATURE_ 配置时补写一次默认值，绝不覆盖用户已改过的设置。
    try {
      const envPath = path.join(runtimePath, 'tianlu_bot', '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        if (!/^\s*FEATURE_/m.test(content)) {
          const block = [
            '',
            '# ── 功能开关（true=开启 / false=关闭，改完重启机器人生效）──',
            '# 消息页 / 语音 / 音乐要有内容，必须开启 FEATURE_MONITOR / FEATURE_TTS / FEATURE_SONG',
            'FEATURE_AI_CHAT=true',
            'FEATURE_MONITOR=true',
            'FEATURE_TTS=true',
            'FEATURE_SONG=true',
            'FEATURE_GAMES=true',
            'FEATURE_SIGN=true',
            'FEATURE_LOTTERY=true',
            'FEATURE_FORTUNE=true',
            'FEATURE_IDIOM=true',
            'FEATURE_POKE=true',
            'FEATURE_VISION=true',
            'FEATURE_SYSTEM_COMMANDS=true',
            'FEATURE_FREE_CHAT=false',
            'FEATURE_RANDOM_TALK=false',
            'FEATURE_AUTO_REBOOT=false',
            ''
          ].join('\n');
          fs.appendFileSync(envPath, block, 'utf8');
          console.log('[main] .env 缺少 FEATURE_* 配置，已补写默认功能开关');
        }
      }
    } catch (e) { console.error('[main] 补写功能开关失败:', e.message); }

    // 每次启动校准端口：真实 bind 探测，冲突（排除段 EACCES / 被占用 EADDRINUSE）就自动顺延，
    // 并把选中的端口写回 settings + 各运行时配置，保证 NapCat/bot/反向WS 三方一致。
    try {
      const { findFreePort } = require('./modules/ports');
      const webuiPreferred = store.get('webui').port;
      const botPreferred = store.get('bot').port;
      const [wp, bp] = await Promise.all([findFreePort(webuiPreferred), findFreePort(botPreferred)]);
      let changed = false;
      if (wp.changed && wp.port) {
        const w = store.get('webui'); w.port = wp.port; store.set('webui', w);
        console.log(`[main] 启动校准：WebUI 端口 ${webuiPreferred}(${wp.reason}) → ${wp.port}`);
        changed = true;
      }
      if (bp.changed && bp.port) {
        const b = store.get('bot'); b.port = bp.port; store.set('bot', b);
        console.log(`[main] 启动校准：bot 端口 ${botPreferred}(${bp.reason}) → ${bp.port}`);
        changed = true;
      }
      // 无论是否变化都应用一次，确保 webui.json / onebot11.json 与实际端口一致
      try {
        network.applyNetworkConfig(runtimePath, {
          webuiPort: store.get('webui').port,
          webuiHost: '127.0.0.1',
          botPort: store.get('bot').port,
          botHost: '127.0.0.1',
          napcatApiPort: store.get('napcatApiPort') || 16200
        });
      } catch (e) { console.error('[main] 启动校准应用配置失败:', e.message); }
      if (changed) console.log('[main] 端口校准完成');
      console.log(`[main] 端口就绪：WebUI=${store.get('webui').port} bot=${store.get('bot').port}`);
    } catch (e) { console.error('[main] 端口校准失败:', e.message); }

    // 系统信息定时推送
    setInterval(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sys:info', sysinfo.sample()); }, 5000);

    createMainWindow();

    // 历史消息/日志/缓存永久保留（用户要求，不再自动清除）
    // 首次启动把签名证书装进用户信任列表（8 秒后，不阻塞）
    setTimeout(() => installTrustCert(), 8000);
    // 桌面快捷方式：没有就自动创建（20 秒后）
    setTimeout(() => ensureDesktopShortcut(), 20000);
    // 更新检查：启动 15 秒后首查，之后每 30 分钟；窗口聚焦时补查（10 分钟节流）
    setTimeout(() => runUpdateCheck(false), 15000);
    setInterval(() => runUpdateCheck(false), 30 * 60 * 1000);
    let lastFocusCheck = 0;
    app.on('browser-window-focus', () => {
      if (Date.now() - lastFocusCheck > 10 * 60 * 1000) {
        lastFocusCheck = Date.now();
        runUpdateCheck(false);
      }
    });

    // 首次运行：自动配置网络 + 自动配置 Python（后台，不阻塞）
    if (firstRun) {
      setTimeout(() => {
        // 自动加入系统白名单（Defender 排除，UAC 授权一次）
        try {
          if (!store.get('whitelistDone')) {
            const wr = runWhitelistElevated();
            if (wr.ok) store.merge({ whitelistDone: true });
            console.log('[main] auto whitelist:', wr.ok, (wr.covered || []).join(', '));
          }
        } catch (e) { console.log('[main] auto whitelist skipped', e.message); }

        // 需求9：自动配置网络（WebUI 端口 + 反向 WebSocket + 防火墙）
        try {
          const netCfg = {
            webuiPort: store.get('webui').port, webuiHost: '127.0.0.1',
            botPort: store.get('bot').port, botHost: '127.0.0.1',
            napcatApiPort: store.get('napcatApiPort') || 16200,
            proxy: store.get('network').proxy
          };
          const res = network.applyNetworkConfig(runtimePath, netCfg);
          console.log('[main] auto network config:', res.map(r => r.name + '=' + r.ok).join(', '));
        } catch (e) { console.error('[main] auto network config failed', e); }

        // 需求12：自动配置 Python 环境（未检测到则静默安装 + 安装依赖）
        try {
          if (!python.detectPython()) {
            console.log('[main] python not found, auto-installing...');
            python.setupPython(runtimePath, (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('python:log', msg); })
              .then((r) => {
                if (r.path) { const s = store.get('bot'); s.pythonPath = r.path; store.set('bot', s); }
                console.log('[main] python auto-setup result:', r.ok, r.path || '');
              });
          } else {
            // Python 已存在 → 检查依赖库，缺了就自动装
            try {
              const { execSync } = require('child_process');
              execSync('"' + python.detectPython().path + '" -c "import nonebot"', { stdio: 'ignore', windowsHide: true, timeout: 30000 });
              console.log('[main] python present, deps ok');
            } catch (e) {
              console.log('[main] python present but deps missing, auto-installing...');
              python.setupPython(runtimePath, (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('python:log', msg); })
                .then((r) => {
                  if (r.path) { const s = store.get('bot'); s.pythonPath = r.path; store.set('bot', s); }
                  console.log('[main] deps auto-setup result:', r.ok);
                });
            }
          }
        } catch (e) { console.error('[main] python auto-setup failed', e); }
      }, 2500);
    }
  });

  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.on('window-all-closed', () => {
    try { procman && procman.stopAll(); } catch (e) {}
    app.quit();
  });

  app.on('before-quit', () => {
    try { procman && procman.stopAll(); } catch (e) {}
  });
}
