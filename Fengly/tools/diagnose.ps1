# 机器人控制台 - 环境诊断
# 由 诊断.bat 调用。把所有关键信息打印出来，便于定位 NapCat / bot 起不来的原因。

$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [System.Text.Encoding]::UTF8
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$resourcesRuntime = Join-Path $root 'resources\runtime'
$app = Join-Path $root 'resources\app'
$userData = Join-Path $env:APPDATA 'robot-bot-console'
$userRuntime = Join-Path $userData 'runtime'

function Line { param($t) Write-Host $t }
function Head { param($t) Write-Host ''; Write-Host ('=== ' + $t + ' ===') -ForegroundColor Cyan }
function Ok { param($t) Write-Host ('  [OK]   ' + $t) -ForegroundColor Green }
function Bad { param($t) Write-Host ('  [缺失] ' + $t) -ForegroundColor Red }
function Info { param($t) Write-Host ('  ' + $t) }

Line '================================================'
Line '        机器人控制台 · 环境诊断'
Line '================================================'
Info ('时间: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Info ('账户: ' + $env:USERNAME)
Info ('程序目录: ' + $root)

# ---------- 0. 文件版本检查 ----------
Head '0. 文件版本检查（判断是否覆盖成了新版）'

$appDir = Join-Path $root 'resources\app'
$mainJs = Join-Path $appDir 'main.js'

if (Test-Path $mainJs) {
  try {
    $t = Get-Content $mainJs -Raw -Encoding UTF8
    Info ('main.js 修改时间: ' + (Get-Item $mainJs).LastWriteTime)
    if ($t -match '日志文件:\s*$|日志文件: ') { Ok '含文件日志功能（新版）' } else { Bad '缺少文件日志（旧版！需要重新覆盖解压）' }
    if ($t -match 'killRelated') { Ok '含进程自动清理（新版）' } else { Bad '缺少进程清理（旧版！）' }
    if ($t -match '端口就绪') { Ok '含端口自动校准（新版）' } else { Bad '缺少端口校准（旧版！）' }
  } catch { Bad 'main.js 读取失败' }
} else {
  Bad ('找不到 main.js：' + $mainJs)
}

foreach ($pair in @(
  @{ F = 'tools\launch.ps1';  N = '统一启动器 launch.ps1' },
  @{ F = 'tools\diagnose.ps1'; N = '诊断脚本 diagnose.ps1' },
  @{ F = 'modules\killer.js'; N = '进程清理 killer.js' },
  @{ F = 'modules\standalone.js'; N = '独立启动器 standalone.js' }
)) {
  $fp = Join-Path $root $pair.F
  if ($pair.F -like 'modules\*') { $fp = Join-Path $appDir $pair.F }
  if (Test-Path $fp) {
    Ok ($pair.N + '  修改时间: ' + (Get-Item $fp).LastWriteTime)
  } else {
    Bad ($pair.N + ' 不存在：' + $fp)
  }
}

# 日志目录状态
$logDir = Join-Path $userData 'logs'
Line ''
if (Test-Path $logDir) {
  $logs = @(Get-ChildItem $logDir -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  Ok ('日志目录存在: ' + $logDir + '（' + $logs.Count + ' 个日志文件）')
  foreach ($l in ($logs | Select-Object -First 5)) {
    Info ('    ' + $l.Name + '  ' + [math]::Round($l.Length / 1KB, 1) + ' KB  ' + $l.LastWriteTime)
  }
} else {
  Bad ('日志目录不存在: ' + $logDir)
  Info '  => 说明主程序从未成功启动到写日志那一步（或跑的还是旧版）'
  Info '  => 请确认已用新版 zip 覆盖解压，并先关闭所有旧进程'
}

# ---------- 1. 运行时完整性 ----------
Head '1. 运行时完整性'

$items = @(
  @{ Rel = 'napcat\NapCatWinBootMain.exe'; Name = 'NapCat 启动器' },
  @{ Rel = 'napcat\NapCatWinBootHook.dll'; Name = 'NapCat Hook' },
  @{ Rel = 'napcat\napcat.mjs';           Name = 'NapCat 主程序' },
  @{ Rel = 'qq\QQ.exe';                   Name = 'QQ 运行环境' },
  @{ Rel = 'tianlu_bot\bot.py';           Name = '机器人程序' }
)

Line '  -- 绿色版自带 (resources\runtime) --'
foreach ($it in $items) {
  $p = Join-Path $resourcesRuntime $it.Rel
  if (Test-Path $p) { Ok $it.Name } else { Bad $it.Name }
}

Line '  -- 用户目录 (%APPDATA%\robot-bot-console\runtime) --'
if (Test-Path $userRuntime) {
  foreach ($it in $items) {
    $p = Join-Path $userRuntime $it.Rel
    if (Test-Path $p) { Ok $it.Name } else { Bad $it.Name }
  }
} else {
  Info '（该目录还不存在，主程序首次运行后才会生成）'
}

# ---------- 2. 进程 ----------
Head '2. 相关进程'

$watch = @('QQ', 'NapCatWinBootMain', 'python', 'pythonw', 'electron', 'RobotConsole')
$anyProc = $false
foreach ($n in $watch) {
  $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
  if ($ps.Count -gt 0) {
    $anyProc = $true
    $ids = ($ps | ForEach-Object { $_.Id }) -join ', '
    Ok ($n + '.exe  共 ' + $ps.Count + ' 个  (PID: ' + $ids + ')')
    foreach ($p in $ps) {
      $path = ''
      try { $path = $p.Path } catch {}
      if ($path) { Info ('        ' + $path) }
    }
  }
}
if (-not $anyProc) { Info '  没有任何相关进程在运行（NapCat / 机器人 都没启动）' }

# ---- 多副本检测：不同解压位置的 QQ 残留会占住登录态 ----
$qqDirs = @()
$allQQ = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'QQ.exe' })
foreach ($q in $allQQ) {
  $exe = $q.ExecutablePath
  if ($exe -and $exe -match '(?i)^(.+?)\\resources\\runtime\\qq\\QQ\.exe$') {
    $d = $matches[1]
    if ($qqDirs -notcontains $d) { $qqDirs += $d }
  }
}
if ($qqDirs.Count -gt 1) {
  Write-Host ''
  Write-Host ('  [警告] 发现 ' + $qqDirs.Count + ' 个不同位置的程序副本，它们的 QQ 进程都在运行：') -ForegroundColor Red
  foreach ($d in $qqDirs) { Write-Host ('         ' + $d) -ForegroundColor Red }
  Write-Host ''
  Write-Host '  这些残留 QQ 会占住登录态和文件句柄，导致新 NapCat 注入失败，' -ForegroundColor Yellow
  Write-Host '  典型表现就是「127.0.0.1 拒绝连接 / 二维码不出现 / 窗口一闪就退」。' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  解决办法：双击「启动机器人控制台.bat」，新版会自动结束所有副本的残留进程。' -ForegroundColor Green
  Write-Host '  或者手动在任务管理器里结束所有 QQ.exe 后重试。' -ForegroundColor Green
}

