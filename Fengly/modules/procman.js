'use strict';
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// 从注册表找官方 QQ 安装路径（注入壳模式用）
function findOfficialQQ() {
  const { execSync } = require('child_process');
  const keys = [
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ" /v UninstallString',
    'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ" /v UninstallString'
  ];
  for (const k of keys) {
    try {
      const out = execSync(k, { encoding: 'utf8', windowsHide: true });
      const m = out.match(/REG_SZ\s+(.+?)\\Uninstall\.exe/i) || out.match(/REG_SZ\s+(.+)/i);
      if (m) {
        const dir = path.dirname(m[1].trim());
        const qq = path.join(dir, 'QQ.exe');
        if (fs.existsSync(qq)) return qq;
      }
    } catch (e) {}
  }
  return null;
}

class ProcessManager {
  constructor() {
    this.procs = { napcat: null, bot: null };
    this.send = null; // (channel, payload) => void
  }

  setSender(fn) { this.send = fn; }

  status(kind) {
    const p = this.procs[kind];
    return { running: !!p && !p.killed && p.exitCode === null, pid: p ? p.pid : null };
  }

  allStatus() {
    return { napcat: this.status('napcat'), bot: this.status('bot') };
  }

  _emit(kind, data) {
    if (this.send) this.send('proc:log', { kind, data: data.toString ? data.toString('utf8') : String(data) });
  }

  _spawn(kind, cmd, args, opts) {
    if (this.procs[kind] && this.procs[kind].exitCode === null) {
      return { ok: false, error: 'already-running' };
    }
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.procs[kind] = child;
    child.stdout.on('data', (d) => this._emit(kind, d));
    child.stderr.on('data', (d) => this._emit(kind, d));
    child.on('error', (e) => this._emit(kind, `[spawn error] ${e.message}\n`));
    child.on('exit', (code) => {
      this._emit(kind, `\n[process exited, code=${code}]\n`);
      if (this.send) this.send('proc:status', this.allStatus());
    });
    if (this.send) this.send('proc:status', this.allStatus());
    return { ok: true, pid: child.pid };
  }
  async startNapcat(runtimePath, opts = {}) {
    // 免装 QQ 方案：NapCat 4.18.41 框架 + 独立 QQ 9.9.33 环境，通过注入启动
    // 目录结构：
    //   runtime/napcat/  = NapCat 框架（napcat.mjs + Hook + 启动器）
    //   runtime/qq/      = 独立 QQ 9.9.33 完整环境（QQ.exe + versions/）
    const napcatDir = path.join(runtimePath, 'napcat');
    const qqExe = path.join(runtimePath, 'qq', 'QQ.exe');
    const hookDll = path.join(napcatDir, 'NapCatWinBootHook.dll');
    const bootMain = path.join(napcatDir, 'NapCatWinBootMain.exe');

    // 校验关键文件
    if (!fs.existsSync(bootMain)) return { ok: false, error: 'NapCat 启动器缺失' };
    if (!fs.existsSync(qqExe)) return { ok: false, error: '独立 QQ 环境缺失（runtime/qq/QQ.exe）' };
    if (!fs.existsSync(hookDll)) return { ok: false, error: 'NapCat Hook 缺失' };

    // 启动前探测可用 WebUI 端口（真实 bind 测试，同时捕获排除段 EACCES 和占用 EADDRINUSE）
    const webuiPath = path.join(napcatDir, 'config', 'webui.json');
    let preferredWebui = parseInt(opts.webuiPort, 10);
    if (!Number.isFinite(preferredWebui) || preferredWebui <= 0) {
      try { preferredWebui = parseInt(JSON.parse(fs.readFileSync(webuiPath, 'utf8')).port, 10); } catch (e) { preferredWebui = 0; }
    }
    if (!Number.isFinite(preferredWebui) || preferredWebui <= 0) preferredWebui = 8899;

    const { findFreePort } = require('./ports');
    const picked = await findFreePort(preferredWebui);
    const webuiPort = picked.port || preferredWebui;
    if (picked.changed) {
      console.log(`[procman] WebUI 端口 ${preferredWebui} 不可用(${picked.reason})，自动切换到 ${webuiPort}`);
    }

    try {
      let webui = { host: '127.0.0.1', port: webuiPort, token: 'tianlu' };
      try { webui = { ...JSON.parse(fs.readFileSync(webuiPath, 'utf8')), host: '127.0.0.1', port: webuiPort, token: 'tianlu' }; } catch (e) {}
      if (!fs.existsSync(path.dirname(webuiPath))) fs.mkdirSync(path.dirname(webuiPath), { recursive: true });
      fs.writeFileSync(webuiPath, JSON.stringify(webui, null, 4), 'utf8');
      console.log('[procman] WebUI 端口已同步为 ' + webuiPort);
    } catch (e) { console.error('[procman] WebUI 端口同步失败:', e.message); }

    // NapCat 需要的环境变量
    const env = {
      ...process.env,
      NAPCAT_PATCH_PACKAGE: path.join(napcatDir, 'qqnt.json'),
      NAPCAT_LOAD_PATH: path.join(napcatDir, 'loadNapCat.js'),
      NAPCAT_INJECT_PATH: hookDll,
      NAPCAT_MAIN_PATH: path.join(napcatDir, 'napcat.mjs'),
      NAPCAT_WORKDIR: napcatDir,
      NAPCAT_WEBUI_SECRET_KEY: 'tianlu', // 固定 token
      // 账密自动登录：账号 + 密码 MD5（免扫码，登录态失效时自动用密码回退登录）
      NAPCAT_QUICK_ACCOUNT: '482522406',
      NAPCAT_QUICK_PASSWORD_MD5: '83258bf42dadddbce67c2185f056aff4'
    };

    // 自动快速登录：扫描 config 里带 QQ 账号后缀的配置（onebot11_<uin>.json），
    // 推断上次登录的账号，传给 -q 参数尝试快速登录（登录态有效就免扫码）
    const bootArgs = [qqExe, hookDll];
    try {
      const configDir = path.join(napcatDir, 'config');
      const uin = opts.qq || this._findLoggedUin(configDir);
      if (uin) {
        bootArgs.push('-q', String(uin));
        console.log('[procman] 尝试快速登录 QQ ' + uin);
      }
    } catch (e) {}

    console.log('[procman] NapCat 启动（免装QQ：NapCat 4.18.41 + QQ 9.9.33）');
    // 调用：NapCatWinBootMain.exe <QQ.exe路径> <Hook.dll路径> [-q <uin>]
    const spawned = this._spawn('napcat', bootMain, bootArgs, { cwd: napcatDir, env });
    return { ...spawned, webuiPort: webuiPort, webuiPortChanged: !!picked.changed };
  }

