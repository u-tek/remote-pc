@echo off
rem Double-click to install (first run), build and start the Remote PC agent.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies...
  call npm install || (pause & exit /b 1)
)
call npm run build || (pause & exit /b 1)
node dist\index.js start
pause
