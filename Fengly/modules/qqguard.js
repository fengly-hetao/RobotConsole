'use strict';
// QQ 自动更新拦截
// ================
// 目标：让 QQ 检测不到新版本 → 不自动更新
//
// 三层防护（按可靠性排序）：
//   ① runtime QQ 只读锁定 —— 把 runtime\qq 目录下的版本文件设为只读
//      QQ 即使下载了更新包也解压不进去，更新失败后继续用旧版
//   ② 备份 + 版本守护 —— 启动时比对 QQ.exe 版本，发现被改就告警并可用备份还原
//   ③ hosts 屏蔽（需要管理员）—— 把 QQ 更新服务器指向 127.0.0.1
//      非管理员时自动跳过，并提示用户
//
// 注意：hosts 屏蔽会影响官方 QQ 的更新，代码里做成「可选」，
//       默认只保护 runtime QQ（机器人用的那个）。

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// QQ 更新相关域名
const QQ_UPDATE_HOSTS = [
  'qqdl.gtimg.cn',
  'dl.qq.com',
  'ntd.qq.com',
  'update.qq.com',
  'upd.qq.com',
  'cdn-go.cn',
  'qq-web.cdn-go.cn',
  'framework.cdn-go.cn'
];

// ============ ① 锁定 runtime QQ ============

/**
 * 把 runtime\qq 下的所有文件设为只读（递归）
 * 这样 QQ 自己的热更新解压会失败，版本保持不变
 */
async function lockRuntimeQQ(runtimePath, onLine) {
  const cb = onLine || (() => {});
  const qqDir = path.join(runtimePath, 'qq');
  if (!fs.existsSync(qqDir)) {
    return { ok: false, error: 'runtime\qq 目录不存在' };
  }

  let locked = 0, failed = 0, skipped = 0;

  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      // 只锁 .exe / .dll / .pak / .asar 这些更新会替换的文件
      if (!/\.(exe|dll|pak|asar|json|dat|bin)$/i.test(e.name)) { skipped++; continue; }
      try {
        const st = fs.statSync(full);
        if (st.isReadOnly || (st.mode & 0o200) === 0) { skipped++; continue; }
        fs.chmodSync(full, 0o444);
        locked++;
      } catch (err) {
        failed++;
      }
    }
  };

  try {
    walk(qqDir);

    // ★ 关键补充：光锁文件不够，QQ 还能在 versions\ 下新建版本目录再解压。
    //   这里给 versions 目录加一条「拒绝写入」的 ACL，从目录层面堵住。
    const versionsDir = path.join(qqDir, 'versions');
    let aclOk = false;
    if (fs.existsSync(versionsDir)) {
      aclOk = await denyWriteAcl(versionsDir);
      if (aclOk) cb('已禁止 versions 目录写入（防止新建版本目录）');
      else cb('⚠️ versions 目录 ACL 设置失败（可能缺管理员权限），请继续用 hosts 屏蔽');
    }

    cb(`已锁定 ${locked} 个文件${failed ? '，' + failed + ' 个失败' : ''}${skipped ? '，跳过 ' + skipped + ' 个' : ''}`);
    return { ok: true, locked, failed, skipped, dir: qqDir, aclOk };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 给目录加「当前用户拒绝写入」ACL
function denyWriteAcl(dir) {
  return new Promise((resolve) => {
    const user = process.env.USERNAME;
    // icacls: 拒绝 当前用户 对目录的 (创建文件/数据写入/追加数据/删除子目录)
    const cmd = `icacls "${dir}" /deny "${user}:(WD,AD,WEA,WA)"`;
    exec(cmd, { timeout: 20000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      // 不靠输出文字判断（中英文/编码差异大），改为实测能否写入
      const probe = path.join(dir, '.rc-acl-probe-' + Date.now());
      let blocked = false;
      try {
        fs.writeFileSync(probe, 'x');
        // 能写 → 没锁住，清理探测文件
        try { fs.unlinkSync(probe); } catch (e) {}
        blocked = false;
      } catch (e) {
        blocked = true;
      }
      resolve(blocked);
    });
  });
}

// 移除目录的拒绝写入 ACL
function undenyWriteAcl(dir) {
  return new Promise((resolve) => {
    const user = process.env.USERNAME;
    const cmd = `icacls "${dir}" /remove:d "${user}"`;
    exec(cmd, { timeout: 20000, windowsHide: true, encoding: 'utf8' }, (err) => resolve(!err));
  });
}

/**
 * 解除只读锁定（还原/升级时用）
 */
async function unlockRuntimeQQ(runtimePath, onLine) {
  const cb = onLine || (() => {});
  const qqDir = path.join(runtimePath, 'qq');
  if (!fs.existsSync(qqDir)) return { ok: false, error: '目录不存在' };

  let unlocked = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      try {
        const st = fs.statSync(full);
        if (st.isReadOnly || (st.mode & 0o200) === 0) {
          fs.chmodSync(full, 0o666);
          unlocked++;
        }
      } catch (err) {}
    }
  };
  walk(qqDir);
  const versionsDir = path.join(qqDir, 'versions');
  if (fs.existsSync(versionsDir)) await undenyWriteAcl(versionsDir);
  cb(`已解除 ${unlocked} 个文件的锁定`);
  return { ok: true, unlocked };
}

/**
 * 检查锁定状态
 */
async function getLockState(runtimePath) {
  const qqDir = path.join(runtimePath, 'qq');
  if (!fs.existsSync(qqDir)) return { ok: false, error: '目录不存在' };

  let locked = 0, writable = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(exe|dll|pak|asar|json|dat|bin)$/i.test(e.name)) continue;
      try {
        const st = fs.statSync(full);
        if (st.isReadOnly || (st.mode & 0o200) === 0) locked++;
        else writable++;
      } catch (err) {}
    }
  };
  walk(qqDir);
  return { ok: true, locked, writable, total: locked + writable };
}

