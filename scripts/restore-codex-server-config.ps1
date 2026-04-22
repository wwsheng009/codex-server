[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory)]
  [string]$BackupPath,
  [string]$StoreLabel,
  [string]$StorePath,
  [string]$TargetRepoRoot,
  [string]$TargetCodexHome,
  [string[]]$WorkspaceId,
  [switch]$RestoreAllStores,
  [switch]$SkipStores,
  [switch]$SkipWorkspaces,
  [switch]$SkipCodexHome,
  [switch]$SkipReferencedFiles,
  [switch]$ApplyEnvironment,
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
      '-BackupPath'
      $BackupPath
    )

    if ($PSBoundParameters.ContainsKey('StoreLabel')) {
      $forwardedArgs += @('-StoreLabel', $StoreLabel)
    }
    if ($PSBoundParameters.ContainsKey('StorePath')) {
      $forwardedArgs += @('-StorePath', $StorePath)
    }
    if ($PSBoundParameters.ContainsKey('TargetRepoRoot')) {
      $forwardedArgs += @('-TargetRepoRoot', $TargetRepoRoot)
    }
    if ($PSBoundParameters.ContainsKey('TargetCodexHome')) {
      $forwardedArgs += @('-TargetCodexHome', $TargetCodexHome)
    }
    if ($PSBoundParameters.ContainsKey('WorkspaceId')) {
      foreach ($item in $WorkspaceId) {
        $forwardedArgs += @('-WorkspaceId', $item)
      }
    }

    foreach ($switchName in @(
      'RestoreAllStores',
      'SkipStores',
      'SkipWorkspaces',
      'SkipCodexHome',
      'SkipReferencedFiles',
      'ApplyEnvironment',
      'Force'
    )) {
      if ($PSBoundParameters.ContainsKey($switchName) -and $PSBoundParameters[$switchName]) {
        $forwardedArgs += ('-' + $switchName)
      }
    }

    foreach ($commonSwitch in @('WhatIf', 'Confirm')) {
      if ($PSBoundParameters.ContainsKey($commonSwitch)) {
        $forwardedArgs += ('-{0}:{1}' -f $commonSwitch, [bool]$PSBoundParameters[$commonSwitch])
      }
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

function Ensure-Directory {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
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

function Test-PathUnderBase {
  param(
    [Parameter(Mandatory)]
    [string]$Path,
    [Parameter(Mandatory)]
    [string]$BasePath
  )

  $normalizedPath = Get-NormalizedPath -Path $Path
  $normalizedBase = Get-NormalizedPath -Path $BasePath

  if ($normalizedPath.Length -lt $normalizedBase.Length) {
    return $false
  }

  if (-not $normalizedPath.StartsWith($normalizedBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }

  if ($normalizedPath.Length -eq $normalizedBase.Length) {
    return $true
  }

  $separator = $normalizedPath[$normalizedBase.Length]
  return $separator -eq '\' -or $separator -eq '/'
}

function Map-PathToTarget {
  param(
    [Parameter(Mandatory)]
    [string]$OriginalPath,
    [string]$RecordedRepoRoot,
    [string]$CurrentRepoRoot,
    [string]$RecordedCodexHome,
    [string]$CurrentCodexHome
  )

  $normalizedOriginal = Get-NormalizedPath -Path $OriginalPath

  if (
    -not [string]::IsNullOrWhiteSpace($RecordedRepoRoot) -and
    -not [string]::IsNullOrWhiteSpace($CurrentRepoRoot) -and
    (Test-PathUnderBase -Path $normalizedOriginal -BasePath $RecordedRepoRoot)
  ) {
    $relativePath = [System.IO.Path]::GetRelativePath($RecordedRepoRoot, $normalizedOriginal)
    return Get-NormalizedPath -Path (Join-Path $CurrentRepoRoot $relativePath)
  }

  if (
    -not [string]::IsNullOrWhiteSpace($RecordedCodexHome) -and
    -not [string]::IsNullOrWhiteSpace($CurrentCodexHome) -and
    (Test-PathUnderBase -Path $normalizedOriginal -BasePath $RecordedCodexHome)
  ) {
    $relativePath = [System.IO.Path]::GetRelativePath($RecordedCodexHome, $normalizedOriginal)
    return Get-NormalizedPath -Path (Join-Path $CurrentCodexHome $relativePath)
  }

  return $normalizedOriginal
}

function Resolve-BackupItemPath {
  param(
    [string]$StoredPath,
    [Parameter(Mandatory)]
    [string]$CurrentBackupRoot,
    [string]$RecordedBackupRoot
  )

  if ([string]::IsNullOrWhiteSpace($StoredPath)) {
    return $null
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  $seen = @{}

  if ([System.IO.Path]::IsPathRooted($StoredPath)) {
    $normalizedStored = Get-NormalizedPath -Path $StoredPath
    if (-not $seen.ContainsKey($normalizedStored)) {
      $seen[$normalizedStored] = $true
      $candidates.Add($normalizedStored)
    }

    if (
      -not [string]::IsNullOrWhiteSpace($RecordedBackupRoot) -and
      (Test-PathUnderBase -Path $normalizedStored -BasePath $RecordedBackupRoot)
    ) {
      $relativePath = [System.IO.Path]::GetRelativePath($RecordedBackupRoot, $normalizedStored)
      $mappedPath = Get-NormalizedPath -Path (Join-Path $CurrentBackupRoot $relativePath)
      if (-not $seen.ContainsKey($mappedPath)) {
        $seen[$mappedPath] = $true
        $candidates.Insert(0, $mappedPath)
      }
    }
  } else {
    $relativeCandidate = Get-NormalizedPath -Path (Join-Path $CurrentBackupRoot $StoredPath)
    if (-not $seen.ContainsKey($relativeCandidate)) {
      $seen[$relativeCandidate] = $true
      $candidates.Add($relativeCandidate)
    }
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  if ($candidates.Count -gt 0) {
    return $candidates[0]
  }

  return $null
}

function Restore-FileFromBackup {
  param(
    [Parameter(Mandatory)]
    [string]$SourcePath,
    [Parameter(Mandatory)]
    [string]$DestinationPath,
    [switch]$Force
  )

  $resolvedSource = Get-NormalizedPath -Path $SourcePath
  $resolvedDestination = Get-NormalizedPath -Path $DestinationPath

  if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf)) {
    throw "Backup file not found: $resolvedSource"
  }

  if ((Test-Path -LiteralPath $resolvedDestination) -and -not $Force) {
    throw "Target file already exists. Re-run with -Force to overwrite: $resolvedDestination"
  }

  Ensure-Directory -Path (Split-Path -Parent $resolvedDestination)
  if ($script:PSCmdlet.ShouldProcess($resolvedDestination, "Restore file from $resolvedSource")) {
    Copy-Item -LiteralPath $resolvedSource -Destination $resolvedDestination -Force
    return $true
  }

  return $false
}

function Restore-DirectoryFromBackup {
  param(
    [Parameter(Mandatory)]
    [string]$SourcePath,
    [Parameter(Mandatory)]
    [string]$DestinationPath,
    [switch]$Force
  )

  $resolvedSource = Get-NormalizedPath -Path $SourcePath
  $resolvedDestination = Get-NormalizedPath -Path $DestinationPath

  if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
    throw "Backup directory not found: $resolvedSource"
  }

  if ((Test-Path -LiteralPath $resolvedDestination) -and -not $Force) {
    throw "Target directory already exists. Re-run with -Force to overwrite: $resolvedDestination"
  }

  Ensure-Directory -Path (Split-Path -Parent $resolvedDestination)
  if ($script:PSCmdlet.ShouldProcess($resolvedDestination, "Restore directory from $resolvedSource")) {
    if (Test-Path -LiteralPath $resolvedDestination) {
      Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
    }
    Copy-Item -LiteralPath $resolvedSource -Destination $resolvedDestination -Recurse -Force
    return $true
  }

  return $false
}

$currentBackupRoot = Get-NormalizedPath -Path $BackupPath
$manifestPath = Join-Path $currentBackupRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Backup manifest not found: $manifestPath"
}

$manifest = Read-JsonFileAsHashtable -Path $manifestPath
$recordedBackupRoot = if ($manifest.ContainsKey('backupRoot') -and $manifest.backupRoot) { Get-NormalizedPath -Path ([string]$manifest.backupRoot) } else { $currentBackupRoot }
$recordedRepoRoot = if ($manifest.ContainsKey('repoRoot') -and $manifest.repoRoot) { Get-NormalizedPath -Path ([string]$manifest.repoRoot) } else { '' }
$effectiveRepoRoot = if ($PSBoundParameters.ContainsKey('TargetRepoRoot')) { Get-NormalizedPath -Path $TargetRepoRoot } else { Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..') }
$recordedCodexHome = if ($manifest.ContainsKey('codexHome') -and $manifest.codexHome) { Get-NormalizedPath -Path ([string]$manifest.codexHome) } else { '' }
$effectiveCodexHome = if ($PSBoundParameters.ContainsKey('TargetCodexHome')) { Get-NormalizedPath -Path $TargetCodexHome } else { Get-CodexHomePath }

if ($RestoreAllStores -and $PSBoundParameters.ContainsKey('StorePath')) {
  throw '-StorePath cannot be combined with -RestoreAllStores.'
}

$summary = [ordered]@{
  storesRestored          = 0
  workspaceFilesRestored  = 0
  codexHomeFilesRestored  = 0
  referencedFilesRestored = 0
  environmentApplied      = $false
}

if (-not $SkipStores) {
  $existingStores = @($manifest.stores | Where-Object { $_.exists -and $_.backupPath })
  if ($existingStores.Count -eq 0) {
    Write-Warning 'No backed-up store files were found in the manifest.'
  } else {
    $selectedStores = @()
    if ($RestoreAllStores) {
      $selectedStores = $existingStores
    } elseif ($PSBoundParameters.ContainsKey('StoreLabel')) {
      $selectedStores = @($existingStores | Where-Object { $_.label -eq $StoreLabel })
      if ($selectedStores.Count -eq 0) {
        throw "No backed-up store matched label: $StoreLabel"
      }
    } else {
      $selectedStores = @($existingStores | Where-Object { $_.preferred })
      if ($selectedStores.Count -eq 0) {
        $selectedStores = @($existingStores | Select-Object -First 1)
      }
    }

    foreach ($store in $selectedStores) {
      $sourceMetadataPath = Resolve-BackupItemPath `
        -StoredPath ([string]$store.backupPath) `
        -CurrentBackupRoot $currentBackupRoot `
        -RecordedBackupRoot $recordedBackupRoot
      if (-not $sourceMetadataPath) {
        throw "Backed-up store file could not be located for label: $($store.label)"
      }

      $targetMetadataPath = if ($PSBoundParameters.ContainsKey('StorePath')) {
        Get-NormalizedPath -Path $StorePath
      } else {
        Map-PathToTarget `
          -OriginalPath ([string]$store.originalPath) `
          -RecordedRepoRoot $recordedRepoRoot `
          -CurrentRepoRoot $effectiveRepoRoot `
          -RecordedCodexHome $recordedCodexHome `
          -CurrentCodexHome $effectiveCodexHome
      }

      if (Restore-FileFromBackup -SourcePath $sourceMetadataPath -DestinationPath $targetMetadataPath -Force:$Force) {
        $summary.storesRestored += 1
      }

      if ($store.sidecarBackupPath) {
        $sourceSidecarPath = Resolve-BackupItemPath `
          -StoredPath ([string]$store.sidecarBackupPath) `
          -CurrentBackupRoot $currentBackupRoot `
          -RecordedBackupRoot $recordedBackupRoot
        if (-not $sourceSidecarPath) {
          throw "Backed-up sidecar directory could not be located for store: $($store.label)"
        }

        $targetSidecarPath = if ($PSBoundParameters.ContainsKey('StorePath')) {
          Get-NormalizedPath -Path (Join-Path (Split-Path -Parent $targetMetadataPath) 'thread-projections')
        } elseif ($store.sidecarDirectoryPath) {
          Map-PathToTarget `
            -OriginalPath ([string]$store.sidecarDirectoryPath) `
            -RecordedRepoRoot $recordedRepoRoot `
            -CurrentRepoRoot $effectiveRepoRoot `
            -RecordedCodexHome $recordedCodexHome `
            -CurrentCodexHome $effectiveCodexHome
        } else {
          Get-NormalizedPath -Path (Join-Path (Split-Path -Parent $targetMetadataPath) 'thread-projections')
        }

        Restore-DirectoryFromBackup -SourcePath $sourceSidecarPath -DestinationPath $targetSidecarPath -Force:$Force | Out-Null
      }
    }
  }
}

