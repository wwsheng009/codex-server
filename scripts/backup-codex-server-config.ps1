[CmdletBinding()]
param(
  [string]$OutputPath,
  [string]$StorePath = $env:CODEX_SERVER_STORE_PATH,
  [switch]$Force
)

if ($PSVersionTable.PSVersion.Major -lt 6) {
  $pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($null -ne $pwshCommand) {
    $forwardedArgs = @(
      '-NoProfile'
      '-ExecutionPolicy'
      'Bypass'
      '-File'
      $PSCommandPath
    )

    if ($PSBoundParameters.ContainsKey('OutputPath')) {
      $forwardedArgs += @('-OutputPath', $OutputPath)
    }
    if ($PSBoundParameters.ContainsKey('StorePath')) {
      $forwardedArgs += @('-StorePath', $StorePath)
    }
    if ($Force) {
      $forwardedArgs += '-Force'
    }

    & $pwshCommand.Source @forwardedArgs
    exit $LASTEXITCODE
  }
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NormalizedPath {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Resolve-PathCandidates {
  param(
    [Parameter(Mandatory)]
    [string]$Path,
    [string[]]$BasePaths = @()
  )

  $trimmed = $Path.Trim()
  if ($trimmed -eq '') {
    return @()
  }

  $results = New-Object System.Collections.Generic.List[string]
  $seen = @{}

  if ([System.IO.Path]::IsPathRooted($trimmed)) {
    $normalized = Get-NormalizedPath -Path $trimmed
    $results.Add($normalized)
    return ,$results.ToArray()
  }

  foreach ($basePath in $BasePaths) {
    if ([string]::IsNullOrWhiteSpace($basePath)) {
      continue
    }

    $candidate = Get-NormalizedPath -Path (Join-Path $basePath $trimmed)
    if ($seen.ContainsKey($candidate)) {
      continue
    }
    $seen[$candidate] = $true
    $results.Add($candidate)
  }

  return ,$results.ToArray()
}

function Get-SafePathSegment {
  param(
    [Parameter(Mandatory)]
    [string]$Value
  )

  $trimmed = $Value.Trim()
  if ($trimmed -eq '') {
    return 'item'
  }

  $safe = $trimmed
  foreach ($invalidChar in [System.IO.Path]::GetInvalidFileNameChars()) {
    $safe = $safe.Replace([string]$invalidChar, '-')
  }
  $safe = $safe -replace '\s+', '-'
  $safe = $safe -replace '-+', '-'
  $safe = $safe.Trim('-')
  if ($safe -eq '') {
    return 'item'
  }
  return $safe
}

function Ensure-Directory {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Copy-FileToBackup {
  param(
    [Parameter(Mandatory)]
    [string]$SourcePath,
    [Parameter(Mandatory)]
    [string]$DestinationPath
  )

  Ensure-Directory -Path (Split-Path -Parent $DestinationPath)
  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}

function Copy-DirectoryToBackup {
  param(
    [Parameter(Mandatory)]
    [string]$SourcePath,
    [Parameter(Mandatory)]
    [string]$DestinationPath
  )

  if (Test-Path -LiteralPath $DestinationPath) {
    Remove-Item -LiteralPath $DestinationPath -Recurse -Force
  }
  Ensure-Directory -Path (Split-Path -Parent $DestinationPath)
  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
}

function Read-JsonFileAsHashtable {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $rawJson = Get-Content -LiteralPath $Path -Raw

  if ($PSVersionTable.PSVersion.Major -ge 6) {
    return $rawJson | ConvertFrom-Json -AsHashtable
  }

  $document = $rawJson | ConvertFrom-Json
  return ConvertTo-PlainData -Value $document
}

function ConvertTo-PlainData {
  param(
    $Value
  )

  if ($null -eq $Value) {
    return $null
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $result = @{}
    foreach ($key in $Value.Keys) {
      $result[$key] = ConvertTo-PlainData -Value $Value[$key]
    }
    return $result
  }

  if (($Value -is [System.Management.Automation.PSCustomObject]) -or ($Value -is [System.Management.Automation.PSObject])) {
    $result = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-PlainData -Value $property.Value
    }
    return $result
  }

  if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
    $items = New-Object System.Collections.Generic.List[object]
    foreach ($item in $Value) {
      $items.Add((ConvertTo-PlainData -Value $item))
    }
    return $items.ToArray()
  }

  return $Value
}

function Get-WorkspaceKey {
  param(
    [hashtable]$Workspace
  )

  $rootPath = ''
  if ($Workspace.ContainsKey('rootPath') -and $Workspace.rootPath) {
    $rootPath = [string]$Workspace.rootPath
  }
  $workspaceID = ''
  if ($Workspace.ContainsKey('id') -and $Workspace.id) {
    $workspaceID = [string]$Workspace.id
  }

  if (-not [string]::IsNullOrWhiteSpace($rootPath)) {
    try {
      return 'root:' + (Get-NormalizedPath -Path $rootPath).ToLowerInvariant()
    } catch {
      return 'root:' + $rootPath.Trim().ToLowerInvariant()
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($workspaceID)) {
    return 'id:' + $workspaceID.Trim().ToLowerInvariant()
  }

  return ''
}

function Add-StringValue {
  param(
    [ref]$Items,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }

  $trimmed = $Value.Trim()
  if ($Items.Value -contains $trimmed) {
    return
  }
  $Items.Value += $trimmed
}

function Get-CodexHomePath {
  $explicit = $env:CODEX_HOME
  if (-not [string]::IsNullOrWhiteSpace($explicit)) {
    return Get-NormalizedPath -Path $explicit
  }

  $homeDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  if ([string]::IsNullOrWhiteSpace($homeDir)) {
    return ''
  }

  return Join-Path $homeDir '.codex'
}

function Get-ModelCatalogPathFromCodexHomeConfig {
  param(
    [Parameter(Mandatory)]
    [string]$ConfigPath,
    [Parameter(Mandatory)]
    [string]$CodexHome
  )

  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    return $null
  }

  $content = Get-Content -LiteralPath $ConfigPath -Raw
  $match = [regex]::Match(
    $content,
    '(?m)^\s*model_catalog_json\s*=\s*["''](?<path>[^"'']+)["'']\s*$'
  )
  if (-not $match.Success) {
    return $null
  }

  $rawPath = $match.Groups['path'].Value.Trim()
  if ($rawPath -eq '') {
    return $null
  }

  $candidates = Resolve-PathCandidates -Path $rawPath -BasePaths @($CodexHome)
  if ($candidates.Count -gt 0) {
    return @{
      RawPath        = $rawPath
      ResolvedPaths  = $candidates
      ResolutionBase = 'codex-home'
    }
  }

  return @{
    RawPath        = $rawPath
    ResolvedPaths  = @()
    ResolutionBase = 'codex-home'
  }
}

$repoRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..')
$backendDir = Join-Path $repoRoot 'backend'
$codexHome = Get-CodexHomePath

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $OutputPath = Join-Path $repoRoot "backups\codex-server-config-backup-$timestamp"
}