# ---------- 3. 端口 ----------
Head '3. 端口监听'

$ports = @(8899, 8900, 8901, 18080, 6099, 16099)
$found = $false
foreach ($port in $ports) {
  $c = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($c.Count -gt 0) {
    $found = $true
    foreach ($x in $c) {
      $pn = ''
      try { $pn = (Get-Process -Id $x.OwningProcess).ProcessName } catch {}
      Ok ('端口 ' + $port + ' 监听中  (进程: ' + $pn + ' PID=' + $x.OwningProcess + ')')
    }
  }
}
if (-not $found) { Info '  8899 / 18080 等端口都没有在监听' }

# ---------- 4. WebUI 配置 ----------
Head '4. WebUI 配置 (webui.json)'

$wf = Join-Path $userRuntime 'napcat\config\webui.json'
if (-not (Test-Path $wf)) { $wf = Join-Path $resourcesRuntime 'napcat\config\webui.json' }
if (Test-Path $wf) {
  Info ('文件: ' + $wf)
  try {
    $j = Get-Content $wf -Raw -Encoding UTF8 | ConvertFrom-Json
    Info ('port  = ' + $j.port)
    Info ('host  = ' + $j.host)
    Info ('token = ' + $j.token)
    $webuiPort = [int]$j.port
  } catch {
    Bad 'webui.json 解析失败'
    $webuiPort = 8899
  }
} else {
  Bad '找不到 webui.json'
  $webuiPort = 8899
}

