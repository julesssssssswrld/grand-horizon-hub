@echo off
rem Usage: stop.bat          stops the Node server and MySQL
rem        stop.bat nodb     stops only the Node server (keeps MySQL running)
setlocal
cd /d "%~dp0"

set "MYSQL_DIR=C:\xampp\mysql"
set "PORT=3000"

echo Stopping Node server on port %PORT%...
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 }; if (-not $p) { '      Nothing was using port %PORT%.' } else { $p | ForEach-Object { Stop-Process -Id $_ -Force; '      Stopped PID ' + $_ } }"

if /i "%~1"=="nodb" (
  echo Leaving MySQL running ^(nodb^).
  goto done
)

echo Stopping MySQL...
"%MYSQL_DIR%\bin\mysqladmin.exe" -u root ping >nul 2>&1
if errorlevel 1 (
  echo       MySQL was not running.
) else (
  "%MYSQL_DIR%\bin\mysqladmin.exe" -u root shutdown && echo       MySQL stopped.
)

:done
echo Done.
timeout /t 2 >nul
