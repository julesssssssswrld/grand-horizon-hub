@echo off
setlocal
cd /d "%~dp0"
title Grand Horizon Hub

set "PORT=3000"

echo [1/2] Checking MySQL on port 3306...
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue)) { exit 1 }"
if errorlevel 1 (
  echo       ERROR: MySQL is not running. Start it from the XAMPP Control Panel, then re-run.
  pause
  exit /b 1
)
echo       MySQL is running.

echo [2/2] Starting server...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo       ERROR: port %PORT% is already in use. Run stop.bat first.
  pause
  exit /b 1
)

echo.
echo   Dashboard: http://localhost:%PORT%
echo   Logs appear below. Press Ctrl+C to stop the server.
echo   ------------------------------------------------------
node server.js

echo.
echo Server exited with code %errorlevel%.
pause