# ---------- 5. 实际访问测试 ----------
Head '5. WebUI 实际访问测试'

$tryPorts = @($webuiPort, 8899, 8900, 8901) | Select-Object -Unique
$anyOk = $false
foreach ($port in $tryPorts) {
  $url = 'http://127.0.0.1:' + $port + '/webui'
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
    Ok ($url + '  →  HTTP ' + $r.StatusCode + '（可访问）')
    $anyOk = $true
  } catch {
    $msg = $_.Exception.Message
    if ($msg.Length -gt 70) { $msg = $msg.Substring(0, 70) + '…' }
    Info ($url + '  →  失败: ' + $msg)
  }
}
if (-not $anyOk) {
  Write-Host ''
  Write-Host '  >> 所有端口都连不上，说明 NapCat 没有成功启动。' -ForegroundColor Yellow
  Write-Host '  >> 请先运行 napcat.bat，观察窗口中最后的报错信息。' -ForegroundColor Yellow
}

# ---------- 6. 端口排除范围 ----------
Head '6. Windows 端口排除范围（这些区间的端口无法绑定）'

$excl = netsh interface ipv4 show excludedportrange protocol=tcp 2>$null
$printed = $false
foreach ($line in ($excl -split "`r?`n")) {
  if ($line -match '^\s*(\d{1,5})\s+(\d{1,5})\s*$') {
    Info ('  ' + $matches[1] + ' - ' + $matches[2])
    $printed = $true
  }
}
if (-not $printed) { Info '  （读取失败或无排除范围）' }

# ---------- 7. 机器人配置 ----------
Head '7. 机器人配置 (.env 关键项)'

$envPath = Join-Path $userRuntime 'tianlu_bot\.env'
if (-not (Test-Path $envPath)) { $envPath = Join-Path $resourcesRuntime 'tianlu_bot\.env' }
if (Test-Path $envPath) {
  Info ('文件: ' + $envPath)
  foreach ($key in @('BOT_PORT', 'BOT_HOST', 'BOT_QQ', 'OWNER_ID', 'GROUP_ID', 'FEISHU_GROUP_ID')) {
    $m = Select-String -Path $envPath -Pattern ('^' + $key + '\s*=') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { Info ('  ' + $m.Line.Trim()) }
  }
} else {
  Info '  找不到 .env'
}

# ---------- 8. 反向 WS 配置 ----------
Head '8. NapCat 反向 WebSocket 指向'

$obPath = Join-Path $userRuntime 'napcat\config\onebot11.json'
if (-not (Test-Path $obPath)) { $obPath = Join-Path $resourcesRuntime 'napcat\config\onebot11.json' }
if (Test-Path $obPath) {
  try {
    $ob = Get-Content $obPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $clients = $ob.network.websocketClients
    if ($clients -and $clients.Count -gt 0) {
      Info ('url = ' + $clients[0].url)
      Info ('enable = ' + $clients[0].enable)
      Info ('messagePostFormat = ' + $clients[0].messagePostFormat)
    } else {
      Info '  websocketClients 为空'
    }
  } catch { Info '  onebot11.json 解析失败' }
} else {
  Info '  找不到 onebot11.json'
}

# ---------- 9. Python ----------
Head '9. Python 环境'

$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
  Info ('python: ' + $py.Source)
  try {
    $v = & python --version 2>&1
    Info ('version: ' + $v)
    & python -c "import nonebot; print('nonebot:', nonebot.__version__)" 2>&1 | ForEach-Object { Info $_ }
  } catch { Info '  执行 python 失败' }
} else {
  Bad 'PATH 里找不到 python'
}

# ---------- 结束 ----------
Write-Host ''
Write-Host '================================================'
Write-Host '  诊断结束。把以上内容截图发给开发者即可。' -ForegroundColor Cyan
Write-Host '================================================'
Write-Host ''