if (-not $SkipWorkspaces) {
  $requestedWorkspaceIds = @($WorkspaceId | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  foreach ($workspace in @($manifest.workspaces)) {
    $workspaceIdentifier = if ($workspace.workspaceId) { [string]$workspace.workspaceId } else { '' }
    if ($requestedWorkspaceIds.Count -gt 0 -and ($requestedWorkspaceIds -notcontains $workspaceIdentifier)) {
      continue
    }

    foreach ($configFile in @($workspace.configFiles)) {
      if (-not $configFile.exists -or -not $configFile.backupPath -or -not $configFile.originalPath) {
        continue
      }

      $sourceConfigPath = Resolve-BackupItemPath `
        -StoredPath ([string]$configFile.backupPath) `
        -CurrentBackupRoot $currentBackupRoot `
        -RecordedBackupRoot $recordedBackupRoot
      if (-not $sourceConfigPath) {
        throw "Backed-up workspace file could not be located: $($configFile.label)"
      }

      $targetConfigPath = Map-PathToTarget `
        -OriginalPath ([string]$configFile.originalPath) `
        -RecordedRepoRoot $recordedRepoRoot `
        -CurrentRepoRoot $effectiveRepoRoot `
        -RecordedCodexHome $recordedCodexHome `
        -CurrentCodexHome $effectiveCodexHome

      if (Restore-FileFromBackup -SourcePath $sourceConfigPath -DestinationPath $targetConfigPath -Force:$Force) {
        $summary.workspaceFilesRestored += 1
      }
    }
  }
}

if (-not $SkipCodexHome) {
  foreach ($codexHomeFile in @($manifest.codexHomeFiles)) {
    if (-not $codexHomeFile.exists -or -not $codexHomeFile.backupPath -or -not $codexHomeFile.originalPath) {
      continue
    }

    $sourceCodexHomePath = Resolve-BackupItemPath `
      -StoredPath ([string]$codexHomeFile.backupPath) `
      -CurrentBackupRoot $currentBackupRoot `
      -RecordedBackupRoot $recordedBackupRoot
    if (-not $sourceCodexHomePath) {
      throw "Backed-up CODEX_HOME file could not be located: $($codexHomeFile.originalPath)"
    }

    $targetCodexHomePath = Map-PathToTarget `
      -OriginalPath ([string]$codexHomeFile.originalPath) `
      -RecordedRepoRoot $recordedRepoRoot `
      -CurrentRepoRoot $effectiveRepoRoot `
      -RecordedCodexHome $recordedCodexHome `
      -CurrentCodexHome $effectiveCodexHome

    if (Restore-FileFromBackup -SourcePath $sourceCodexHomePath -DestinationPath $targetCodexHomePath -Force:$Force) {
      $summary.codexHomeFilesRestored += 1
    }
  }
}

if (-not $SkipReferencedFiles) {
  foreach ($entry in @($manifest.referencedFiles)) {
    if (-not $entry.exists -or -not $entry.backupPath -or -not $entry.originalPath) {
      continue
    }

    $sourceReferencedPath = Resolve-BackupItemPath `
      -StoredPath ([string]$entry.backupPath) `
      -CurrentBackupRoot $currentBackupRoot `
      -RecordedBackupRoot $recordedBackupRoot
    if (-not $sourceReferencedPath) {
      throw "Backed-up referenced file could not be located: $($entry.rawPath)"
    }

    $targetReferencedPath = Map-PathToTarget `
      -OriginalPath ([string]$entry.originalPath) `
      -RecordedRepoRoot $recordedRepoRoot `
      -CurrentRepoRoot $effectiveRepoRoot `
      -RecordedCodexHome $recordedCodexHome `
      -CurrentCodexHome $effectiveCodexHome

    if (Restore-FileFromBackup -SourcePath $sourceReferencedPath -DestinationPath $targetReferencedPath -Force:$Force) {
      $summary.referencedFilesRestored += 1
    }
  }
}

$environmentSnapshotPath = if ($manifest.environmentSnapshotPath) {
  Resolve-BackupItemPath `
    -StoredPath ([string]$manifest.environmentSnapshotPath) `
    -CurrentBackupRoot $currentBackupRoot `
    -RecordedBackupRoot $recordedBackupRoot
} else {
  $null
}

if ($ApplyEnvironment) {
  if (-not $environmentSnapshotPath) {
    throw 'Environment snapshot file could not be located in the backup.'
  }

  if ($script:PSCmdlet.ShouldProcess('Current PowerShell process', "Apply environment snapshot from $environmentSnapshotPath")) {
    . $environmentSnapshotPath
    $summary.environmentApplied = $true
  }
}

Write-Host "Backup restored from: $currentBackupRoot"
Write-Host "Repo-local targets restored under: $effectiveRepoRoot"
Write-Host "CODEX_HOME targets restored under: $effectiveCodexHome"
Write-Host ('Restored {0} store file(s), {1} workspace file(s), {2} CODEX_HOME file(s), and {3} referenced file(s).' -f `
  $summary.storesRestored,
  $summary.workspaceFilesRestored,
  $summary.codexHomeFilesRestored,
  $summary.referencedFilesRestored
)

if ($environmentSnapshotPath) {
  if ($summary.environmentApplied) {
    Write-Host "Applied CODEX_* environment variables from: $environmentSnapshotPath"
    Write-Host 'If you launched this script via a separate pwsh process, re-apply the same file in the shell that starts codex-server.'
  } else {
    Write-Host "Environment snapshot available at: $environmentSnapshotPath"
  }
}
