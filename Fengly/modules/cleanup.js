'use strict';
// 系统清理助手
// ============
// ① 扫描「安全软件 / 清理优化软件 / 广告弹窗类软件」
//    · 注册表卸载列表（正规安装的程序）
//    · Program Files 等目录（绿色版 / 便携版，不写注册表也能找到）
// ② 调出它们的卸载程序（用户自己点确认，不做静默卸载）
// ③ 打开软件安装目录
// ④ 打开火绒官网
// ⑤ 系统文件修复（微软官方 sfc / DISM）
//
// 明确不动的：网盘类、火绒、输入法、驱动、运行库

const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

// ============ 要清理的软件：进程名 / 显示名 / 目录名关键词 ============

const TARGETS = [
  {
    key: '360', label: '360 系列',
    names: ['360安全卫士', '360杀毒', '360 Total Security', '360安全浏览器', '360极速浏览器', '360压缩', '360驱动大师'],
    procs: ['360sd', '360tray', '360Safe', '360se', '360ChromeX', 'QHSafeTray', 'QHActiveDefense', '360DrvMgr', '360zip'],
    dirs: ['360Safe', '360sd', '360se', '360ChromeX', '360zip', '360DrvMgr', '360Rec', '360SoftMgr']
  },
  {
    key: 'ludashi', label: '鲁大师',
    names: ['鲁大师', 'LuDaShi'],
    procs: ['Ludashi', 'ludashi', 'LuDaShi'],
    dirs: ['LuDaShi', '鲁大师']
  },
  {
    key: 'qqpcmgr', label: '腾讯电脑管家',
    names: ['腾讯电脑管家', 'QQPCMgr', '电脑管家'],
    procs: ['QQPCMgr', 'QQPCSoft', 'QMDL', 'QQPCTray'],
    dirs: ['QQPCMgr']   // 不能写 'Tencent'，否则 QQ/微信的父目录会被误判
  },
  {
    key: 'kingsoft', label: '金山毒霸',
    names: ['金山毒霸', 'Kingsoft Antivirus', '猎豹安全', '金山WPS热点'],
    procs: ['kxetray', 'kavstart', 'kislive', 'ksafe'],
    dirs: ['kav', 'ksafe', 'Kingsoft\\kav', 'Kingsoft\\ksafe']   // 不能只写 Kingsoft（WPS 也在里面）
  },
  {
    key: 'baidu', label: '百度卫士',
    names: ['百度卫士', '百度杀毒', '百度浏览器'],
    procs: ['BaiduSd', 'baidusd', 'BaiduBrowser'],
    dirs: ['BaiduSd', 'Baidu\\BaiduSd']   // 百度网盘在 Baidu 下，不能整个算
  },
  {
    key: '2345', label: '2345 系列',
    names: ['2345安全卫士', '2345加速浏览器', '2345看图王', '2345好压', '2345软件管家'],
    procs: ['2345Explorer', '2345Pic', 'HaoZip', '2345SoftMgr'],
    dirs: ['2345Soft', '2345Explorer', '2345', 'Haozip']
  },
  {
    key: 'wisecare', label: 'Wise Care',
    names: ['Wise Care', 'WiseCleaner', 'Wise Disk Cleaner', 'Wise Registry Cleaner'],
    procs: ['WiseCare365', 'WiseDiskCleaner', 'WiseRegCleaner'],
    dirs: ['Wise Care 365', 'WiseCleaner', 'Wise']
  },
  {
    key: 'ccleaner', label: 'CCleaner',
    names: ['CCleaner', 'Piriform'],
    procs: ['CCleaner', 'CCleaner64'],
    dirs: ['CCleaner']
  },
  {
    key: 'asc', label: 'Advanced SystemCare',
    names: ['Advanced SystemCare', 'AdvancedSystemCare', 'IObit'],
    procs: ['ASC', 'AdvancedSystemCare', 'IObitUninstaler'],
    dirs: ['Advanced SystemCare', 'IObit']
  },
  {
    key: 'glary', label: 'Glary Utilities',
    names: ['Glary Utilities', 'Glarysoft'],
    procs: ['GlaryUtilities', 'Glary'],
    dirs: ['Glary Utilities', 'Glarysoft']
  },
  {
    key: 'drivergenius', label: '驱动精灵',
    names: ['驱动精灵', 'DriverGenius', '驱动之家'],
    procs: ['DriverGenius', 'DrvGenius'],
    dirs: ['DriverGenius', '驱动精灵']
  },
  {
    key: 'drivethelife', label: '驱动人生',
    names: ['驱动人生', 'DriveTheLife'],
    procs: ['DriveTheLife', 'DTLService'],
    dirs: ['DriveTheLife', '驱动人生']
  },
  {
    key: 'ruanmei', label: '软媒魔方',
    names: ['软媒魔方', '软媒', 'RuanMei', '魔方'],
    procs: ['RuanMei', 'pcmgr', 'RuanmeiSoft'],
    dirs: ['Ruanmei', '软媒', 'RuanMeiSoft']
  },
  {
    key: 'dism', label: 'Dism++',
    names: ['Dism++'],
    procs: ['Dism++', 'Dism++x64'],
    dirs: ['Dism++']
  },
  {
    key: 'oneclick', label: '一键清理 / 优化',
    names: ['一键清理', '一键优化', '系统优化大师', '优化大师', '系统清理', '电脑优化', '优化管家', '清理大师'],
    procs: [],
    dirs: ['一键清理', '优化大师', '优化管家', '清理大师', '电脑优化']
  },
  {
    key: 'adware', label: '广告弹窗 / 捆绑软件',
    names: ['快压', '迅雷看看', 'Hao123', '桔子浏览器', '2345', '百度影音', '暴风影音', 'PPTV', '爱奇艺万能播放器', '搜狗高速浏览器', '今日热点', '焦点弹窗'],
    procs: ['kztray', 'Hao123', 'BaiduPlayer', 'StormPlayer', 'SogouExplorer', 'SGTool', 'PopTip', 'AdService'],
    dirs: ['kuaiya', '快压', 'Hao123', 'BaiduPlayer', 'Storm', 'SogouExplorer', 'Sogou', 'PPTV']
  },
  {
    key: 'cursor', label: '光标 / 鼠标特效',
    names: ['CursorZoom', 'Cursor', '鼠标特效', '光标放大'],
    procs: ['CursorZoom', 'CursorFX'],
    dirs: ['CursorZoom', 'CursorFX']
  },
  {
    key: 'renamer', label: '批量改名 / 批处理工具',
    names: ['BatchRenamer', 'Renamer', '批量改名', 'Advanced Renamer', 'ReNamer'],
    procs: ['BatchRenamer', 'ReNamer', 'AdvancedRenamer'],
    dirs: ['BatchRenamer', 'ReNamer', 'Advanced Renamer', 'renamer']
  }
];

