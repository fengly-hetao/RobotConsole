'use strict';
// 插件管理：浏览 / 启用 / 禁用 / 安装 / 删除
// 支持两类插件：
//   ① NoneBot 插件（Python，在 runtime/tianlu_bot/plugins/ 下）
//   ② NapCat 插件 （JS/TS，在 runtime/napcat/plugins/ 下）
//
// NoneBot 插件的启用状态存在 runtime/tianlu_bot/plugins.json：
//   { "disabled": ["games"], "extra": ["my_plugin"] }
// bot.py 启动时读取该文件决定加载哪些插件。

const fs = require('fs');
const path = require('path');

// NoneBot 内置插件（出厂自带，不可删除，只能禁用）
const BUILTIN_NONEBOT = ['core', 'system', 'games', 'ai_chat', 'monitor', 'poke', 'feedback'];
// core 是地基（配置/模型注册表），禁用会导致一切崩溃，强制不可禁用
const PROTECTED = ['core'];

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function writeJsonAtomic(p, data) {
  const tmp = p + '.tmp-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try { fs.renameSync(tmp, p); }
  catch (e) { fs.copyFileSync(tmp, p); try { fs.unlinkSync(tmp); } catch (e2) {} }
}

function pluginConfigPath(runtimePath) {
  return path.join(runtimePath, 'tianlu_bot', 'plugins.json');
}

function loadPluginConfig(runtimePath) {
  const cfg = readJsonSafe(pluginConfigPath(runtimePath), {});
  return {
    disabled: Array.isArray(cfg.disabled) ? cfg.disabled.map(String) : [],
    extra: Array.isArray(cfg.extra) ? cfg.extra.map(String) : []
  };
}

function savePluginConfig(runtimePath, cfg) {
  writeJsonAtomic(pluginConfigPath(runtimePath), {
    disabled: Array.from(new Set(cfg.disabled || [])),
    extra: Array.from(new Set(cfg.extra || []))
  });
}

// 读插件元信息：优先读 plugin 目录下的单独描述文件，否则从 __init__.py 猜
function readNonebotMeta(dir, name) {
  const meta = { name, description: '', version: '', author: '' };
  // NoneBot 插件通常把元信息写在 __init__.py 里的 PluginMetadata
  const initPy = path.join(dir, '__init__.py');
  try {
    const src = fs.readFileSync(initPy, 'utf8');
    const grab = (field) => {
      // 匹配形如  description = "xxx"  或  version = '1.0.0'
      const re = new RegExp('(?:^|\\n)\\s*' + field + '\\s*=\\s*["\']([^"\']+)["\']', 'i');
      const m = re.exec(src);
      return m ? m[1] : '';
    };
    meta.description = grab('description');
    meta.version = grab('version');
    meta.author = grab('author');
    if (!meta.description) {
      // 退一步：找文件头部注释
      const m = /"""([\s\S]{1,200}?)"""/.exec(src);
      if (m) meta.description = m[1].trim().split('\n')[0];
    }
  } catch (e) {}
  return meta;
}

// 列出一个目录下的插件（简单名，不含路径）
function listSimplePlugins(dir, builtinList) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('__') || e.name.startsWith('.')) continue;
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    const hasInit = fs.existsSync(path.join(full, '__init__.py'));
    if (!hasInit) continue;
    const meta = readNonebotMeta(full, e.name);
    meta.builtin = builtinList ? builtinList.includes(e.name) : false;
    meta.protected = PROTECTED.includes(e.name);
    meta.path = full;
    out.push(meta);
  }
  return out.sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------- NoneBot 插件 ----------
function listNonebotPlugins(runtimePath) {
  const dir = path.join(runtimePath, 'tianlu_bot', 'plugins');
  const cfg = loadPluginConfig(runtimePath);
  const items = listSimplePlugins(dir, BUILTIN_NONEBOT);
  for (const it of items) {
    it.type = 'nonebot';
    it.enabled = !cfg.disabled.includes(it.name);
    it.removable = !it.builtin;
  }
  // 配置里登记但目录已不存在的（用户手动删了）→ 标出来
  const existing = new Set(items.map((i) => i.name));
  for (const name of cfg.extra) {
    if (!existing.has(name)) {
      items.push({
        type: 'nonebot', name, description: '（插件目录已不存在）',
        version: '', author: '', builtin: false, protected: false,
        enabled: false, removable: true, missing: true
      });
    }
  }
  return items;
}

function setNonebotEnabled(runtimePath, name, enabled) {
  if (PROTECTED.includes(name)) {
    return { ok: false, error: '「' + name + '」是核心插件，不能禁用' };
  }
  const cfg = loadPluginConfig(runtimePath);
  const set = new Set(cfg.disabled);
  if (enabled) set.delete(name); else set.add(name);
  cfg.disabled = Array.from(set);
  savePluginConfig(runtimePath, cfg);
  return { ok: true };
}

