param([switch]$Browser)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/env.ps1"
node "$PSScriptRoot/check-paths.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 可执行文件只读复用；Cargo 缓存与构建目标仍在 env.ps1 指定的非 C 盘目录。
$taskToolchainCandidates = @(
  (Join-Path $env:RUSTUP_HOME 'toolchains'),
  (Join-Path $env:USERPROFILE '.rustup/toolchains')
)
$taskToolchain = $taskToolchainCandidates | Where-Object { Test-Path -LiteralPath $_ } |
  ForEach-Object { Get-ChildItem -LiteralPath $_ -Directory } |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/cargo.exe') } |
  Sort-Object @{Expression={try{[version](($_.Name -split '-')[0])}catch{[version]'0.0'}}} -Descending | Select-Object -First 1
if (-not $taskToolchain) { throw '未找到已安装的 Rust 工具链，请先在非 C 盘配置工具链。' }
$env:RUSTC = Join-Path $taskToolchain.FullName 'bin/rustc.exe'
$env:RUSTDOC = Join-Path $taskToolchain.FullName 'bin/rustdoc.exe'
$taskCargo = Join-Path $taskToolchain.FullName 'bin/cargo.exe'
$taskRoot = Split-Path -Parent $PSScriptRoot
& $taskCargo test --manifest-path "$taskRoot/src-tauri/Cargo.toml" --lib --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Browser) {
  & $taskCargo build --manifest-path "$PSScriptRoot/native-store-probe/Cargo.toml" --target-dir "$taskRoot/src-tauri/target" --locked
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node "$PSScriptRoot/check-library-management.mjs"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