// 绝不能动的
const PROTECTED = [
  { kind: 'cloud', patterns: ['网盘', '百度网盘', 'BaiduNetdisk', '阿里云盘', 'Aliyun', '115', '夸克', 'Quark', '微云', 'Weiyun', '坚果云', 'OneDrive', '123云盘', '123pan', '迅雷', 'Thunder', '蓝奏云', '天翼云', '腾讯微云'] },
  { kind: 'huorong', patterns: ['火绒', 'Huorong', 'hrsword', 'hipsmain', 'hrwscfg'] },
  { kind: 'runtime', patterns: ['Microsoft Visual C++', '.NET', 'DirectX', 'Java', 'Python', 'Node.js', 'Electron', 'Microsoft Edge', 'Windows App'] },
  { kind: 'system', patterns: ['Windows ', 'Microsoft Store', 'Microsoft Office', 'Windows Defender'] },
  // 常用正常软件，避免误伤
  { kind: 'normal', patterns: ['Chrome', 'Firefox', 'Edge', 'WinRAR', '7-Zip', 'Notepad++', 'VSCode', 'Visual Studio Code', 'Git', 'QQ', 'WeChat', '微信', '钉钉', 'DingTalk', 'WPS', 'Steam', 'Discord'] }
];

'use strict';

/**
 * 判断某个软件是否受保护（不能被清理）。
 *
 * 关键规则：**先看是否命中清理目标**。
 * 因为宽松的保护词会误伤，例如：
 *   · 'QQ' 会命中 'QQPCMgr'（腾讯电脑管家，本该清理）
 *   · '360' 会命中 '360Safe'
 * 所以目标优先，只有网盘/火绒这类明确的例外才覆盖。
 */
