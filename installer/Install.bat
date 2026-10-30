@echo off
setlocal
"%SystemRoot%\System32\chcp.com" 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set RC=%ERRORLEVEL%
if not "%RC%"=="0" (
  echo.
  echo Installer failed with code %RC%
  pause
)
endlocal
