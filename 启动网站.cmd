@echo off
cd /d "%~dp0"
node server/import-catalog.mjs
if errorlevel 1 goto failed
if not exist dist\client\index.html call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo Open http://127.0.0.1:4180/ in your browser.
echo Keep this window open while using the website.
node server/index.mjs
:failed
pause
