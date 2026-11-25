'use strict';
// 账号登录管理：退出登录时彻底清除自动登录信息
//
// 为什么要清这么多地方：
//   NapCat 的登录态分散在多个文件里，只清 settings.json 是不够的——
//   NapCat 自己会在 config 下按账号建配置文件，还会写 passkey.json。
//   只要 config 里还有 <账号> 后缀的文件，NapCat 下次启动就会尝试自动登录。
//
// 清除清单：
//   1. settings.json        → napcatAccount / napcatPasswordMd5 置空
//   2. config\napcat_<uin>.json          → 删
//   3. config\napcat_protocol_<uin>.json → 删
//   4. config\onebot11_<uin>.json        → 删（含该账号的网络配置）
//   5. config\passkey.json               → 清空为 {}
//   6. qq-data 下该账号的登录缓存         → 删（新版独立数据目录）
//   7. %APPDATA%\QQ\... 该账号的 quickLogin 缓存 → 尽力删（失败不报错）

const fs = require('fs');
const path = require('path');

function safeRm(p) {
  try {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      return true;
    }
  } catch (e) { return false; }
  return false;
}

function safeUnlink(p) {
  try {
    if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  } catch (e) { return false; }
  return false;
}

// 列出一个目录里所有形如 <prefix><数字>.json 的文件，返回 {名前缀, 账号}
function findAccountConfigs(dir, prefixes) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of entries) {
    for (const pre of prefixes) {
      if (!name.startsWith(pre) || !name.endsWith('.json')) continue;
      const mid = name.slice(pre.length, name.length - 5);
      // 账号是纯数字
      if (/^\d{5,12}$/.test(mid)) out.push({ name, account: mid, prefix: pre });
    }
  }
  return out;
}

/**
 * 退出登录：清除指定账号（或所有账号）的自动登录信息
 * @param {object} ctx
 * @param {string} ctx.runtimePath  运行时根目录
 * @param {string} [ctx.account]    只清这个账号；不传 = 清全部
 * @param {object} [ctx.store]      用来写回 settings.json 的 store 实例
 * @returns {{ok:boolean, removed:string[], failed:string[], accounts:string[]}}
 */
function logout(ctx) {
  const runtimePath = ctx && ctx.runtimePath;
  const store = ctx && ctx.store;
  const only = ctx && ctx.account ? String(ctx.account) : '';

  const removed = [];
  const failed = [];
  const accounts = new Set();

  if (!runtimePath) return { ok: false, error: '缺少 runtimePath', removed, failed, accounts: [] };

  const cfgDir = path.join(runtimePath, 'napcat', 'config');

  // ---------- 1. 找出所有账号的配置文件 ----------
  const PREFIXES = ['napcat_', 'napcat_protocol_', 'onebot11_'];
  const found = findAccountConfigs(cfgDir, PREFIXES);
  for (const f of found) accounts.add(f.account);

  // 从 settings 里也补一个账号进来
  let settingAccount = '';
  try {
    if (store) settingAccount = String(store.get('napcatAccount') || '');
  } catch (e) {}
  if (settingAccount) accounts.add(settingAccount);

  // ---------- 2. 决定要清哪些账号 ----------
  const targets = only ? [only] : Array.from(accounts);

  // ---------- 3. 删除该账号的 NapCat 配置文件 ----------
  for (const acc of targets) {
    for (const pre of PREFIXES) {
      const p = path.join(cfgDir, pre + acc + '.json');
      if (safeUnlink(p)) removed.push(pre + acc + '.json');
    }
    // qq-data 下该账号的登录缓存（新版独立数据目录）
    const qqDataAcc = path.join(runtimePath, 'qq-data', 'QQ', 'nt_qq', acc);
    if (safeRm(qqDataAcc)) removed.push('qq-data\\QQ\\nt_qq\\' + acc);
    const qqDataAcc2 = path.join(runtimePath, 'qq-data', acc);
    if (safeRm(qqDataAcc2)) removed.push('qq-data\\' + acc);
  }

  // ---------- 4. 清空 passkey.json ----------
  const passkey = path.join(cfgDir, 'passkey.json');
  try {
    if (fs.existsSync(passkey)) {
      fs.writeFileSync(passkey, '{}', 'utf8');
      removed.push('passkey.json （已清空）');
    }
  } catch (e) { failed.push('passkey.json'); }

  // ---------- 5. 清 settings 里的账号密码 ----------
  try {
    if (store) {
      if (only) {
        const cur = String(store.get('napcatAccount') || '');
        if (cur === only) {
          store.set('napcatAccount', '');
          store.set('napcatPasswordMd5', '');
          removed.push('settings.json: napcatAccount / napcatPasswordMd5');
        }
      } else {
        store.set('napcatAccount', '');
        store.set('napcatPasswordMd5', '');
        removed.push('settings.json: napcatAccount / napcatPasswordMd5');
      }
    }
  } catch (e) { failed.push('settings.json'); }

  // ---------- 6. 尽力清理官方 QQ 数据目录里的快速登录缓存 ----------
  // 只删路径里带该账号的 quickLogin 相关目录，慎删
  try {
    const roaming = process.env.APPDATA;
    if (roaming) {
      for (const acc of targets) {
        const candidates = [
          path.join(roaming, 'QQ', 'nt_qq', acc),
          path.join(roaming, 'QQ', 'nt_db', acc)
        ];
        for (const c of candidates) {
          // 只删 runtime 内部的，不碰全局的（避免动到用户自己的 QQ）
          if (c.includes('robot-bot-console') && safeRm(c)) removed.push(c);
        }
      }
    }
  } catch (e) {}

  return {
    ok: true,
    removed,
    failed,
    accounts: Array.from(accounts),
    clearedAccount: only || '(全部)'
  };
}

/**
 * 查询当前自动登录状态（给界面显示用）
 */
function getLoginState(ctx) {
  const runtimePath = ctx && ctx.runtimePath;
  const store = ctx && ctx.store;
  const out = {
    account: '',
    hasPassword: false,
    autoLoginReady: false,
    configFiles: [],
    configsDir: ''
  };
  if (!runtimePath) return out;

  try {
    if (store) {
      out.account = String(store.get('napcatAccount') || '');
      out.hasPassword = !!String(store.get('napcatPasswordMd5') || '');
    }
  } catch (e) {}

  const cfgDir = path.join(runtimePath, 'napcat', 'config');
  out.configsDir = cfgDir;
  out.configFiles = findAccountConfigs(cfgDir, ['napcat_', 'napcat_protocol_', 'onebot11_'])
    .map((f) => f.name);

  // 有账号 + 有密码 + NapCat 侧有对应配置 = 会自动登录
  out.autoLoginReady = !!(out.account && out.hasPassword &&
    out.configFiles.some((n) => n.includes(out.account)));

  return out;
}

module.exports = { logout, getLoginState, findAccountConfigs };
