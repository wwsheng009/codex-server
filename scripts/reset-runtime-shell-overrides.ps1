[CmdletBinding()]
param(
  [switch]$KeepTempFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$metadataPath = Join-Path $repoRoot 'backend\data\metadata.json'
$localAppDataDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$tempCatalogDir = Join-Path $localAppDataDir 'Temp\codex-server'

if (-not (Test-Path $metadataPath)) {
  throw "metadata.json not found at $metadataPath"
}

$document = Get-Content $metadataPath -Raw | ConvertFrom-Json -AsHashtable
$preferences = @{}

if ($document.ContainsKey('runtimePreferences') -and $document.runtimePreferences) {
  if ($document.runtimePreferences.ContainsKey('modelCatalogPath')) {
    $preferences['modelCatalogPath'] = $document.runtimePreferences['modelCatalogPath']
  }
  if ($document.runtimePreferences.ContainsKey('updatedAt')) {
    $preferences['updatedAt'] = $document.runtimePreferences['updatedAt']
  }
}

$document['runtimePreferences'] = $preferences
$document | ConvertTo-Json -Depth 100 | Set-Content -Path $metadataPath

$removedTempFiles = 0
if (-not $KeepTempFiles -and (Test-Path $tempCatalogDir)) {
  $tempFiles = @(Get-ChildItem $tempCatalogDir -Filter 'model-catalog-shell-overrides-*.json' -ErrorAction SilentlyContinue)
  foreach ($file in $tempFiles) {
    Remove-Item $file.FullName -Force
    $removedTempFiles += 1
  }
}

Write-Host "Reset runtime shell overrides in $metadataPath"
Write-Host "Preserved modelCatalogPath and removed service-level shell override fields."
if (-not $KeepTempFiles) {
  Write-Host "Removed $removedTempFiles temp override catalog file(s) from $tempCatalogDir"
}
Write-Host 'Restart codex-server backend to apply the updated runtime preferences.'