$backupRoot = Get-NormalizedPath -Path $OutputPath
if (Test-Path -LiteralPath $backupRoot) {
  $existingItems = @(Get-ChildItem -LiteralPath $backupRoot -Force -ErrorAction SilentlyContinue)
  if ($existingItems.Count -gt 0 -and -not $Force) {
    throw "Output directory already exists and is not empty: $backupRoot"
  }
}
Ensure-Directory -Path $backupRoot

$manifest = [ordered]@{
  generatedAtUtc          = (Get-Date).ToUniversalTime().ToString('o')
  repoRoot                = $repoRoot
  backendDir              = $backendDir
  backupRoot              = $backupRoot
  codexHome               = $codexHome
  preferredStorePath      = $null
  stores                  = @()
  workspaces              = @()
  codexHomeFiles          = @()
  referencedFiles         = @()
  environmentSnapshotPath = $null
  notes                   = @(
    'Stop codex-server before restoring these files.',
    'This backup does not include browser localStorage state.',
    'The store metadata file also contains application state in addition to configuration.'
  )
}

$storesDir = Join-Path $backupRoot 'stores'
$workspacesDir = Join-Path $backupRoot 'workspaces'
$codexHomeBackupDir = Join-Path $backupRoot 'codex-home'
$referencedFilesDir = Join-Path $backupRoot 'referenced-files'
$environmentDir = Join-Path $backupRoot 'environment'
Ensure-Directory -Path $storesDir
Ensure-Directory -Path $workspacesDir
Ensure-Directory -Path $codexHomeBackupDir
Ensure-Directory -Path $referencedFilesDir
Ensure-Directory -Path $environmentDir

