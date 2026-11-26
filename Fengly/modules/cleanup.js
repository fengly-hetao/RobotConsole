'use strict';
// 系统清理助手
// ============
// ① 扫描「安全软件 / 清理优化软件」—— 只认明确名单，避免误伤
// ② 调出它们的卸载程序（用户自己点确认，不做静默卸载）
// ③ 打开火绒官网
// ④ 系统文件修复（微软官方 sfc / DISM）
//
// 明确不动的：
//   · 网盘类（百度/阿里/夸克/115/OneDrive/迅雷/123…）
//   · 火绒（用户指定保留）
//   · 输入法、驱动、运行库

const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

// ============ 名单 ============

// 要清理的软件：进程名 / 显示名关键词
const TARGETS = [
  { key: '360',        label: '360 安全卫士',   names: ['360安全卫士', '360杀毒', '360 Total Security', '360safe', '360sd'], procs: ['360sd', '360tray', '360Safe', '360se', 'QHSafeTray', 'QHActiveDefense'] },
  { key: '360driver',  label: '360 驱动大师',   names: ['360驱动大师', '360DrvMgr'], procs: ['360DrvMgr', 'DrvMgr360'] },
  { key: 'ludashi',    label: '鲁大师',          names: ['鲁大师', 'LuDaShi'], procs: ['Ludashi', 'ludashi'] },
  { key: 'qqpcmgr',    label: '腾讯电脑管家',   names: ['腾讯电脑管家', 'QQPCMgr', '电脑管家'], procs: ['QQPCMgr', 'QQPCSoft', 'QMDL'] },
  { key: 'kingsoft',   label: '金山毒霸',        names: ['金山毒霸', 'Kingsoft Antivirus', '猎豹安全'], procs: ['kxetray', 'kavstart', 'kislive'] },
  { key: 'baidusd',    label: '百度卫士',        names: ['百度卫士', '百度杀毒'], procs: ['BaiduSd', 'baidusd'] },
  { key: '2345',       label: '2345 系列',       names: ['2345安全卫士', '2345加速浏览器', '2345看图王', '2345好压'], procs: ['2345Explorer', '2345Pic', 'HaoZip'] },
  { key: 'wisecare',   label: 'Wise Care',       names: ['Wise Care', 'WiseCleaner'], procs: ['WiseCare365', 'WiseDiskCleaner', 'WiseRegCleaner'] },
  { key: 'ccleaner',   label: 'CCleaner',        names: ['CCleaner'], procs: ['CCleaner', 'CCleaner64'] },
  { key: 'asc',        label: 'Advanced SystemCare', names: ['Advanced SystemCare', 'AdvancedSystemCare'], procs: ['ASC', 'AdvancedSystemCare'] },
  { key: 'glary',      label: 'Glary Utilities', names: ['Glary Utilities', 'Glarysoft'], procs: ['GlaryUtilities', 'Glary'] },
  { key: 'drivergenius', label: '驱动精灵',      names: ['驱动精灵', 'DriverGenius'], procs: ['DriverGenius', 'DrvGenius'] },
  { key: 'drivetheLife', label: '驱动人生',      names: ['驱动人生', 'DriveTheLife'], procs: ['DriveTheLife', 'DTLService'] },
  { key: 'ruanmei',    label: '软媒魔方',        names: ['软媒魔方', '软媒', 'RuanMei'], procs: ['RuanMei', 'pcmgr'] },
  { key: 'dism',       label: 'Dism++',          names: ['Dism++'], procs: ['Dism++', 'Dism++x64'] },
  { key: 'oneclick',   label: '一键清理类',      names: ['一键清理', '一键优化', '系统优化大师', '优化大师'], procs: [] }
];

// 绝不能动的（即使用户勾了也不给卸）
const PROTECTED = [
  { kind: 'cloud',  patterns: ['网盘', '百度网盘', 'BaiduNetdisk', '阿里云盘', 'Aliyun', '115', '夸克', 'Quark', '微云', 'Weiyun', '坚果云', 'OneDrive', '123云盘', '123pan', '迅雷', 'Thunder', '蓝奏云'] },
  { kind: 'huorong', patterns: ['火绒', 'Huorong'] },
  { kind: 'runtime', patterns: ['Microsoft Visual C++', '.NET', 'DirectX', 'Java', 'Python', 'Node.js', 'Electron'] },
  { kind: 'system',  patterns: ['Windows ', 'Microsoft Edge', 'Microsoft Store'] }
];