  // 从 NapCat config 目录里扫描登录过的 QQ 账号（带 <uin> 后缀的配置文件名）
  _findLoggedUin(configDir) {
    try {
      if (!fs.existsSync(configDir)) return null;
      const files = fs.readdirSync(configDir);
      for (const f of files) {
        const m = f.match(/^onebot11_(\d+)\.json$/);
        if (m) return m[1];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  stopNapcat() {
    return this._stop('napcat');
  }

  async startBot(runtimePath, opts = {}) {
    const botDir = path.join(runtimePath, 'tianlu_bot');
    const py = opts.pythonPath || 'python';
    // 把内置 ffmpeg 加入 PATH，点歌转码可直接用
    const ffbin = path.join(runtimePath, 'tools', 'ffmpeg', 'bin');
    let env = fs.existsSync(path.join(ffbin, 'ffmpeg.exe')) ? { PATH: ffbin + ';' + (process.env.PATH || '') } : {};

    // 启动前探测可用 bot 端口（避免 10013 排除段 / 10048 占用）
    let preferred = parseInt(opts.port, 10);
    if (!Number.isFinite(preferred) || preferred <= 0) preferred = 18080;
    const { findFreePort } = require('./ports');
    const picked = await findFreePort(preferred);
    const botPort = picked.port || preferred;
    const botHost = String(opts.host || '127.0.0.1');
    if (picked.changed) {
      console.log(`[procman] bot 端口 ${preferred} 不可用(${picked.reason})，自动切换到 ${botPort}`);
    }

    env.BOT_PORT = String(botPort);
    env.BOT_HOST = botHost;

    // 端口变了 → 同步反向 WS 目标（NapCat 需要连新的 bot 端口）
    if (picked.changed) {
      try {
        const network = require('./network');
        network.applyNetworkConfig(runtimePath, {
          webuiPort: (function () {
            try { return parseInt(JSON.parse(fs.readFileSync(path.join(runtimePath, 'napcat', 'config', 'webui.json'), 'utf8')).port, 10) || 8899; } catch (e) { return 8899; }
          })(),
          botPort: botPort,
          botHost: botHost,
          napcatApiPort: (function () {
            try {
              const cfgPath = path.join(runtimePath, 'napcat', 'config', 'onebot11.json');
              const ob = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
              const hs = ob && ob.network && ob.network.httpServers && ob.network.httpServers[0];
              return (hs && parseInt(hs.port, 10)) || 16200;
            } catch (e) { return 16200; }
          })()
        });
      } catch (e) { console.error('[procman] 同步反向WS端口失败:', e.message); }
    }

    const spawned = this._spawn('bot', py, ['bot.py'], { cwd: botDir, env });
    return { ...spawned, botPort: botPort, botPortChanged: !!picked.changed };
  }

  stopBot() {
    return this._stop('bot');
  }

  _stop(kind) {
    const p = this.procs[kind];
    if (!p || p.exitCode !== null) {
      this.procs[kind] = null;
      if (this.send) this.send('proc:status', this.allStatus());
      return { ok: false, error: 'not-running' };
    }
    // 温和关闭：先发关闭信号（不带 /F），给 QQ/NapCat 时间保存登录态（SQLite checkpoint）
    // 5 秒后仍未退出才强制杀（这一步只在温和关闭失败时兜底）
    try { p.kill(); } catch (e) {}
    if (kind === 'napcat') {
      // NapCat：温和关闭 QQ（保存登录态），再关 NapCatWinBootMain
      try { exec('taskkill /IM QQ.exe', { windowsHide: true }, () => {}); } catch (e) {}
      try { exec('taskkill /IM NapCatWinBootMain.exe', { windowsHide: true }, () => {}); } catch (e) {}
    } else {
      try { exec(`taskkill /pid ${p.pid} /T`, { windowsHide: true }, () => {}); } catch (e) {}
    }
    // 兜底：5 秒后仍存活才强杀（给足登录态落盘时间）
    setTimeout(() => {
      try {
        if (kind === 'napcat') {
          exec('taskkill /F /IM QQ.exe /T', { windowsHide: true }, () => {});
          exec('taskkill /F /IM NapCatWinBootMain.exe /T', { windowsHide: true }, () => {});
        } else {
          exec(`taskkill /pid ${p.pid} /T /F`, { windowsHide: true }, () => {});
        }
      } catch (e) {}
    }, 5000);
    this.procs[kind] = null;
    if (this.send) this.send('proc:status', this.allStatus());
    return { ok: true };
  }

  stopAll() {
    this.stopNapcat();
    this.stopBot();
  }
}

module.exports = { ProcessManager };