$storeCandidates = New-Object System.Collections.Generic.List[hashtable]
$seenStorePaths = @{}

function Add-StoreCandidate {
  param(
    [Parameter(Mandatory)]
    [string]$Label,
    [Parameter(Mandatory)]
    [string]$CandidatePath
  )

  $normalized = Get-NormalizedPath -Path $CandidatePath
  if ($seenStorePaths.ContainsKey($normalized)) {
    return
  }
  $seenStorePaths[$normalized] = $true
  $storeCandidates.Add([ordered]@{
    Label = $Label
    Path  = $normalized
  })
}

if (-not [string]::IsNullOrWhiteSpace($StorePath)) {
  $resolvedStoreCandidates = Resolve-PathCandidates -Path $StorePath -BasePaths @($repoRoot, $backendDir)
  $candidateIndex = 0
  foreach ($resolvedStoreCandidate in $resolvedStoreCandidates) {
    $candidateIndex += 1
    Add-StoreCandidate -Label "configured-store-$candidateIndex" -CandidatePath $resolvedStoreCandidate
  }
}

Add-StoreCandidate -Label 'repo-root-default' -CandidatePath (Join-Path $repoRoot 'data\metadata.json')
Add-StoreCandidate -Label 'backend-default' -CandidatePath (Join-Path $backendDir 'data\metadata.json')

$workspaceMap = @{}
$referencedFileMap = @{}

function Register-ReferencedFile {
  param(
    [Parameter(Mandatory)]
    [string]$Label,
    [Parameter(Mandatory)]
    [string]$RawPath,
    [string[]]$BasePaths = @()
  )

  if ([string]::IsNullOrWhiteSpace($RawPath)) {
    return
  }

  $resolvedPaths = Resolve-PathCandidates -Path $RawPath -BasePaths $BasePaths
  if ($resolvedPaths.Count -eq 0) {
    $manifest.referencedFiles += [ordered]@{
      label        = $Label
      rawPath      = $RawPath
      exists       = $false
      originalPath = $null
      backupPath   = $null
    }
    return
  }

  foreach ($resolvedPath in $resolvedPaths) {
    if ($referencedFileMap.ContainsKey($resolvedPath)) {
      $entry = $referencedFileMap[$resolvedPath]
      $labels = @($entry.labels)
      Add-StringValue -Items ([ref]$labels) -Value $Label
      $entry.labels = $labels
      continue
    }

    $entry = [ordered]@{
      labels       = @($Label)
      rawPath      = $RawPath
      exists       = Test-Path -LiteralPath $resolvedPath -PathType Leaf
      originalPath = $resolvedPath
      backupPath   = $null
    }
    $referencedFileMap[$resolvedPath] = $entry
  }
}

