# 机器人控制台 - 彻底卸载
# 由 卸载.bat 调用。清理：进程 / 注册表卸载项 / 快捷方式 /（可选）程序目录 /（可选）用户数据

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$userData = Join-Path $env:APPDATA 'robot-bot-console'

function W { param($t, $c) Write-Host $t -ForegroundColor $c }
function Head { param($t) Write-Host ''; Write-Host ('=== ' + $t + ' ===') -ForegroundColor Cyan }

W '================================================' 'Cyan'
W '        机器人控制台 · 彻底卸载' 'Cyan'
W '================================================' 'Cyan'
W ''
W ('程序目录: ' + $root)
W ('用户数据: ' + $userData)
W ''
W '这个工具会做以下事情：' 'Yellow'
W '  1) 结束所有相关进程（QQ / NapCat / python / electron）'
W '  2) 删除「已安装程序」注册表记录'
W '  3) 删除桌面和开始菜单快捷方式'
W '  4) 询问是否删除程序目录（约 1.8 GB）'
W '  5) 询问是否删除用户数据（配置 / 日志 / 聊天记录）'
W ''
W '注意：第 4、5 步默认都是「不删」，可以单独选择。' 'Yellow'
W ''

$ans = Read-Host '继续吗？(Y/N)'
if ($ans -notmatch '^[Yy]') { W '已取消。' 'Green'; Start-Sleep 1; exit 0 }

# ---------- 1. 结束进程 ----------
Head '1. 结束相关进程'
$names = @('electron', 'RobotConsole', 'NapCatWinBootMain', 'QQ', 'python', 'pythonw')
$killedAny = $false
foreach ($n in $names) {
  $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
  foreach ($p in $ps) {
    # 只结束与本程序相关的：路径在程序目录或 robot-bot-console 下
    $path = ''
    try { $path = $p.Path } catch {}
    $isOurs = $path -and (
      $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or
      $path -like '*robot-bot-console*'
    )
    if ($isOurs) {
      try { Stop-Process -Id $p.Id -Force -ErrorAction Stop; W ('  已结束 ' + $p.ProcessName + ' (PID ' + $p.Id + ')') 'Green'; $killedAny = $true } catch {}
    }
  }
}
if (-not $killedAny) { W '  没有需要结束的进程' }

# ---------- 2. 注册表 ----------
Head '2. 删除注册表卸载记录'
$found = 0
$paths = @(
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($base in $paths) {
  if (-not (Test-Path $base)) { continue }
  foreach ($key in (Get-ChildItem $base -ErrorAction SilentlyContinue)) {
    $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    if (-not $props) { continue }
    if ($props.DisplayName -like '*机器人控制台*' -or $props.DisplayName -like '*RobotConsole*' -or $props.DisplayName -like '*robot-bot-console*') {
      try { Remove-Item $key.PSPath -Recurse -Force -ErrorAction Stop; W ('  已删除: ' + $props.DisplayName) 'Green'; $found++ } catch {}
    }
  }
}
if ($found -eq 0) { W '  没有找到注册表记录（正常）' }

# ---------- 3. 快捷方式 ----------
Head '3. 删除快捷方式'
$shortcuts = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) '机器人控制台.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\机器人控制台.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\机器人控制台.lnk'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\机器人控制台.lnk')
)
$anyLnk = $false
foreach ($s in $shortcuts) {
  if ($s -and (Test-Path $s)) {
    try { Remove-Item $s -Force -ErrorAction Stop; W ('  已删除: ' + $s) 'Green'; $anyLnk = $true } catch {}
  }
}
if (-not $anyLnk) { W '  没有找到快捷方式' }

# ---------- 4. 程序目录 ----------
Head '4. 程序目录'
W ('  ' + $root)
W ('  占用: ' + [math]::Round(((Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 0) + ' MB')
$ansDir = Read-Host '  要删除这个目录吗？(y/N)'
if ($ansDir -match '^[Yy]') {
  # 目录里可能有正在运行的脚本自身，尝试删除
  try {
    Remove-Item $root -Recurse -Force -ErrorAction Stop
    W '  已删除程序目录' 'Green'
  } catch {
    W '  部分文件被占用，未能完全删除（关闭所有窗口后手动删除即可）' 'Yellow'
    W ('  路径: ' + $root) 'Yellow'
  }
} else {
  W '  已保留程序目录（绿色版可直接继续使用）' 'Green'
}

# ---------- 5. 用户数据 ----------
Head '5. 用户数据（配置 / 日志 / 聊天记录）'
W ('  ' + $userData)
if (Test-Path $userData) {
  W ('  占用: ' + [math]::Round(((Get-ChildItem $userData -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB), 0) + ' MB')
  $ansData = Read-Host '  要删除用户数据吗？(y/N) —— 删了会丢失配置和聊天记录'
  if ($ansData -match '^[Yy]') {
    try { Remove-Item $userData -Recurse -Force -ErrorAction Stop; W '  已删除用户数据' 'Green' }
    catch {
      W '  部分文件被占用，未能完全删除' 'Yellow'
      W ('  路径: ' + $userData) 'Yellow'
    }
  } else {
    W '  已保留用户数据' 'Green'
  }
} else {
  W '  用户数据目录不存在（正常）'
}

Write-Host ''
W '================================================' 'Cyan'
W '  卸载完成' 'Cyan'
W '================================================' 'Cyan'
Write-Host ''
