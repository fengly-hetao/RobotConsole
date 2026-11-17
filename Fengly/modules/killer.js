'use strict';
// 启动前进程清理：杀掉与本程序相关的一切残留进程，避免「旧的没退干净」导致
// 端口被占、登录态冲突、配置不生效、双实例抢运行时等问题。
//
// scope 隔离（关键）：
//   'all'    → 同类实例 + NapCat 系 + bot 系（主程序用）
//   'napcat' → 同类实例 + runtime 下的 QQ / NapCat（napcat.bat 用，不动 bot）
//   'bot'    → 同类实例 + 跑 tianlu_bot 的 python（bot.bat 用，不动 NapCat）
//   'self'   → 只清同类实例（同名 electron / RobotConsole）
//
// 为什么需要 scope：用户可能同时开着 napcat.bat 和 bot.bat 两个窗口，
// 若后者做全量清理就会把前者杀掉。
//
// 所有匹配都基于「可执行文件路径 / 命令行」，不会误杀用户自己的 QQ 或 Python。

const path = require('path');
const { execFileSync } = require('child_process');

// 本程序可能使用的可执行文件名（进程名，不带 .exe）
const SELF_PROCESS_NAMES = ['electron', 'RobotConsole'];

// 通用解释器/宿主进程名：即使当前进程叫这些，也绝不能按名字批量杀，
// 否则会误杀用户自己的 node / python 程序。
const GENERIC_NAMES = new Set([
  'node', 'python', 'python3', 'pythonw', 'cmd', 'powershell', 'pwsh',
  'conhost', 'bash', 'sh', 'wscript', 'cscript'
]);

