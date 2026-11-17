@echo off
chcp 65001 >nul
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\launch.ps1" app
popd
if not "%ERRORLEVEL%"=="0" pause
exit /b 0
