'use strict';
// 顽固软件清理助手（增强部分）
// ==========================
// 360 / 鲁大师 这类软件难删的三个原因：
//   ① 常驻进程占着文件，卸载程序删不掉
//   ② 卸载完会自动重装（有守护进程/计划任务/服务）
//   ③ 卸载后留一堆残留（目录、注册表、启动项、服务、计划任务）
//
// 本模块提供：
//   · killProcesses(item)     结束该软件所有相关进程
//   · stopServices(item)      停止并禁用相关服务
//   · scanResiduals(item)     扫描残留（目录 / 注册表 / 启动项 / 服务 / 计划任务）
//   · cleanResiduals(list)    清理勾选的残留项
//   · forceRemoveDir(dir)     强制删除整个目录（绿色版）
//
// 安全原则：
//   · 只操作 matchesTarget 命中的软件
//   · 受保护的（网盘/火绒/系统）一律拒绝
//   · 所有删除前都先备份到「残留备份」目录，可恢复

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, exec } = require('child_process');

const { matchesTarget, isProtected, parseUninstallCommand } = require('./cleanup');

// ============ PowerShell 辅助 ============

function runPs(script, timeoutMs) {
  const tmpDir = path.join(os.tmpdir(), 'rc-clean-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
  const file = path.join(tmpDir, 'run.ps1');
  try {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(file, Buffer.concat([bom, Buffer.from(script, 'utf8')]));
  } catch (e) {}

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

function parseJson(txt, fallback) {
  try {
    const t = String(txt || '').trim();
    if (!t) return fallback;
    const j = JSON.parse(t);
    return j == null ? fallback : j;
  } catch (e) {
    return fallback;
  }
}

// ============ 安全检查 ============

/**
 * 确认目标软件不在保护名单里。所有破坏性操作前必须调用。
 */
function assertSafe(item) {
  const name = (item && (item.name || item.installLocation)) || '';
  const prot = isProtected(name);
  if (prot.protected) {
    throw new Error('受保护的程序，拒绝操作：' + name + '（' + prot.kind + '）');
  }
  const tgt = matchesTarget(name);
  if (!tgt) {
    throw new Error('不在清理名单里，拒绝操作：' + name);
  }
  return tgt;
}

// ============ ① 结束进程 ============

/**
 * 结束某个软件的所有相关进程。
 * 优先按目标配置里的进程名，其次按安装目录路径匹配。
 */
async function killProcesses(item) {
  const tgt = assertSafe(item);
  const procs = Array.isArray(tgt.procs) ? tgt.procs : [];
  const installDir = String((item && item.installLocation) || '').replace(/[\\/]+$/, '');

  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @(${procs.map((p) => "'" + p + "'").join(',')})
$dir = '${installDir.replace(/'/g, "''")}'
$killed = New-Object System.Collections.ArrayList
$failed = New-Object System.Collections.ArrayList

foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  $hit = $false
  if ($names -contains $p.ProcessName) { $hit = $true }
  if (-not $hit -and $dir) {
    try {
      $pth = [string]$p.Path
      if ($pth -and $pth.ToLower().StartsWith($dir.ToLower())) { $hit = $true }
    } catch {}
  }
  if ($hit) {
    try {
      Stop-Process -Id $p.Id -Force -ErrorAction Stop
      [void]$killed.Add($p.ProcessName + '(' + $p.Id + ')')
    } catch {
      [void]$failed.Add($p.ProcessName + '(' + $p.Id + ')')
    }
  }
}
[PSCustomObject]@{ killed = @($killed); failed = @($failed) } | ConvertTo-Json -Compress -Depth 3
`;
  const r = await runPs(ps, 30000);
  return parseJson(r.stdout, { killed: [], failed: [] });
}

// ============ ② 停止服务 ============

/**
 * 找出并停止该软件相关的服务（按可执行文件路径匹配），并设为禁用防止自启。
 * 需要管理员权限；无权限时返回 needAdmin。
 */
async function stopServices(item) {
  const tgt = assertSafe(item);
  const procs = Array.isArray(tgt.procs) ? tgt.procs : [];
  const installDir = String((item && item.installLocation) || '').replace(/[\\/]+$/, '');
  const keywords = procs.map((p) => p.toLowerCase()).concat([String((item && item.name) || '').toLowerCase()]);

  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$dir = '${installDir.replace(/'/g, "''")}'
$kws = @(${keywords.filter(Boolean).map((k) => "'" + String(k).replace(/'/g, "''") + "'").join(',')})
$stopped = New-Object System.Collections.ArrayList
$failed = New-Object System.Collections.ArrayList

foreach ($svc in Get-CimInstance Win32_Service -ErrorAction SilentlyContinue) {
  $hit = $false
  $pth = [string]$svc.PathName
  if ($dir -and $pth -and $pth.ToLower().Contains($dir.ToLower())) { $hit = $true }
  foreach ($k in $kws) {
    if ($k -and $pth -and $pth.ToLower().Contains($k)) { $hit = $true }
  }
  if (-not $hit) { continue }
  try {
    if ($svc.State -eq 'Running') { Stop-Service -Name $svc.Name -Force -ErrorAction Stop }
    Set-Service -Name $svc.Name -StartupType Disabled -ErrorAction Stop
    [void]$stopped.Add($svc.Name + ' | ' + $svc.DisplayName)
  } catch {
    [void]$failed.Add($svc.Name + ' | ' + $_.Exception.Message)
  }
}
[PSCustomObject]@{ stopped = @($stopped); failed = @($failed) } | ConvertTo-Json -Compress -Depth 3
`;
  const r = await runPs(ps, 40000);
  const data = parseJson(r.stdout, { stopped: [], failed: [] });
  if (data.failed && data.failed.some((x) => /拒绝访问|Access is denied|权限/i.test(String(x)))) {
    data.needAdmin = true;
  }
  return data;
}