function buildScript(selfPid, selfProcessName, runtimePath, scope, appRoot) {
  const esc = (s) => String(s || '').replace(/'/g, "''");
  const selfNames = Array.from(new Set([selfProcessName].concat(SELF_PROCESS_NAMES)))
    .filter(Boolean)
    .map((n) => n.replace(/\.exe$/i, '').toLowerCase())
    .filter((n) => n && !GENERIC_NAMES.has(n));

  const nameList = selfNames.map((n) => `'${esc(n)}'`).join(',');
  const rt = esc(runtimePath);
  const ar = esc(appRoot);
  const wantNapcat = scope === 'all' || scope === 'napcat';
  const wantBot = scope === 'all' || scope === 'bot';
  const scopeAll = scope === 'all' || scope === 'self';

  return `
$ErrorActionPreference = 'SilentlyContinue'
$selfPid = ${Number(selfPid) || 0}
$selfNames = @(${nameList})
$runtime = '${rt}'
$appRoot = '${ar}'
$wantNapcat = ${wantNapcat ? '$true' : '$false'}
$wantBot = ${wantBot ? '$true' : '$false'}
$scopeAll = ${scopeAll ? '$true' : '$false'}
$killed = New-Object System.Collections.ArrayList

function Add-Killed($n, $id) {
  if ($id -and $id -ne $selfPid) { [void]$killed.Add("$n#$id") }
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  if (-not $_ -or $_.ProcessId -eq $selfPid) { return }
  $name = ($_.Name + '')
  $exe = ($_.ExecutablePath + '')
  $cmd = ($_.CommandLine + '')

  # ============ 主规则：本程序自己的两个目录里的进程全部清理 ============
  # 1) 程序文件夹（appRoot）—— electron、standalone、以及随程序放置的任何 exe
  # 2) 用户数据运行时（runtimePath，位于 %APPDATA%\robot-bot-console\runtime）
  #    ★ 关键：QQ / NapCat 实际是在这里跑的，不在程序文件夹里！
  #    漏掉它会残留 QQ 进程，QQ 的单实例锁会挡住 NapCat 的注入，导致
  #    "Process resumed" 之后卡死、WebUI 起不来。
  # 只认路径不认进程名，文件夹外的任何程序（VS Code、Discord、用户自己的 QQ）一律不碰。
  $inAppRoot = ($exe -and $appRoot -and $appRoot.Length -gt 3 -and
                $exe.StartsWith($appRoot, [System.StringComparison]::OrdinalIgnoreCase))
  $inRuntime = ($exe -and $runtime -and $runtime.Length -gt 3 -and
                $exe.StartsWith($runtime, [System.StringComparison]::OrdinalIgnoreCase))

  if ($inAppRoot -or $inRuntime) {
    # 按 scope 细分，避免 napcat.bat 把另一个窗口的机器人杀掉
    $isQQOrNapcat = [bool]($exe -match '(?i)\\qq\\|\\napcat\\')
    $hit = $scopeAll -or ($wantNapcat -and $isQQOrNapcat) -or ($wantBot -and (-not $isQQOrNapcat))
    if ($hit) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Add-Killed $name $_.ProcessId } catch {}
    }
    return
  }

  # ============ 兜底：本程序独立启动器的 electron（极端情况下路径读不到） ============
  if ($cmd -and ($cmd -like '*standalone.js*')) {
    $pn2 = ($name -replace '\.exe$', '').ToLower()
    if ($selfNames -contains $pn2) {
      $isNap = [bool]($cmd -match 'standalone\.js\S*\s+napcat')
      $isBot = [bool]($cmd -match 'standalone\.js\S*\s+bot')
      $hit2 = $scopeAll -or ($wantNapcat -and $isNap) -or ($wantBot -and $isBot)
      if ($hit2) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Add-Killed $name $_.ProcessId } catch {}
      }
    }
    return
  }

  # ============ 机器人本体：python 跑 bot.py（系统 Python 不在本文件夹内） ============
  if ($wantBot -and $cmd -and ($cmd -like '*tianlu_bot*' -or $cmd -like '*bot.py*')) {
    if ($name -ieq 'python.exe' -or $name -ieq 'pythonw.exe') {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Add-Killed $name $_.ProcessId } catch {}
    }
  }
}

if ($killed.Count -gt 0) { $killed -join ', ' } else { '' }
`.trim();
}

// 返回 { ok, killed: [..], error }
// opts: { pid, processName, runtimePath, scope }
function killRelated(opts = {}) {
  const selfPid = opts.pid || process.pid;
  const selfProcessName = (opts.processName || path.basename(process.execPath || 'electron').replace(/\.exe$/i, ''));
  const runtimePath = opts.runtimePath || '';
  const scope = ['all', 'napcat', 'bot', 'self'].includes(opts.scope) ? opts.scope : 'all';
  // 程序目录：只清理这个目录下的 electron/RobotConsole，绝不碰用户的其它 Electron 应用
  const appRoot = opts.appRoot || path.dirname(process.execPath || '');

  const script = buildScript(selfPid, selfProcessName, runtimePath, scope, appRoot);
  let out = '';

  // 关键：不能把脚本当命令行参数传（-Command）。
  // Windows 命令行是 ANSI 编码，路径含中文会变乱码，导致 $runtime 匹配失败、
  // 清理静默失效 —— 这正是"残留 QQ 一直杀不掉"的根因。
  // 改成写入临时 .ps1（UTF-8 BOM）再用 -File 执行，中文路径才能正确传递。
  const fs = require('fs');
  const os = require('os');
  const tmpFile = path.join(os.tmpdir(), 'rc-killer-' + process.pid + '-' + Date.now() + '.ps1');
  try {
    fs.writeFileSync(tmpFile, '\uFEFF' + script, 'utf8');
    out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
      { encoding: 'utf8', windowsHide: true, timeout: 25000 }
    );
  } catch (e) {
    out = (e && (e.stdout || '')) || '';
    if (!out) {
      try { fs.unlinkSync(tmpFile); } catch (e2) {}
      return { ok: false, killed: [], error: (e && e.message) || 'unknown' };
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }

  const killed = String(out)
    .split(/[\r\n]+/)
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return { ok: true, killed, scope };
}

module.exports = { killRelated, SELF_PROCESS_NAMES };