// ============ ② 版本备份 / 守护 ============

function readQQVersion(qqDir) {
  const exe = path.join(qqDir, 'QQ.exe');
  if (!fs.existsSync(exe)) return '';
  try {
    const { execSync } = require('child_process');
    const v = execSync(
      `powershell -NoProfile -Command "(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion"`,
      { timeout: 8000, windowsHide: true, encoding: 'utf8' }
    );
    return String(v || '').trim();
  } catch (e) { return ''; }
}

/**
 * 记录当前 QQ 版本到文件（作为"已知良好版本"）
 */
function saveVersionBaseline(runtimePath) {
  const qqDir = path.join(runtimePath, 'qq');
  const ver = readQQVersion(qqDir);
  if (!ver) return { ok: false, error: '读不到 QQ 版本' };

  const verFile = path.join(runtimePath, 'qq-version-baseline.json');
  const data = {
    version: ver,
    recordedAt: new Date().toISOString(),
    qqDir
  };
  try {
    fs.writeFileSync(verFile, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, version: ver };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 比对当前版本与基线
 */
function checkVersionDrift(runtimePath) {
  const qqDir = path.join(runtimePath, 'qq');
  const cur = readQQVersion(qqDir);
  const verFile = path.join(runtimePath, 'qq-version-baseline.json');

  let baseline = '';
  try {
    const j = JSON.parse(fs.readFileSync(verFile, 'utf8'));
    baseline = String(j.version || '');
  } catch (e) {}

  return {
    ok: true,
    current: cur,
    baseline,
    drifted: !!(baseline && cur && baseline !== cur),
    hasBaseline: !!baseline
  };
}

// ============ ③ hosts 屏蔽 ============

function isElevated() {
  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"',
      { timeout: 12000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => resolve(!err && String(stdout || '').trim().toLowerCase() === 'true')
    );
  });
}

function hostsPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
}

const HOSTS_MARK_BEGIN = '# === RobotConsole: 阻止 QQ 自动更新 BEGIN ===';
const HOSTS_MARK_END = '# === RobotConsole: 阻止 QQ 自动更新 END ===';

/**
 * 把 QQ 更新域名写进 hosts（指向 127.0.0.1）
 */
async function applyHostsBlock(onLine) {
  const cb = onLine || (() => {});
  const elevated = await isElevated();
  if (!elevated) {
    return { ok: false, error: '需要管理员权限才能修改 hosts', needAdmin: true };
  }

  const hp = hostsPath();
  let content = '';
  try { content = fs.readFileSync(hp, 'utf8'); } catch (e) { content = ''; }

  // 已有标记块 → 先移除
  const re = new RegExp(HOSTS_MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + HOSTS_MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?', 'g');
  content = content.replace(re, '');

  const block = [
    HOSTS_MARK_BEGIN,
    '# 由「机器人控制台」写入，用于阻止 QQ 自动更新',
    ...QQ_UPDATE_HOSTS.map((h) => `127.0.0.1  ${h}`),
    HOSTS_MARK_END,
    ''
  ].join('\n');

  try {
    fs.writeFileSync(hp, content.trimEnd() + '\n\n' + block, 'utf8');
    // 刷新 DNS
    await new Promise((r) => exec('ipconfig /flushdns', { windowsHide: true, timeout: 15000 }, () => r()));
    cb(`已屏蔽 ${QQ_UPDATE_HOSTS.length} 个更新域名`);
    return { ok: true, count: QQ_UPDATE_HOSTS.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 移除 hosts 屏蔽
 */
async function removeHostsBlock() {
  const elevated = await isElevated();
  if (!elevated) return { ok: false, error: '需要管理员权限', needAdmin: true };

  const hp = hostsPath();
  let content = '';
  try { content = fs.readFileSync(hp, 'utf8'); } catch (e) { return { ok: false, error: '读不到 hosts' }; }

  const re = new RegExp('\\n?' + HOSTS_MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + HOSTS_MARK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n?', 'g');
  const before = content.length;
  content = content.replace(re, '\n');
  if (content.length === before) return { ok: true, removed: false };

  try {
    fs.writeFileSync(hp, content, 'utf8');
    await new Promise((r) => exec('ipconfig /flushdns', { windowsHide: true, timeout: 15000 }, () => r()));
    return { ok: true, removed: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 检查 hosts 是否已屏蔽
 */
function getHostsState() {
  const hp = hostsPath();
  let content = '';
  try { content = fs.readFileSync(hp, 'utf8'); } catch (e) {}
  return {
    ok: true,
    blocked: content.includes(HOSTS_MARK_BEGIN),
    hostsPath: hp
  };
}

// ============ 综合状态 ============

async function getProtectState(runtimePath) {
  const elevation = await isElevated();
  const lock = await getLockState(runtimePath);
  const drift = checkVersionDrift(runtimePath);
  const hosts = getHostsState();

  return {
    ok: true,
    elevated: elevation,
    lock,
    version: drift,
    hosts,
    protected: (lock.ok && lock.writable === 0) || hosts.blocked
  };
}

module.exports = {
  lockRuntimeQQ,
  unlockRuntimeQQ,
  getLockState,
  readQQVersion,
  saveVersionBaseline,
  checkVersionDrift,
  applyHostsBlock,
  removeHostsBlock,
  getHostsState,
  getProtectState,
  isElevated,
  denyWriteAcl,
  undenyWriteAcl,
  QQ_UPDATE_HOSTS
};
