@echo off
setlocal EnableExtensions
title Vid Search
cd /d "%~dp0"

echo.
echo  ========================================
echo   Vid Search launcher
echo  ========================================
echo   Working dir: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js not found on PATH. Install from https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo  [OK] node found

if not exist node_modules (
  echo  Installing dependencies, please wait ^(2-4 min, downloads Electron + ffmpeg^)...
  call npm install
  if errorlevel 1 (
    echo  [X] npm install failed.
    pause
    exit /b 1
  )
)
echo  [OK] node_modules present

echo.
echo  Launching the app. A window will open in a few seconds.
echo  Leave this terminal open while you use the app.
echo  Close the app window or press Ctrl+C here to stop.
echo.

call npm run dev
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" (
  echo.
  echo  npm run dev exited with code %EXITCODE%
  echo  Something went wrong - see the output above.
  pause
)