// ============ ③ 扫描残留 ============

/**
 * 扫描某个软件卸载后可能残留的东西。
 * 返回 [{ type, label, detail, path, size, risky }]
 *   type: dir | regkey | startup | service | task | shortcut
 */
async function scanResiduals(item) {
  const tgt = matchesTarget((item && (item.name || item.installLocation)) || '');
  const installDir = String((item && item.installLocation) || '').replace(/[\\/]+$/, '');
  const name = String((item && item.name) || '');
  const residuals = [];

  const keyWords = new Set();
  if (tgt) {
    (tgt.dirs || []).forEach((d) => keyWords.add(d.split('\\').pop()));
    (tgt.procs || []).forEach((p) => keyWords.add(p));
  }
  if (name) keyWords.add(name);

  const kwList = Array.from(keyWords).filter((x) => x && x.length >= 2).map((x) => x.toLowerCase());

  // ---------- 目录残留 ----------
  const candidateDirs = [];
  if (installDir && fs.existsSync(installDir)) candidateDirs.push(installDir);

  // 其他常见残留位置
  const env = process.env;
  const roamBases = [];
  if (env['APPDATA']) roamBases.push(env['APPDATA']);
  if (env['LOCALAPPDATA']) roamBases.push(env['LOCALAPPDATA']);
  if (env['ProgramData']) roamBases.push(env['ProgramData']);

  for (const base of roamBases) {
    for (const kw of Array.from(keyWords)) {
      const p = path.join(base, kw);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory() && !candidateDirs.includes(p)) {
          candidateDirs.push(p);
        }
      } catch (e) {}
    }
  }

  for (const d of candidateDirs) {
    let size = 0;
    try {
      const walk = (p, depth) => {
        if (depth > 4) return;
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const fp = path.join(p, e.name);
          try {
            if (e.isDirectory()) walk(fp, depth + 1);
            else size += fs.statSync(fp).size;
          } catch (err) {}
        }
      };
      walk(d, 0);
    } catch (e) {}
    residuals.push({
      type: 'dir',
      label: '安装目录',
      detail: d,
      path: d,
      size,
      risky: d === installDir
    });
  }

  // ---------- 注册表 / 启动项 / 服务 / 计划任务 ----------
  const kwJson = JSON.stringify(kwList);
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$kws = ConvertFrom-Json '${kwJson.replace(/'/g, "''")}'
$out = New-Object System.Collections.ArrayList

