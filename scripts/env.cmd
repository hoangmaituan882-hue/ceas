@echo off
REM Dev session env: keep every cache and temp dir on drive E.
REM Usage: call scripts\env.cmd
REM Keep this file ASCII-only: cmd.exe decodes it with the OEM codepage.

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
if /i "%ROOT:~0,2%"=="C:" (
  echo Please move this project to a non-system drive.
  exit /b 1
)
set "CACHE=%ROOT%\.cache"

for %%D in (tmp npm pnpm cargo-home rustup-home pip playwright) do (
  if not exist "%CACHE%\%%D" mkdir "%CACHE%\%%D"
)

set "TEMP=%CACHE%\tmp"
set "TMP=%CACHE%\tmp"
set "TMPDIR=%CACHE%\tmp"
set "npm_config_cache=%CACHE%\npm"
set "npm_config_store_dir=%CACHE%\pnpm"
set "CARGO_HOME=%CACHE%\cargo-home"
set "RUSTUP_HOME=%CACHE%\rustup-home"
set "PIP_CACHE_DIR=%CACHE%\pip"
set "PLAYWRIGHT_BROWSERS_PATH=%CACHE%\playwright"

echo env ready - TEMP=%TEMP%
