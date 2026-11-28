'use strict';
// 配置补全器
// ==========
// 用户重装软件 / 换电脑 / 从老版本升级上来时，settings.json 里可能：
//   · 完全没有某个字段（老版本没有这个功能）
//   · 字段存在但值是空字符串（用户之前清空过，或迁移时写坏了）
//
// store._load 的 _deepMerge 只能补「键不存在」的情况，
// 键存在但值为空串时会原样保留空串，导致功能静默失效
// （最典型：updateUrl 为空 → 检查更新永远失败，界面只显示「检查失败」）。
//
// 本模块在启动时跑一遍，把「必须要有值」的字段补上默认值，并记录补了什么。

const fs = require('fs');
const path = require('path');

/**
 * 必须非空的字段。value 为默认值。
 * 只补「空」的，不覆盖用户已填的内容。
 */
const REQUIRED = {
  updateUrl: 'https://github.com/fengly-hetao/RobotConsole',
  napcatApiPort: 16200,
  language: 'zh',
  theme: 'light',
  accentColor: '#5BE7FF',
  fontFamily: 'default',
  fontSize: 14
};

// 允许为空但有结构默认值的嵌套对象
const REQUIRED_NESTED = {
  webui: { host: '127.0.0.1', port: 8899, token: '' },
  bot: { host: '127.0.0.1', port: 18080, pythonPath: '' },
  memory: { nodeMaxOldSpace: 2048, pythonMaxMem: 0 },
  network: { autoConfig: true, proxy: '' },
  autoStart: { napcat: false, bot: false }
};

function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return !Number.isFinite(v);
  return false;
}

/**
 * 补全一个普通对象里缺失/为空 + 有默认值的字段。
 * @returns {{ data: object, filled: string[] }}
 */
function fillObject(obj, defaults, prefix) {
  const filled = [];
  const out = obj && typeof obj === 'object' ? obj : {};

  for (const key of Object.keys(defaults)) {
    const def = defaults[key];
    const cur = out[key];
    const full = prefix ? prefix + '.' + key : key;

    if (def && typeof def === 'object' && !Array.isArray(def)) {
      if (!out[key] || typeof out[key] !== 'object') {
        out[key] = JSON.parse(JSON.stringify(def));
        filled.push(full + '（整块缺失）');
      } else {
        const r = fillObject(out[key], def, full);
        out[key] = r.data;
        filled.push(...r.filled);
      }
      continue;
    }

    if (isBlank(cur)) {
      out[key] = def;
      filled.push(full + ' = ' + JSON.stringify(def));
    }
  }

  return { data: out, filled };
}

/**
 * 主入口：补全 settings 对象。
 * @param {object} settings 当前配置
 * @returns {{ settings: object, filled: string[], changed: boolean }}
 */
function fillSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const work = JSON.parse(JSON.stringify(src));
  const filled = [];

  const flat = fillObject(work, REQUIRED, '');
  filled.push(...flat.filled);

  const nested = fillObject(flat.data, REQUIRED_NESTED, '');
  filled.push(...nested.filled);

  return {
    settings: nested.data,
    filled,
    changed: filled.length > 0
  };
}

// ==================== 运行时文件（.env / ai_data）====================

/**
 * 修复 .env 里必须存在的键（缺行则追加）。
 * 不会覆盖用户已设的值。
 * @param {string} file .env 路径
 * @param {object} defaults { FEATURE_FREE_CHAT: 'true', ... }
 * @returns {{ added: string[], changed: boolean }}
 */
function ensureEnvKeys(file, defaults) {
  const added = [];
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { added, changed: false };
  }

  const lines = text.split(/\r?\n/);
  const present = new Set();
  for (const ln of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(ln);
    if (m) present.add(m[1]);
  }

  const toAppend = [];
  for (const k of Object.keys(defaults)) {
    if (!present.has(k)) {
      toAppend.push(k + '=' + defaults[k]);
      added.push(k + '=' + defaults[k]);
    }
  }

  if (!toAppend.length) return { added, changed: false };

  const tail = text.endsWith('\n') || text.length === 0 ? '' : '\n';
  try {
    fs.writeFileSync(file, text + tail + toAppend.join('\n') + '\n', 'utf8');
  } catch (e) {
    return { added: [], changed: false, error: e.message };
  }

  return { added, changed: true };
}

/**
 * 检查运行时关键文件是否存在，缺什么报什么。
 */
function checkRuntimeFiles(runtimePath) {
  const problems = [];
  if (!runtimePath) return { ok: false, problems: ['runtimePath 为空'] };

  const botRoot = path.join(runtimePath, 'tianlu_bot');
  const mustHave = [
    { p: path.join(botRoot, 'bot.py'), name: 'bot.py' },
    { p: path.join(botRoot, '.env'), name: '.env' },
    { p: path.join(botRoot, 'plugins', 'core', 'config.py'), name: 'plugins/core/config.py' },
    { p: path.join(runtimePath, 'napcat', 'NapCatWinBootMain.exe'), name: 'NapCatWinBootMain.exe' },
    { p: path.join(runtimePath, 'qq', 'QQ.exe'), name: 'qq/QQ.exe' }
  ];

  for (const m of mustHave) {
    try {
      if (!fs.existsSync(m.p)) problems.push('缺少 ' + m.name);
    } catch (e) {
      problems.push('无法访问 ' + m.name);
    }
  }

  return { ok: problems.length === 0, problems };
}

module.exports = {
  fillSettings,
  ensureEnvKeys,
  checkRuntimeFiles,
  REQUIRED,
  REQUIRED_NESTED
};
