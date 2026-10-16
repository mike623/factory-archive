@echo off
setlocal
rem Registers this Windows PC as the GitHub Actions runner that builds the companion mod
rem (.github/workflows/mod.yml), sets the UE_ROOT / SML_PROJECT repo variables, then starts it.
rem
rem Usage:   setup-mod-runner.bat <engine folder> <starter project folder>
rem Example: setup-mod-runner.bat "C:\Program Files\Unreal Engine - CSS" C:\SML
rem          The runner goes in C:\actions-runner. To use another folder, first: set RUNNER_DIR=F:\actions-runner
rem Needs:   git, gh (logged in with "gh auth login"), pwsh
rem Later:   start the runner again with start-mod-runner.bat

set REPO=mike623/factory-archive
if not defined RUNNER_DIR set RUNNER_DIR=C:\actions-runner
rem Some shells set this, and then cmd won't run config.cmd / run.cmd from the runner folder.
set NoDefaultCurrentDirectoryInExePath=
set UE_ROOT=%~1
set SML_PROJECT=%~2

if "%SML_PROJECT%"=="" ( echo Usage: %~nx0 ^<engine folder^> ^<starter project folder^> & exit /b 1 )
if not exist "%UE_ROOT%\Engine\Build\BatchFiles\Build.bat" ( echo Engine not found in "%UE_ROOT%" & exit /b 1 )
if not exist "%SML_PROJECT%\FactoryGame.uproject" ( echo Starter project not found in "%SML_PROJECT%" & exit /b 1 )
for %%c in (git gh pwsh) do where %%c >nul 2>nul || ( echo Missing %%c. Install: winget install Git.Git GitHub.cli Microsoft.PowerShell & exit /b 1 )
gh auth status >nul 2>nul || ( echo Not logged in. Run: gh auth login & exit /b 1 )

if not exist "%RUNNER_DIR%\config.cmd" (
  echo Downloading the GitHub Actions runner...
  pwsh -NoProfile -Command "$v = (gh api repos/actions/runner/releases/latest -q .tag_name).TrimStart('v'); Invoke-WebRequest ('https://github.com/actions/runner/releases/download/v' + $v + '/actions-runner-win-x64-' + $v + '.zip') -OutFile $env:TEMP\runner.zip; Expand-Archive $env:TEMP\runner.zip '%RUNNER_DIR%' -Force"
  if errorlevel 1 ( echo Download failed & exit /b 1 )
)

rem Short-lived (1 hour) token; needs admin rights on the repo, which the owner has.
set TOKEN=
for /f %%t in ('gh api -X POST repos/%REPO%/actions/runners/registration-token -q .token') do set TOKEN=%%t
if "%TOKEN%"=="" ( echo Couldn't get a registration token & exit /b 1 )

pushd "%RUNNER_DIR%"
call config.cmd --unattended --replace --url https://github.com/%REPO% --token %TOKEN% --name %COMPUTERNAME% --labels satisfactory-modding --work _work
if errorlevel 1 ( popd & echo Runner registration failed & exit /b 1 )
popd

gh variable set UE_ROOT -R %REPO% -b "%UE_ROOT%" || exit /b 1
gh variable set SML_PROJECT -R %REPO% -b "%SML_PROJECT%" || exit /b 1

echo.
echo Runner registered. It picks up queued builds while this window is open (Ctrl+C stops it).
echo Next time, run: scripts\start-mod-runner.bat "%RUNNER_DIR%"
cd /d "%RUNNER_DIR%"
call run.cmd
