[CmdletBinding()]
param(
  [string]$Addr = $env:CODEX_SERVER_ADDR,
  [string]$FrontendOrigin = $env:CODEX_FRONTEND_ORIGIN,
  [string]$AppServerCommand = $env:CODEX_APP_SERVER_COMMAND,
  [string]$ModelCatalogPath = $env:CODEX_MODEL_CATALOG_JSON,
  [string]$LocalShellModels = $env:CODEX_LOCAL_SHELL_MODELS,
  [string]$StorePath = $env:CODEX_SERVER_STORE_PATH
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backendDir = Join-Path $repoRoot 'backend'
$tmpDir = Join-Path $repoRoot 'tmp'
$goExe = Join-Path $env:ProgramFiles 'Go\bin\go.exe'

if (-not (Test-Path $goExe)) {
  throw "Go executable not found at $goExe"
}

$homeDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$appDataDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
$localAppDataDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$tempDir = [System.IO.Path]::GetTempPath().TrimEnd('\', '/')

if ([string]::IsNullOrWhiteSpace($homeDir)) {
  throw 'Unable to resolve the current user profile directory.'
}

$goPath = if ([string]::IsNullOrWhiteSpace($env:GOPATH)) {
  Join-Path $homeDir 'go'
} else {
  $env:GOPATH
}
$goModCache = if ([string]::IsNullOrWhiteSpace($env:GOMODCACHE)) {
  Join-Path $goPath 'pkg\mod'
} else {
  $env:GOMODCACHE
}
$goCache = if ([string]::IsNullOrWhiteSpace($env:GOCACHE)) {
  Join-Path $localAppDataDir 'go-build'
} else {
  $env:GOCACHE
}

foreach ($dir in @($tmpDir, $goPath, $goModCache, $goCache)) {
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
}

$env:USERPROFILE = $homeDir
$env:HOME = $homeDir
$env:HOMEDRIVE = [System.IO.Path]::GetPathRoot($homeDir).TrimEnd('\')
$env:HOMEPATH = $homeDir.Substring($env:HOMEDRIVE.Length)
$env:APPDATA = $appDataDir
$env:LOCALAPPDATA = $localAppDataDir
$env:TEMP = $tempDir
$env:TMP = $tempDir
$env:GOPATH = $goPath
$env:GOMODCACHE = $goModCache
$env:GOCACHE = $goCache

if (-not [string]::IsNullOrWhiteSpace($Addr)) {
  $env:CODEX_SERVER_ADDR = $Addr
}
if (-not [string]::IsNullOrWhiteSpace($FrontendOrigin)) {
  $env:CODEX_FRONTEND_ORIGIN = $FrontendOrigin
}
if (-not [string]::IsNullOrWhiteSpace($AppServerCommand)) {
  $env:CODEX_APP_SERVER_COMMAND = $AppServerCommand
}
if (-not [string]::IsNullOrWhiteSpace($ModelCatalogPath)) {
  $env:CODEX_MODEL_CATALOG_JSON = $ModelCatalogPath
}
if (-not [string]::IsNullOrWhiteSpace($LocalShellModels)) {
  $env:CODEX_LOCAL_SHELL_MODELS = $LocalShellModels
}
if (-not [string]::IsNullOrWhiteSpace($StorePath)) {
  $env:CODEX_SERVER_STORE_PATH = $StorePath
}

Write-Host "Starting codex-server backend from $backendDir"
Write-Host "USERPROFILE=$env:USERPROFILE"
Write-Host "GOPATH=$env:GOPATH"
Write-Host "GOMODCACHE=$env:GOMODCACHE"
Write-Host "GOCACHE=$env:GOCACHE"

Push-Location $backendDir
try {
  & $goExe run ./cmd/server
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