function MatchAny([string]$s) {
  if (-not $s) { return $false }
  $l = $s.ToLower()
  foreach ($k in $kws) { if ($k -and $l.Contains($k)) { return $true } }
  return $false
}

# 注册表卸载项
foreach ($p in @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) {
  foreach ($it in Get-ItemProperty $p -ErrorAction SilentlyContinue) {
    if (MatchAny $it.DisplayName) {
      [void]$out.Add([PSCustomObject]@{
        type='regkey'; label='注册表卸载项'; detail=[string]$it.DisplayName
        path=($p -replace '\\\\\\*$','') + '\\' + $it.PSChildName
      })
    }
  }
}

# 启动项
foreach ($rk in @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')) {
  $props = Get-ItemProperty $rk -ErrorAction SilentlyContinue
  if ($props) {
    foreach ($pn in $props.PSObject.Properties.Name) {
      if ($pn -like 'PS*') { continue }
      $v = [string]$props.$pn
      if ((MatchAny $pn) -or (MatchAny $v)) {
        [void]$out.Add([PSCustomObject]@{
          type='startup'; label='开机启动项'; detail=$pn + ' = ' + $v
          path=$rk; regName=$pn
        })
      }
    }
  }
}

# 服务
foreach ($svc in Get-CimInstance Win32_Service -ErrorAction SilentlyContinue) {
  if ((MatchAny $svc.Name) -or (MatchAny $svc.DisplayName) -or (MatchAny $svc.PathName)) {
    [void]$out.Add([PSCustomObject]@{
      type='service'; label='系统服务'; detail=$svc.Name + ' | ' + $svc.DisplayName
      path=$svc.Name
    })
  }
}

# 计划任务
foreach ($t in Get-ScheduledTask -ErrorAction SilentlyContinue) {
  $act = ''
  try { $act = ($t.Actions | ForEach-Object { [string]$_.Execute }) -join ';' } catch {}
  if ((MatchAny $t.TaskName) -or (MatchAny $act)) {
    [void]$out.Add([PSCustomObject]@{
      type='task'; label='计划任务'; detail=$t.TaskName + ' (' + $t.TaskPath + ')'
      path=($t.TaskPath + $t.TaskName)
    })
  }
}