// 从 zip 安装 NoneBot 插件
// zip 里应包含一个插件目录（含 __init__.py），或直接就是插件内容
function installNonebotPlugin(runtimePath, zipPath, onLog) {
  const AdmZip = require('adm-zip');
  const log = onLog || (() => {});
  const pluginsDir = path.join(runtimePath, 'tianlu_bot', 'plugins');

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (!entries.length) return { ok: false, error: 'zip 是空的' };

  // 判断结构：找 __init__.py 的位置
  let rootPrefix = '';
  const initEntry = entries.find((e) => /(^|\/)__init__\.py$/.test(e.entryName));
  if (!initEntry) {
    return { ok: false, error: '不是有效的 NoneBot 插件：zip 里找不到 __init__.py' };
  }
  // 顶层层级（如 myplugin/__init__.py → rootPrefix = myplugin/）
  const parts = initEntry.entryName.split('/');
  const pluginName = parts.length >= 2 ? parts[parts.length - 2] : '';
  if (!pluginName) {
    return { ok: false, error: '插件结构不对：__init__.py 应放在一个子目录里' };
  }
  rootPrefix = parts.slice(0, parts.length - 1).join('/') + '/';

  const dest = path.join(pluginsDir, pluginName);
  if (fs.existsSync(dest)) {
    return { ok: false, error: '插件「' + pluginName + '」已存在，请先删除旧版本' };
  }

  log('正在解压到 ' + dest + ' …');
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith(rootPrefix)) continue;
    const rel = entry.entryName.slice(rootPrefix.length);
    if (!rel || rel.includes('..')) continue;
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    count++;
  }
  if (!count) {
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e) {}
    return { ok: false, error: '解压出 0 个文件，zip 结构异常' };
  }
  log('已解压 ' + count + ' 个文件');

  // 新装的自动加入 extra（启用）
  const cfg = loadPluginConfig(runtimePath);
  if (!cfg.extra.includes(pluginName)) cfg.extra.push(pluginName);
  cfg.disabled = cfg.disabled.filter((n) => n !== pluginName);
  savePluginConfig(runtimePath, cfg);

  return { ok: true, name: pluginName, files: count };
}

function removeNonebotPlugin(runtimePath, name) {
  if (BUILTIN_NONEBOT.includes(name)) {
    return { ok: false, error: '内置插件不能删除，只能禁用' };
  }
  const dir = path.join(runtimePath, 'tianlu_bot', 'plugins', name);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    const cfg = loadPluginConfig(runtimePath);
    cfg.extra = cfg.extra.filter((n) => n !== name);
    cfg.disabled = cfg.disabled.filter((n) => n !== name);
    savePluginConfig(runtimePath, cfg);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- NapCat 插件 ----------
// NapCat 插件是 JS/TS 包，放在 runtime/napcat/plugins/<name>/，
// 通过 NapCat 配置里的 network.plugins 数组启用（由 NapCat 自己加载）。
function listNapcatPlugins(runtimePath) {
  const dir = path.join(runtimePath, 'napcat', 'plugins');
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }

  // NapCat 侧启用列表在 onebot11*.json 的 network.plugins
  const cfgDir = path.join(runtimePath, 'napcat', 'config');
  let enabledNames = [];
  try {
    const files = fs.readdirSync(cfgDir).filter((f) => /^onebot11(_\d+)?\.json$/.test(f));
    const all = new Set();
    for (const f of files) {
      const j = readJsonSafe(path.join(cfgDir, f), null);
      const list = j && j.network && Array.isArray(j.network.plugins) ? j.network.plugins : [];
      for (const p of list) if (p && p.name) all.add(String(p.name));
    }
    enabledNames = Array.from(all);
  } catch (e) {}

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    const pkg = readJsonSafe(path.join(full, 'package.json'), null);
    out.push({
      type: 'napcat',
      name: (pkg && pkg.name) || e.name,
      dirName: e.name,
      description: (pkg && pkg.description) || '',
      version: (pkg && pkg.version) || '',
      author: (pkg && (typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name))) || '',
      builtin: e.name === 'napcat-plugin-builtin',
      protected: e.name === 'napcat-plugin-builtin',
      enabled: enabledNames.includes(e.name) || e.name === 'napcat-plugin-builtin',
      removable: e.name !== 'napcat-plugin-builtin',
      path: full
    });
  }
  return out.sort((a, b) => (a.builtin !== b.builtin ? (a.builtin ? -1 : 1) : a.name.localeCompare(b.name)));
}

function setNapcatEnabled(runtimePath, name, enabled) {
  if (name === 'napcat-plugin-builtin') {
    return { ok: false, error: '内置插件不能禁用' };
  }
  const cfgDir = path.join(runtimePath, 'napcat', 'config');
  let touched = 0;
  try {
    const files = fs.readdirSync(cfgDir).filter((f) => /^onebot11(_\d+)?\.json$/.test(f));
    for (const f of files) {
      const p = path.join(cfgDir, f);
      const j = readJsonSafe(p, null);
      if (!j) continue;
      if (!j.network) j.network = {};
      if (!Array.isArray(j.network.plugins)) j.network.plugins = [];
      const idx = j.network.plugins.findIndex((x) => x && String(x.name) === name);
      if (enabled) {
        if (idx < 0) j.network.plugins.push({ name, enable: true });
        else j.network.plugins[idx].enable = true;
      } else if (idx >= 0) {
        j.network.plugins.splice(idx, 1);
      }
      writeJsonAtomic(p, j);
      touched++;
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!touched) return { ok: false, error: '找不到 onebot11 配置文件' };
  return { ok: true, touched };
}

// ---------- 统一入口 ----------
function listAll(runtimePath) {
  return {
    nonebot: listNonebotPlugins(runtimePath),
    napcat: listNapcatPlugins(runtimePath),
    pluginsDir: {
      nonebot: path.join(runtimePath, 'tianlu_bot', 'plugins'),
      napcat: path.join(runtimePath, 'napcat', 'plugins')
    }
  };
}

module.exports = {
  listAll, listNonebotPlugins, listNapcatPlugins,
  setNonebotEnabled, setNapcatEnabled,
  installNonebotPlugin, removeNonebotPlugin,
  loadPluginConfig, savePluginConfig,
  BUILTIN_NONEBOT, PROTECTED
};