function isProtected(name) {
  if (!name) return { protected: false };
  for (const p of PROTECTED) {
    for (const pat of p.patterns) {
      if (name.toLowerCase().includes(pat.toLowerCase())) {
        return { protected: true, kind: p.kind };
      }
    }
  }
  return { protected: false };
}

function matchesTarget(name) {
  if (!name) return null;
  const low = name.toLowerCase();
  for (const t of TARGETS) {
    for (const n of t.names) {
      if (low.includes(n.toLowerCase())) return t;
    }
  }
  return null;
}

// ============ 读取已安装程序 ============

// ★ 把 PowerShell 脚本写成临时 .ps1 再执行：
//   直接用 -Command 拼多行脚本会被分号破坏 for 循环结构（实测读不到数据）。
//   .ps1 文件必须带 UTF-8 BOM，否则中文在 GBK 控制台下乱码。
function runPsFile(scriptBody, timeoutMs) {
  const os = require('os');
  const tmpDir = path.join(os.tmpdir(), 'rc-ps-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
  const file = path.join(tmpDir, 'run.ps1');

  // 写入带 BOM 的 UTF-8
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const body = Buffer.from(scriptBody, 'utf8');
  fs.writeFileSync(file, Buffer.concat([bom, body]));

  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -ExecutionPolicy Bypass -File "' + file + '"',
      { timeout: timeoutMs || 60000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
        resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

async function readUninstallEntries() {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$out = New-Object System.Collections.ArrayList
foreach ($p in $paths) {
  $items = Get-ItemProperty $p -ErrorAction SilentlyContinue
  foreach ($it in $items) {
    if (-not $it.DisplayName) { continue }
    $obj = [PSCustomObject]@{
      DisplayName        = [string]$it.DisplayName
      DisplayVersion     = [string]$it.DisplayVersion
      Publisher          = [string]$it.Publisher
      InstallLocation    = [string]$it.InstallLocation
      UninstallString    = [string]$it.UninstallString
      QuietUninstallString = [string]$it.QuietUninstallString
      InstallDate        = [string]$it.InstallDate
    }
    [void]$out.Add($obj)
  }
}
$out | ConvertTo-Json -Depth 3 -Compress
`;
  const r = await runPsFile(ps, 60000);
  try {
    const txt = r.stdout.trim();
    if (!txt) return [];
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : [j];
  } catch (e) { return []; }
}

// ============ 扫描 ============

async function scan() {
  const entries = await readUninstallEntries();
  const results = [];

  for (const e of entries) {
    const name = String(e.DisplayName || '').trim();
    if (!name) continue;

    const prot = isProtected(name);
    const tgt = matchesTarget(name);

    if (prot.protected) {
      // 记录为「已保护」，前端灰掉
      if (tgt || prot.kind === 'huorong' || prot.kind === 'cloud') {
        results.push({
          name,
          version: e.DisplayVersion || '',
          publisher: e.Publisher || '',
          installLocation: e.InstallLocation || '',
          uninstallString: e.UninstallString || '',
          matchedKey: tgt ? tgt.key : prot.kind,
          matchedLabel: tgt ? tgt.label : (prot.kind === 'huorong' ? '火绒（保留）' : prot.kind === 'cloud' ? '网盘（保留）' : '系统组件（保留）'),
          protected: true,
          protectKind: prot.kind
        });
      }
      continue;
    }

    if (tgt) {
      results.push({
        name,
        version: e.DisplayVersion || '',
        publisher: e.Publisher || '',
        installLocation: e.InstallLocation || '',
        uninstallString: e.UninstallString || '',
        matchedKey: tgt.key,
        matchedLabel: tgt.label,
        protected: false
      });
    }
  }

  // 额外：检查正在运行的相关进程（有些软件不写注册表）
  const procs = await listTargetProcs();

  return { ok: true, items: results, processes: procs };
}

async function listTargetProcs() {
  const allProcs = [];
  for (const t of TARGETS) {
    for (const p of t.procs) allProcs.push(p);
  }
  if (!allProcs.length) return Promise.resolve([]);

  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @(${allProcs.map((p) => `'${p}'`).join(',')})
$out = New-Object System.Collections.ArrayList
foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
  if ($names -contains $proc.ProcessName) {
    $pth = ''
    try { $pth = [string]$proc.Path } catch {}
    [void]$out.Add([PSCustomObject]@{ Id = $proc.Id; ProcessName = $proc.ProcessName; Path = $pth })
  }
}
$out | ConvertTo-Json -Compress
`;
  const r = await runPsFile(ps, 25000);
  try {
    const txt = r.stdout.trim();
    if (!txt) return [];
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : [j];
  } catch (e) { return []; }
}

// ============ 调出卸载程序 ============

/**
 * 分析卸载命令，拆成 exe + 参数
 */
function parseUninstallCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  const s = cmd.trim();

  // 形如 "C:\xxx\uninst.exe" /S  或  C:\xxx\uninst.exe
  let m = /^"([^"]+)"\s*(.*)$/.exec(s);
  if (m) return { exe: m[1], args: m[2].trim() };

  m = /^([^\s]+\.exe)\s*(.*)$/i.exec(s);
  if (m) return { exe: m[1], args: m[2].trim() };

  // MsiExec 之类
  m = /^([^\s]+exe)\b(.*)$/i.exec(s);
  if (m) return { exe: m[1], args: m[2].trim() };

  return null;
}