function isProtected(name) {
  if (!name) return { protected: false };
  const low = String(name).toLowerCase();

  const CLOUD_WORDS = ['网盘', 'baidunetdisk', '百度网盘', '阿里云盘', 'aliyun', 'quark', '夸克',
    '115', 'onedrive', '坚果云', 'nutstore', 'weiyun', '微云', '123云盘', '123pan',
    '迅雷', 'thunder', '蓝奏云', '天翼云', '360云盘'];
  const HUORONG_WORDS = ['火绒', 'huorong', 'hrsword', 'hipsmain', 'hrwscfg'];

  const tgt = matchesTarget(name);
  if (tgt) {
    for (const w of CLOUD_WORDS) if (low.includes(w)) return { protected: true, kind: 'cloud' };
    for (const w of HUORONG_WORDS) if (low.includes(w)) return { protected: true, kind: 'huorong' };
    return { protected: false };
  }

  for (const p of PROTECTED) {
    for (const pat of p.patterns) {
      const pl = pat.toLowerCase();
      if (p.kind === 'normal' || p.kind === 'system') {
        // 严格匹配：整个名字相等，或以「空格/横线/下划线」分隔的独立词
        if (low === pl) return { protected: true, kind: p.kind };
        const escaped = pl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(^|[\\s_\\-])' + escaped + '($|[\\s_\\-])', 'i');
        if (re.test(low)) return { protected: true, kind: p.kind };
      } else {
        if (low.includes(pl)) return { protected: true, kind: p.kind };
      }
    }
  }
  return { protected: false };
}

function matchesTarget(name) {
  if (!name) return null;
  const low = String(name).toLowerCase();
  for (const t of TARGETS) {
    for (const n of t.names) {
      if (low.includes(n.toLowerCase())) return t;
    }
    // 目录名精确匹配
    for (const d of t.dirs) {
      const base = d.split('\\').pop();
      if (low === base.toLowerCase()) return t;
    }
  }
  return null;
}

// ============ PowerShell 执行辅助 ============

let _psTmpDir = '';

function runPsFile(buffer, timeoutMs) {
  const os = require('os');
  const tmpDir = path.join(os.tmpdir(), 'rc-ps-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
  const file = path.join(tmpDir, 'run.ps1');
  try {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(file, Buffer.concat([bom, Buffer.from(buffer, 'utf8')]));
  } catch (e) { /* ignore */ }

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

// ============ 读取已安装程序（注册表） ============

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
      RegistryKey        = [string]$it.PSChildName
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

// ============ 扫描安装目录（绿色软件 / 便携软件） ============

function getScanDirs() {
  const dirs = [];
  const env = process.env;

  // 常见程序目录
  if (env['ProgramFiles']) dirs.push({ dir: env['ProgramFiles'], scope: 'Program Files' });
  if (env['ProgramFiles(x86)']) dirs.push({ dir: env['ProgramFiles(x86)'], scope: 'Program Files (x86)' });
  if (env['ProgramW6432'] && env['ProgramW6432'] !== env['ProgramFiles']) {
    dirs.push({ dir: env['ProgramW6432'], scope: 'Program Files (64)' });
  }
  if (env['LOCALAPPDATA']) {
    dirs.push({ dir: path.join(env['LOCALAPPDATA'], 'Programs'), scope: '用户目录' });
    dirs.push({ dir: env['LOCALAPPDATA'], scope: 'AppData\\Local' });
  }
  // 其他盘符的常见位置（用户可能装在 D:\ 或 F:\）
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    for (const sub of ['Program Files', 'Program Files (x86)', '软件', 'Programs']) {
      const p = drive + ':\\' + sub;
      try {
        if (fs.existsSync(p) && !dirs.some((d) => d.dir.toLowerCase() === p.toLowerCase())) {
          dirs.push({ dir: p, scope: drive + ':\\' + sub });
        }
      } catch (e) {}
    }
  }
  return dirs;
}

/**
 * 扫目录：找出与 TARGETS 匹配的软件文件夹（绿色版也能发现）
 */
function scanDirectories() {
  const results = [];
  const dirs = getScanDirs();

  for (const { dir, scope } of dirs) {
    let subs = [];
    try {
      subs = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) { continue; }

    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      const full = path.join(dir, sub.name);

      // 保护规则优先
      const prot = isProtected(sub.name);
      if (prot.protected) continue;

      const tgt = matchesTarget(sub.name);
      if (!tgt) continue;

      // 找卸载程序
      let uninstaller = '';
      let exeList = [];
      try {
        const files = fs.readdirSync(full, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile()) continue;
          const n = f.name.toLowerCase();
          if (/\.exe$/i.test(n)) {
            exeList.push(f.name);
            if (/uninst|uninstal|卸载|unwise|setup.*remove|remove.*setup/i.test(n)) {
              uninstaller = path.join(full, f.name);
            }
          }
        }
      } catch (e) {}

      // 容量
      let size = 0;
      try {
        const walk = (d, depth) => {
          if (depth > 3) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            try {
              if (e.isDirectory()) walk(p, depth + 1);
              else size += fs.statSync(p).size;
            } catch (err) {}
          }
        };
        walk(full, 0);
      } catch (e) {}

      results.push({
        name: sub.name,
        version: '',
        publisher: '',
        installLocation: full,
        uninstallString: uninstaller ? '"' + uninstaller + '"' : '',
        uninstallerFile: uninstaller,
        matchedKey: tgt.key,
        matchedLabel: tgt.label,
        protected: false,
        source: 'directory',
        scope,
        size,
        exeCount: exeList.length
      });
    }
  }
  return results;
}

