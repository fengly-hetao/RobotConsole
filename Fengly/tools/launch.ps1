# 机器人控制台 - 统一启动器
# 由 5 个 .bat 调用（bat 里只留一行 powershell 调用，避免 cmd 对路径中
# 括号 / 空格 / 中文的解析问题）。
#
# 用法：
#   launch.ps1 app      → 启动完整界面
#   launch.ps1 napcat   → 只启动 NapCat
#   launch.ps1 bot      → 只启动机器人
#   launch.ps1 diagnose → 运行环境诊断
#   launch.ps1 uninstall→ 完整卸载

param([string]$Target = 'app')

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot      # ...\RobotConsole
if (-not $root) { $root = (Get-Location).Path }
$electron = Join-Path $root 'electron.exe'
$appDir   = Join-Path $root 'resources\app'

function Fail { param($msg) Write-Host ''; Write-Host $msg -ForegroundColor Red; Write-Host '' }

# ---------- 路径体检 ----------
# NapCat / QQ 的注入启动对非 ASCII 路径很敏感，含中文时经常静默失败。
function Test-PathRisk {
  $risky = @()
  if ($root -match '[^\x00-\x7F]') { $risky += '包含中文/非英文字符' }
  if ($root -match '\s') { $risky += '包含空格' }
  if ($root -match '[()]') { $risky += '包含括号' }
  return $risky
}

$risks = Test-PathRisk

# 自动迁移到纯英文路径（同一磁盘内只是重命名，秒级完成）
function Invoke-AutoMigrate {
  $item = Get-Item -LiteralPath $root -ErrorAction SilentlyContinue
  if (-not $item) { return $false }
  $driveName = ''
  try { $driveName = $item.PSDrive.Name } catch {}
  if (-not $driveName) { return $false }

  $target = $driveName + ':\RobotConsole'
  if ($target -eq $root) { return $false }
  if (Test-Path -LiteralPath $target) {
    Write-Host ''
    Write-Host ('  [无法自动迁移] 目标路径已存在: ' + $target) -ForegroundColor Yellow
    Write-Host '  请先手动删除或改名那个目录，再重试。' -ForegroundColor Yellow
    return $false
  }

  Write-Host ''
  Write-Host ('  可以把整个程序移动到纯英文路径: ' + $target) -ForegroundColor Green
  Write-Host '  同一磁盘内只是重命名，几秒完成，不需要重新复制 1.8GB。' -ForegroundColor Green
  Write-Host ''
  $ans = Read-Host '  现在自动迁移吗？(Y/n)'
  if ($ans -match '^[Nn]') { return $false }

  # 先把 cwd 移走，否则目录被占用无法重命名
  try { Set-Location $env:TEMP } catch {}

  Write-Host ''
  Write-Host '  [1/2] 结束所有相关进程…'
  $killedCount = 0
  foreach ($n in @('QQ', 'NapCatWinBootMain', 'electron', 'python', 'pythonw', 'RobotConsole')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
      $p = ''
      try { $p = $_.Path } catch {}
      $ours = $p -and (
        $p -like '*\resources\runtime\*' -or
        $p -like '*robot-bot-console\*' -or
        $p -like '*\RobotConsole\*'
      )
      if ($ours) {
        try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; $killedCount++ } catch {}
      }
    }
  }
  Write-Host ('        已结束 ' + $killedCount + ' 个进程')
  Start-Sleep -Seconds 2

  Write-Host '  [2/2] 移动目录…'
  try {
    Move-Item -LiteralPath $root -Destination $target -ErrorAction Stop
    Write-Host ''
    Write-Host '  ============================================' -ForegroundColor Green
    Write-Host ('   迁移成功！新位置: ' + $target) -ForegroundColor Green
    Write-Host '  ============================================' -ForegroundColor Green
    Write-Host ''
    Write-Host '  请打开新目录，双击「启动机器人控制台.bat」' -ForegroundColor Cyan
    Write-Host ('  ' + $target) -ForegroundColor Cyan
    Write-Host ''
    return $true
  } catch {
    Write-Host ''
    Write-Host ('  迁移失败: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '  请关闭所有程序窗口后重试，或手动把文件夹移到英文路径。' -ForegroundColor Yellow
    return $false
  }
}

if ($risks.Count -gt 0 -and $Target -ne 'uninstall') {
  Write-Host ''
  Write-Host '================================================' -ForegroundColor Yellow
  Write-Host '  [重要提醒] 程序所在路径存在兼容性风险' -ForegroundColor Yellow
  Write-Host '================================================' -ForegroundColor Yellow
  Write-Host ('  当前路径: ' + $root)
  Write-Host ('  问题: ' + ($risks -join '、')) -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  NapCat 通过 DLL 注入启动 QQ，对路径极敏感：' -ForegroundColor Yellow
  Write-Host '  含中文 / 空格 / 括号时，QQ 经常启动失败（表现为' -ForegroundColor Yellow
  Write-Host '  127.0.0.1 拒绝连接、二维码不出现、窗口一闪就退）。' -ForegroundColor Yellow

  if (Invoke-AutoMigrate) { exit 0 }

  Write-Host ''
  Write-Host '  继续启动（可能失败）…' -ForegroundColor DarkGray
  Start-Sleep -Seconds 1
}

switch ($Target.ToLower()) {

  'diagnose' {
    $p = Join-Path $PSScriptRoot 'diagnose.ps1'
    if (-not (Test-Path $p)) { Fail ('[错误] 找不到诊断脚本: ' + $p); break }
    & $p
    break
  }

  'uninstall' {
    $p = Join-Path $PSScriptRoot 'uninstall.ps1'
    if (-not (Test-Path $p)) { Fail ('[错误] 找不到卸载脚本: ' + $p); break }
    & $p
    break
  }

  default {
    # app / napcat / bot 需要 electron.exe
    if (-not (Test-Path $electron)) {
      Fail ('[错误] 找不到 electron.exe：' + $electron)
      Write-Host '  请确认本 .bat 和 electron.exe 在同一个文件夹里。'
      break
    }

    # 日志目录（输出同时显示在窗口并写入文件，便于排查）
    $logDir = Join-Path $env:APPDATA 'robot-bot-console\logs'
    try { New-Item -ItemType Directory -Path $logDir -Force -ErrorAction Stop | Out-Null } catch {}
    $logFile = Join-Path $logDir ($Target + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

    Write-Host ''
    Write-Host ('日志文件: ' + $logFile) -ForegroundColor DarkGray
    Write-Host ''

    if ($Target -eq 'app') {
      $env:ELECTRON_RUN_AS_NODE = $null
      Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
      Write-Host '正在启动 机器人控制台 …' -ForegroundColor Cyan
      & $electron $appDir 2>&1 | Tee-Object -FilePath $logFile
    }
    elseif ($Target -eq 'napcat' -or $Target -eq 'bot') {
      $standalone = Join-Path $appDir 'modules\standalone.js'
      if (-not (Test-Path $standalone)) { Fail ('[错误] 找不到: ' + $standalone); break }
      $env:ELECTRON_RUN_AS_NODE = '1'
      & $electron $standalone $Target 2>&1 | Tee-Object -FilePath $logFile
    }
    else {
      Fail ('用法: launch.ps1 <app|napcat|bot|diagnose|uninstall>')
    }

    # 退出后提示日志位置
    Write-Host ''
    Write-Host '────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ('日志目录: ' + $logDir) -ForegroundColor Yellow
    Write-Host '出问题时，请把这个【整个 logs 文件夹】发给开发者。' -ForegroundColor Yellow
    Write-Host '────────────────────────────────────────' -ForegroundColor DarkGray
  }
}