$storeBackupIndex = 0
foreach ($storeCandidate in $storeCandidates) {
  $storeExists = Test-Path -LiteralPath $storeCandidate.Path -PathType Leaf
  $storeEntry = [ordered]@{
    label                    = $storeCandidate.Label
    originalPath             = $storeCandidate.Path
    exists                   = $storeExists
    preferred                = $false
    backupPath               = $null
    sidecarDirectoryPath     = $null
    sidecarBackupPath        = $null
    parseStatus              = 'not_read'
    parseError               = $null
    workspaceCount           = 0
    runtimePreferenceSummary = $null
  }

  if ($storeExists) {
    if ($null -eq $manifest.preferredStorePath) {
      $manifest.preferredStorePath = $storeCandidate.Path
      $storeEntry.preferred = $true
    }

    $storeBackupIndex += 1
    $storeBackupDir = Join-Path $storesDir ('{0:D2}-{1}' -f $storeBackupIndex, (Get-SafePathSegment -Value $storeCandidate.Label))
    Ensure-Directory -Path $storeBackupDir

    $storeBackupPath = Join-Path $storeBackupDir 'metadata.json'
    $storeEntry.backupPath = $storeBackupPath

    $storeDocument = $null
    $lastParseError = $null
    foreach ($attempt in 1..3) {
      Copy-FileToBackup -SourcePath $storeCandidate.Path -DestinationPath $storeBackupPath

      try {
        $storeDocument = Read-JsonFileAsHashtable -Path $storeBackupPath
        $storeEntry.parseStatus = 'ok'
        $lastParseError = $null
        break
      } catch {
        $lastParseError = $_.Exception.Message
        if ($attempt -lt 3) {
          Start-Sleep -Milliseconds 250
        }
      }
    }

    $sidecarDir = Join-Path (Split-Path -Parent $storeCandidate.Path) 'thread-projections'
    if (Test-Path -LiteralPath $sidecarDir -PathType Container) {
      $sidecarBackupPath = Join-Path $storeBackupDir 'thread-projections'
      Copy-DirectoryToBackup -SourcePath $sidecarDir -DestinationPath $sidecarBackupPath
      $storeEntry.sidecarDirectoryPath = $sidecarDir
      $storeEntry.sidecarBackupPath = $sidecarBackupPath
    }

    if ($null -ne $storeDocument) {

      if ($storeDocument.ContainsKey('runtimePreferences') -and $storeDocument.runtimePreferences) {
        $runtimePreferences = $storeDocument.runtimePreferences
        $summary = [ordered]@{}
        if ($runtimePreferences.ContainsKey('modelCatalogPath')) {
          $summary.modelCatalogPath = $runtimePreferences.modelCatalogPath
          Register-ReferencedFile `
            -Label ("runtime-preferences:{0}:modelCatalogPath" -f $storeCandidate.Label) `
            -RawPath ([string]$runtimePreferences.modelCatalogPath) `
            -BasePaths @($repoRoot, $backendDir)
        }
        if ($runtimePreferences.ContainsKey('updatedAt')) {
          $summary.updatedAt = $runtimePreferences.updatedAt
        }
        if ($runtimePreferences.ContainsKey('allowRemoteAccess')) {
          $summary.allowRemoteAccess = $runtimePreferences.allowRemoteAccess
        }
        if ($runtimePreferences.ContainsKey('allowLocalhostWithoutAccessToken')) {
          $summary.allowLocalhostWithoutAccessToken = $runtimePreferences.allowLocalhostWithoutAccessToken
        }
        if ($summary.Count -gt 0) {
          $storeEntry.runtimePreferenceSummary = $summary
        }
      }

      if ($storeDocument.ContainsKey('workspaces') -and $storeDocument.workspaces) {
        foreach ($workspace in $storeDocument.workspaces) {
          if ($workspace -isnot [hashtable]) {
            continue
          }

          $workspaceKey = Get-WorkspaceKey -Workspace $workspace
          if ($workspaceKey -eq '') {
            continue
          }

          if (-not $workspaceMap.ContainsKey($workspaceKey)) {
            $workspaceMap[$workspaceKey] = [ordered]@{
              workspaceId   = if ($workspace.ContainsKey('id')) { [string]$workspace.id } else { '' }
              name          = if ($workspace.ContainsKey('name')) { [string]$workspace.name } else { '' }
              rootPath      = if ($workspace.ContainsKey('rootPath')) { [string]$workspace.rootPath } else { '' }
              sourceStores  = @()
              configFiles   = @()
            }
          }

          $workspaceEntry = $workspaceMap[$workspaceKey]
          $sourceStores = @($workspaceEntry.sourceStores)
          Add-StringValue -Items ([ref]$sourceStores) -Value $storeCandidate.Label
          $workspaceEntry.sourceStores = $sourceStores
          $storeEntry.workspaceCount += 1
        }
      }
    } else {
      $storeEntry.parseStatus = 'error'
      $storeEntry.parseError = $lastParseError
    }
  }

  $manifest.stores += $storeEntry
}

$workspaceBackupIndex = 0
foreach ($workspaceEntry in ($workspaceMap.Values | Sort-Object rootPath, workspaceId, name)) {
  $workspaceBackupIndex += 1
  $workspaceLabel = if (-not [string]::IsNullOrWhiteSpace($workspaceEntry.workspaceId)) {
    $workspaceEntry.workspaceId
  } elseif (-not [string]::IsNullOrWhiteSpace($workspaceEntry.name)) {
    $workspaceEntry.name
  } else {
    'workspace'
  }

  $workspaceBackupDir = Join-Path $workspacesDir ('{0:D2}-{1}' -f $workspaceBackupIndex, (Get-SafePathSegment -Value $workspaceLabel))
  Ensure-Directory -Path $workspaceBackupDir

  $workspaceInfoPath = Join-Path $workspaceBackupDir 'workspace-info.json'
  [ordered]@{
    workspaceId  = $workspaceEntry.workspaceId
    name         = $workspaceEntry.name
    rootPath     = $workspaceEntry.rootPath
    sourceStores = $workspaceEntry.sourceStores
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $workspaceInfoPath

  $configFiles = @()
  if (-not [string]::IsNullOrWhiteSpace($workspaceEntry.rootPath)) {
    foreach ($candidate in @(
      @{
        Label        = 'workspace-mcp-config'
        OriginalPath = Join-Path $workspaceEntry.rootPath '.codex\config.toml'
        RelativePath = 'files\.codex\config.toml'
      },
      @{
        Label        = 'workspace-hooks'
        OriginalPath = Join-Path $workspaceEntry.rootPath '.codex\hooks.json'
        RelativePath = 'files\.codex\hooks.json'
      },
      @{
        Label        = 'workspace-legacy-hooks'
        OriginalPath = Join-Path $workspaceEntry.rootPath 'hooks.json'
        RelativePath = 'files\hooks.json'
      }
    )) {
      $candidateExists = Test-Path -LiteralPath $candidate.OriginalPath -PathType Leaf
      $backupPath = $null
      if ($candidateExists) {
        $backupPath = Join-Path $workspaceBackupDir $candidate.RelativePath
        Copy-FileToBackup -SourcePath $candidate.OriginalPath -DestinationPath $backupPath
      }

      $configFiles += [ordered]@{
        label        = $candidate.Label
        originalPath = $candidate.OriginalPath
        exists       = $candidateExists
        backupPath   = $backupPath
      }
    }
  }

  $workspaceEntry.configFiles = $configFiles
  $manifest.workspaces += $workspaceEntry
}

$codexHomeConfigPath = $null
foreach ($codexHomeFile in @('config.toml', 'hooks.json')) {
  $originalPath = Join-Path $codexHome $codexHomeFile
  $exists = Test-Path -LiteralPath $originalPath -PathType Leaf
  $backupPath = $null
  if ($exists) {
    $backupPath = Join-Path $codexHomeBackupDir $codexHomeFile
    Copy-FileToBackup -SourcePath $originalPath -DestinationPath $backupPath
  }

  if ($codexHomeFile -eq 'config.toml' -and $exists) {
    $codexHomeConfigPath = $originalPath
  }

  $manifest.codexHomeFiles += [ordered]@{
    originalPath = $originalPath
    exists       = $exists
    backupPath   = $backupPath
  }
}

if ($codexHomeConfigPath) {
  $codexHomeModelCatalog = Get-ModelCatalogPathFromCodexHomeConfig -ConfigPath $codexHomeConfigPath -CodexHome $codexHome
  if ($codexHomeModelCatalog) {
    foreach ($resolvedCodexHomeModelCatalogPath in $codexHomeModelCatalog.ResolvedPaths) {
      Register-ReferencedFile `
        -Label 'codex-home:model_catalog_json' `
        -RawPath $resolvedCodexHomeModelCatalogPath `
        -BasePaths @()
    }
    if ($codexHomeModelCatalog.ResolvedPaths.Count -eq 0) {
      Register-ReferencedFile `
        -Label 'codex-home:model_catalog_json' `
        -RawPath $codexHomeModelCatalog.RawPath `
        -BasePaths @($codexHome)
    }
  }
}

if (-not [string]::IsNullOrWhiteSpace($env:CODEX_MODEL_CATALOG_JSON)) {
  Register-ReferencedFile `
    -Label 'env:CODEX_MODEL_CATALOG_JSON' `
    -RawPath $env:CODEX_MODEL_CATALOG_JSON `
    -BasePaths @($repoRoot, $backendDir)
}

$referencedBackupIndex = 0
foreach ($entry in ($referencedFileMap.Values | Sort-Object originalPath)) {
  if (-not $entry.exists) {
    $manifest.referencedFiles += $entry
    continue
  }

  $referencedBackupIndex += 1
  $targetDir = Join-Path $referencedFilesDir ('{0:D2}-{1}' -f $referencedBackupIndex, (Get-SafePathSegment -Value (Split-Path -Leaf $entry.originalPath)))
  Ensure-Directory -Path $targetDir
  $targetPath = Join-Path $targetDir (Split-Path -Leaf $entry.originalPath)
  Copy-FileToBackup -SourcePath $entry.originalPath -DestinationPath $targetPath
  $entry.backupPath = $targetPath
  $manifest.referencedFiles += $entry
}

$envSnapshotPath = Join-Path $environmentDir 'set-codex-env.ps1'
$envSnapshotVariables = Get-ChildItem Env: | Where-Object { $_.Name -like 'CODEX_*' } | Sort-Object Name
$envSnapshotLines = @(
  '# PowerShell environment snapshot generated by backup-codex-server-config.ps1',
  '# Dot-source this file before starting codex-server if you want to restore the same CODEX_* variables.'
)
foreach ($envVar in $envSnapshotVariables) {
  $escapedValue = $envVar.Value.Replace("'", "''")
  $envSnapshotLines += ('$env:{0} = ''{1}''' -f $envVar.Name, $escapedValue)
}
Set-Content -LiteralPath $envSnapshotPath -Value $envSnapshotLines
$manifest.environmentSnapshotPath = $envSnapshotPath

$restoreNotesPath = Join-Path $backupRoot 'RESTORE-NOTES.txt'
$preferredStoreText = if ($manifest.preferredStorePath) {
  $manifest.preferredStorePath
} else {
  'No store metadata file was found in the common locations.'
}
$restoreNotes = @(
  'codex-server configuration backup',
  '',
  ('Generated at UTC: {0}' -f $manifest.generatedAtUtc),
  ('Preferred store file: {0}' -f $preferredStoreText),
  '',
  'Restore checklist:',
  '1. Stop codex-server.',
  '2. Run scripts\restore-codex-server-config.ps1 -BackupPath <this-backup-dir> -Force to restore into the current codex-server checkout.',
  '3. Use -RestoreAllStores if you need every backed-up store file, or -StoreLabel to select one explicitly.',
  '4. Use -WorkspaceId <id> or -SkipWorkspaces if you do not want to touch every backed-up workspace path.',
  '5. Re-apply environment/set-codex-env.ps1 before starting codex-server if you want the same CODEX_* variables.',
  '',
  'This backup does not include browser localStorage state.'
)
Set-Content -LiteralPath $restoreNotesPath -Value $restoreNotes

$manifestPath = Join-Path $backupRoot 'manifest.json'
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath

$existingStores = @($manifest.stores | Where-Object { $_.exists })
$workspaceCount = @($manifest.workspaces).Count
$referencedFileCount = @($manifest.referencedFiles | Where-Object { $_.exists }).Count

Write-Host "Backup created at: $backupRoot"
Write-Host "Manifest: $manifestPath"
Write-Host "Preferred store file: $preferredStoreText"
Write-Host ('Backed up {0} store file(s), {1} workspace(s), and {2} referenced file(s).' -f $existingStores.Count, $workspaceCount, $referencedFileCount)
