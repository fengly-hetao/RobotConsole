@echo off
chcp 65001 >nul
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\launch.ps1" uninstall
popd
echo.
pause
exit /b 0
