'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  language: 'zh',          // zh | en
  theme: 'light',          // dark | light | auto (ocean light)
  accentColor: '#5BE7FF',  // 自定义 UI 主色（默认粉色，与 NapCat 主题一致）
  animations: true,
  napcatApiPort: 16200,  // NapCat HTTP API 端口（程序调用群文件用）
  updateGroupId: '',  // QQ 群号：程序从该群文件读取 update.json（推荐，发群即生效）
  updateUrl: 'https://4001880759.cdn.123clouddisk.com/4001880759/NapCat/update.json',  // 更新源地址（放 update.json 的目录），留空 = 关闭检查
  webui: {
    host: '127.0.0.1',
    port: 8899,  // 8899 避开 Windows 端口排除范围 6002-6101（6099 会被系统保留导致 EACCES）
    token: ''
  },
  bot: {
    host: '127.0.0.1',
    port: 18080,  // 18080 避开 Windows 端口排除范围 8070-8169（8080 会被系统保留导致 10013 socket 错误）
    pythonPath: ''
  },
  memory: {
    nodeMaxOldSpace: 2048, // MB
    pythonMaxMem: 0
  },
  network: {
    autoConfig: true,
    proxy: ''
  },
  autoStart: {
    napcat: false,
    bot: false
  },
  firstRunDone: false,
  certInstalled: false,  // 首次启动已把签名证书装进用户信任列表
  wallOpacity: 0.45,  // 壁纸模式下卡片透明度（PCL2 风格，0~1）
  wallBlur: 0,        // 壁纸模式下卡片背景模糊（px，0=不模糊）
  fontFamily: 'default', // 界面字体
  fontSize: 14        // 界面字号
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = this._load();
  }

  _load() {
    let data;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      data = this._deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(raw));
    } catch (e) {
      data = JSON.parse(JSON.stringify(DEFAULTS));
    }
    // 端口不做强制覆盖（真实可用性由 modules/ports.js 在每次启动前探测决定）。
    // 这里只修正「缺失/非法」的值，并把历史上已知会被系统保留的端口迁走。
    let needSave = false;

    const isValidPort = (p) => Number.isFinite(p) && p >= 1024 && p <= 65535;
    // 已知风险端口（Windows 端口排除范围常命中）：8080(bot 老默认)、6099/16099(webui 老默认)
    const RISKY_BOT = new Set([8080]);
    const RISKY_WEBUI = new Set([6099, 16099]);

    if (!data.webui) data.webui = {};
    const wp = parseInt(data.webui.port, 10);
    if (!isValidPort(wp) || RISKY_WEBUI.has(wp)) {
      data.webui.port = DEFAULTS.webui.port;
      needSave = true;
    }

    if (!data.bot) data.bot = {};
    const bp = parseInt(data.bot.port, 10);
    if (!isValidPort(bp) || RISKY_BOT.has(bp)) {
      data.bot.port = DEFAULTS.bot.port;
      needSave = true;
    }

    if (needSave) {
      // 立即回写，纠正 settings.json 里的旧值
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) { /* 忽略回写失败 */ }
    }
    return data;
  }

  _deepMerge(base, over) {
    const out = JSON.parse(JSON.stringify(base));
    for (const k of Object.keys(over || {})) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') {
        out[k] = this._deepMerge(base[k], over[k]);
      } else {
        out[k] = over[k];
      }
    }
    return out;
  }

  get(key) {
    return key ? this.data[key] : this.data;
  }

  set(key, value) {
    if (key) this.data[key] = value;
    this._save();
  }

  merge(obj) {
    this.data = this._deepMerge(this.data, obj);
    this._save();
    return this.data;
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this._save();
    return this.data;
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp-' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      try { fs.renameSync(tmp, this.file); }
      catch (e) { fs.copyFileSync(tmp, this.file); try { fs.unlinkSync(tmp); } catch (e2) {} }
    } catch (e) {
      console.error('[store] save failed', e);
    }
  }
}

module.exports = { Store, DEFAULTS };