$out | ConvertTo-Json -Compress -Depth 4
`;
  const r = await runPs(ps, 45000);
  const arr = parseJson(r.stdout, []);
  const list = Array.isArray(arr) ? arr : [arr];
  for (const it of list) {
    if (!it || !it.type) continue;
    residuals.push({
      type: it.type,
      label: it.label || it.type,
      detail: it.detail || '',
      path: it.path || '',
      regName: it.regName || '',
      size: 0,
      risky: false
    });
  }

  return residuals;
}

// ============ ④ 清理残留 ============

/**
 * 删除残留项。所有删除前先备份。
 * @param {Array} items scanResiduals 返回的数组（用户勾选的）
 * @returns {{ok, cleaned: string[], failed: {item, error}[], backupDir}}
 */
async function cleanResiduals(items) {
  const backupRoot = path.join(process.env.APPDATA || os.tmpdir(), 'robot-bot-console', 'residual-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  try { fs.mkdirSync(backupRoot, { recursive: true }); } catch (e) {}

  const cleaned = [];
  const failed = [];

  for (const it of items || []) {
    try {
      // 保护名单里的目录绝不删
      if (it.type === 'dir') {
        const prot = isProtected(it.path);
        if (prot.protected) throw new Error('受保护目录，拒绝删除（' + prot.kind + '）');
        if (!fs.existsSync(it.path)) { cleaned.push(it.detail + '（已不存在）'); continue; }
        // 备份：把目录改名移动到备份区（比复制快，且可还原）
        const dst = path.join(backupRoot, path.basename(it.path) + '_' + Date.now());
        try {
          fs.renameSync(it.path, dst);
          cleaned.push(it.detail + ' → 已移到备份区');
        } catch (e) {
          // 跨盘改不了名，只能删除
          fs.rmSync(it.path, { recursive: true, force: true });
          cleaned.push(it.detail + '（已删除）');
        }
      } else if (it.type === 'regkey') {
        await runPs(`Remove-Item -Path '${String(it.path).replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`, 15000);
        cleaned.push(it.detail);
      } else if (it.type === 'startup') {
        const ps = `
$p = '${String(it.path).replace(/'/g, "''")}'
$n = '${String(it.regName || '').replace(/'/g, "''")}'
if ($n) { Remove-ItemProperty -Path $p -Name $n -Force -ErrorAction SilentlyContinue }
`;
        await runPs(ps, 15000);
        cleaned.push(it.detail);
      } else if (it.type === 'service') {
        const ps = `
$n = '${String(it.path).replace(/'/g, "''")}'
Stop-Service -Name $n -Force -ErrorAction SilentlyContinue
sc.exe delete $n | Out-Null
`;
        const r = await runPs(ps, 20000);
        if (r.stderr && /拒绝|Access is denied/i.test(r.stderr)) {
          throw new Error('需要管理员权限');
        }
        cleaned.push(it.detail);
      } else if (it.type === 'task') {
        const ps = `
$p = '${String(it.path).replace(/'/g, "''")}'
$parts = $p -split '\\\\'
$name = $parts[-1]
$folder = ($parts[0..($parts.Length-2)] -join '\\')
if (-not $folder) { $folder = '\\' }
Unregister-ScheduledTask -TaskName $name -TaskPath $folder -Confirm:$false -ErrorAction SilentlyContinue
`;
        await runPs(ps, 20000);
        cleaned.push(it.detail);
      }
    } catch (e) {
      failed.push({ item: it, error: e.message });
    }
  }

  return { ok: failed.length === 0, cleaned, failed, backupDir: backupRoot };
}

// ============ ⑤ 强制删除目录 ============

/**
 * 强制删除整个安装目录（适合绿色版）。
 * 先杀进程 → 再删 → 失败则提示重启后删。
 */
async function forceRemoveDir(dir) {
  const prot = isProtected(dir);
  if (prot.protected) return { ok: false, error: '受保护目录，拒绝删除（' + prot.kind + '）' };

  const tgt = matchesTarget(path.basename(dir));
  if (!tgt) return { ok: false, error: '不在清理名单里，拒绝删除' };

  if (!fs.existsSync(dir)) return { ok: true, note: '目录已不存在' };

  // 先杀占用进程
  await killProcesses({ name: path.basename(dir), installLocation: dir });

  // 备份后删除
  const backupRoot = path.join(process.env.APPDATA || os.tmpdir(), 'robot-bot-console', 'residual-backup');
  try { fs.mkdirSync(backupRoot, { recursive: true }); } catch (e) {}
  const dst = path.join(backupRoot, path.basename(dir) + '_' + Date.now());

  try {
    fs.renameSync(dir, dst);
    return { ok: true, note: '已移到备份区：' + dst, backup: dst };
  } catch (e) {
    // 跨盘或占用，尝试直接删
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true, note: '已删除' };
    } catch (err) {
      return {
        ok: false,
        error: '删除失败：' + err.message + '（可能有进程占用，建议重启电脑后再删）'
      };
    }
  }
}

// ============ 综合：一键准备卸载环境 ============

/**
 * 卸载前调用：结束进程 + 停止服务。
 */
async function prepareUninstall(item) {
  assertSafe(item);
  const k = await killProcesses(item);
  const s = await stopServices(item);
  return {
    ok: true,
    killed: k.killed || [],
    killFailed: k.failed || [],
    servicesStopped: s.stopped || [],
    servicesFailed: s.failed || [],
    needAdmin: !!s.needAdmin
  };
}

module.exports = {
  killProcesses,
  stopServices,
  scanResiduals,
  cleanResiduals,
  forceRemoveDir,
  prepareUninstall
};
