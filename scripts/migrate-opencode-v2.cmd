@echo off
setlocal
rem Wrapper: runs migrate-opencode-v2.sh through Git Bash (NOT WSL).
set "GIT_BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GIT_BASH%" set "GIT_BASH=%ProgramW6432%\Git\bin\bash.exe"
if not exist "%GIT_BASH%" set "GIT_BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not exist "%GIT_BASH%" (
  echo ERROR: Git Bash not found. Install Git for Windows: https://git-scm.com/download/win
  exit /b 1
)
"%GIT_BASH%" "%~dp0migrate-opencode-v2.sh" %*
exit /b %errorlevel%
