@echo off
rem =====================================================
rem  muan-workbench  one-click launcher (Windows)
rem  Usage: double-click this file, or run in a terminal.
rem =====================================================
setlocal
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js 18 or newer from https://nodejs.org then retry.
  pause
  exit /b 1
)

echo Starting muan-workbench server...
echo Keep this black window open while using the app.
echo The console will print the real address (localhost:PORT).
start "muan-workbench server" cmd /k "node server.js"

timeout /t 2 >nul
start "" "http://localhost:8765/"
endlocal