/**
 * 启动卸载程序（不静默，让用户自己点确认）
 * @param {{uninstallString:string, installLocation:string, name:string}} item
 */
async function launchUninstaller(item) {
  const cmd = item && item.uninstallString;
  if (!cmd) {
    return { ok: false, error: '这个软件没有提供卸载命令（可能是绿色版/便携版）' };
  }

  const parsed = parseUninstallCommand(cmd);
  if (!parsed) {
    return { ok: false, error: '无法解析卸载命令: ' + cmd.slice(0, 100) };
  }

  if (!fs.existsSync(parsed.exe)) {
    return { ok: false, error: '卸载程序不存在: ' + parsed.exe };
  }

  // 用 cmd start 启动，能正确处理带引号/空格的参数
  const full = '"' + parsed.exe + '"' + (parsed.args ? ' ' + parsed.args : '');
  return new Promise((resolve) => {
    exec('cmd /c start "" ' + full, { timeout: 15000, windowsHide: true }, (err) => {
      if (err) {
        // 退一步：直接用 shell 打开
        try {
          require('electron').shell.openPath(parsed.exe);
          resolve({ ok: true, exe: parsed.exe, note: '已通过 shell 打开（可能需要手动操作）' });
        } catch (e) {
          resolve({ ok: false, error: err.message });
        }
        return;
      }
      resolve({ ok: true, exe: parsed.exe, args: parsed.args });
    });
  });
}

/**
 * 打开软件安装目录（找不到就打开其卸载程序所在目录）
 */
function openInstallDir(item) {
  const shell = require('electron').shell;
  const candidates = [];

  if (item && item.installLocation) candidates.push(item.installLocation);
  if (item && item.uninstallString) {
    const parsed = parseUninstallCommand(item.uninstallString);
    if (parsed && parsed.exe) candidates.push(path.dirname(parsed.exe));
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      shell.openPath(c);
      return { ok: true, path: c };
    }
  }
  return { ok: false, error: '找不到安装目录' };
}

// ============ 火绒官网 ============

function openHuorongSite() {
  try {
    require('electron').shell.openExternal('https://www.huorong.cn/');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  scan,
  launchUninstaller,
  openInstallDir,
  openHuorongSite,
  parseUninstallCommand,
  readUninstallEntries,
  isProtected,
  matchesTarget,
  TARGETS,
  PROTECTED
};
