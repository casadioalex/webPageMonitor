@echo off
cd /d "%~dp0.."
call npm run scan -- %*
exit /b %ERRORLEVEL%