// ============ 扫描 ============

async function scan() {
  const results = [];
  const seen = new Set();   // 避免注册表和目录扫描重复

  // ① 注册表
  const entries = await readUninstallEntries();
  for (const e of entries) {
    const name = String(e.DisplayName || '').trim();
    if (!name) continue;

    const prot = isProtected(name);
    const tgt = matchesTarget(name);

    if (prot.protected) {
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
          protectKind: prot.kind,
          source: 'registry'
        });
        seen.add(name.toLowerCase());
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
        protected: false,
        source: 'registry'
      });
      seen.add(name.toLowerCase());
      if (e.InstallLocation) {
        try { seen.add(path.basename(String(e.InstallLocation).replace(/[\\/]+$/, '')).toLowerCase()); } catch (err) {}
      }
    }
  }

  // ② 目录扫描（绿色版 / 便携版）
  const dirHits = scanDirectories();
  for (const d of dirHits) {
    const key = d.name.toLowerCase();
    if (seen.has(key)) continue;
    // 如果注册表里已经有同名的，跳过
    const dup = results.some((r) => r.installLocation && d.installLocation &&
      r.installLocation.toLowerCase() === d.installLocation.toLowerCase());
    if (dup) continue;
    seen.add(key);
    results.push(d);
  }

  // ③ 正在运行的相关进程
  const procs = await listTargetProcs();

  return {
    ok: true,
    items: results,
    processes: procs,
    scannedDirs: getScanDirs().map((d) => d.dir),
    totalRegistry: entries.length
  };
}

async function listTargetProcs() {
  const allProcs = [];
  for (const t of TARGETS) {
    for (const p of t.procs) allProcs.push(p);
  }
  if (!allProcs.length) return Promise.resolve([]);

  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @(${allProcs.map((p) => "'" + p + "'").join(',')})
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

function parseUninstallCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  const s = cmd.trim();

  let m = /^"([^"]+)"\s*(.*)$/.exec(s);
  if (m) return { exe: m[1], args: m[2].trim() };

  m = /^([^\s]+\.exe)\s*(.*)$/i.exec(s);
  if (m) return { exe: m[1], args: m[2].trim() };

  m = /^([^\s]+exe)\b(.*)$/i.exec(s);
  if (m) return { exe: m[1], args: m[2].trim() };

  return null;
}

async function launchUninstaller(item) {
  const cmd = item && item.uninstallString;
  if (!cmd) {
    return { ok: false, error: '这个软件没有提供卸载命令（可能是绿色版，直接删除文件夹即可）' };
  }

  const parsed = parseUninstallCommand(cmd);
  if (!parsed) {
    return { ok: false, error: '无法解析卸载命令: ' + cmd.slice(0, 100) };
  }

  if (!fs.existsSync(parsed.exe)) {
    return { ok: false, error: '卸载程序不存在: ' + parsed.exe };
  }

  const full = '"' + parsed.exe + '"' + (parsed.args ? ' ' + parsed.args : '');
  return new Promise((resolve) => {
    exec('cmd /c start "" ' + full, { timeout: 15000, windowsHide: true }, (err) => {
      if (err) {
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
  scanDirectories,
  getScanDirs,
  isProtected,
  matchesTarget,
  TARGETS,
  PROTECTED
};
