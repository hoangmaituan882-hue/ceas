# 开发会话环境：把所有临时目录与工具链缓存挪到 E 盘
# 用法：在项目根目录执行  . .\scripts\env.ps1   （前面有一个点）

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ($root -match '^(?i:C):') { throw '请把项目放在非 C 盘后再启动开发环境。' }
$cache = Join-Path $root ".cache"

$dirs = @(
  "$cache/tmp",
  "$cache/npm",
  "$cache/pnpm",
  "$cache/cargo-home",
  "$cache/rustup-home",
  "$cache/pip",
  "$cache/playwright"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# 临时文件：Windows 默认为 %TEMP%，是本机最容易漏掉的一块
$env:TEMP   = "$cache/tmp"
$env:TMP    = "$cache/tmp"
$env:TMPDIR = "$cache/tmp"

# Node / 包管理器
$env:npm_config_cache = "$cache/npm"
$env:npm_config_store_dir = "$cache/pnpm"

# Rust 工具链（默认为 C:\Users\<name>\.cargo 与 .rustup）
$env:CARGO_HOME  = "$cache/cargo-home"
$env:RUSTUP_HOME = "$cache/rustup-home"

# Tauri 构建产物跟随 Cargo：仓库内 target/ 已在 E 盘，无需单独设置

# Python
$env:PIP_CACHE_DIR = "$cache/pip"

# Playwright 浏览器（默认在 %LOCALAPPDATA%\ms-playwright）
$env:PLAYWRIGHT_BROWSERS_PATH = "$cache/playwright"

Write-Host "env ready · TEMP=$env:TEMP" -ForegroundColor Green
Write-Host "cargo=$env:CARGO_HOME" -ForegroundColor DarkGray
Write-Host "playwright=$env:PLAYWRIGHT_BROWSERS_PATH" -ForegroundColor DarkGray
