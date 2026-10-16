@echo off
setlocal
rem Starts the self-hosted runner set up by setup-mod-runner.bat. It picks up queued builds
rem while this window is open (Ctrl+C stops it).
rem
rem Usage:   start-mod-runner.bat [runner folder]
rem Example: start-mod-runner.bat F:\actions-runner
rem          Without a folder, uses %RUNNER_DIR% if set, otherwise C:\actions-runner.

set "DIR=%~1"
if "%DIR%"=="" if defined RUNNER_DIR set "DIR=%RUNNER_DIR%"
if "%DIR%"=="" set "DIR=C:\actions-runner"
if not exist "%DIR%\.runner" ( echo No registered runner in "%DIR%". Run setup-mod-runner.bat first. & exit /b 1 )

rem Some shells set this, and then cmd won't run run.cmd's helper scripts from the runner folder.
set NoDefaultCurrentDirectoryInExePath=
cd /d "%DIR%"
call run.cmd
