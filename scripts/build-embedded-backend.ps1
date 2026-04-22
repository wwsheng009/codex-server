[CmdletBinding()]
param(
  [ValidateSet('auto', 'npm', 'pnpm')]
  [string]$PackageManager = 'auto',
  [string]$GoBuildTags = 'embed_frontend',
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NormalizedPath {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-PathWithinRoot {
  param(
    [Parameter(Mandatory)]
    [string]$Path,
    [Parameter(Mandatory)]
    [string]$Root,
    [Parameter(Mandatory)]
    [string]$Label
  )

  $normalizedPath = Get-NormalizedPath -Path $Path
  $normalizedRoot = Get-NormalizedPath -Path $Root
  $rootWithSeparator = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar

  if (
    -not $normalizedPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $normalizedPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    throw "$Label path '$normalizedPath' is outside repository root '$normalizedRoot'."
  }

  return $normalizedPath
}

function Resolve-RequiredCommand {
  param(
    [Parameter(Mandatory)]
    [string]$Name
  )

  $candidateNames = if ($env:OS -eq 'Windows_NT' -and [string]::IsNullOrWhiteSpace([System.IO.Path]::GetExtension($Name))) {
    @("$Name.cmd", "$Name.exe", $Name, "$Name.ps1")
  } else {
    @($Name)
  }

  foreach ($candidateName in $candidateNames) {
    $command = Get-Command -Name $candidateName -ErrorAction SilentlyContinue
    if ($null -eq $command) {
      continue
    }

    if (-not [string]::IsNullOrWhiteSpace($command.Source)) {
      return $command.Source
    }

    return $command.Name
  }

  throw "Required command '$Name' was not found in PATH."
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory)]
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory)]
    [string]$FailureMessage
  )

  $displayCommand = @($FilePath) + $ArgumentList
  Write-Host ('> ' + ($displayCommand -join ' '))

  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage (exit code $exitCode)."
  }
}

$repoRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..')
$frontendDir = Join-Path $repoRoot 'frontend'
$frontendDistDir = Join-Path $frontendDir 'dist'
$backendDir = Join-Path $repoRoot 'backend'
$backendWebUiDir = Join-Path $backendDir 'internal\webui'
$embeddedDistDir = Join-Path $backendWebUiDir 'dist'
$outputDir = Join-Path $backendDir 'bin'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $binaryName = if ($env:OS -eq 'Windows_NT') {
    'codex-server-embedded.exe'
  } else {
    'codex-server-embedded'
  }

  $OutputPath = Join-Path $outputDir $binaryName
}

$frontendDir = Assert-PathWithinRoot -Path $frontendDir -Root $repoRoot -Label 'Frontend directory'
$frontendDistDir = Assert-PathWithinRoot -Path $frontendDistDir -Root $repoRoot -Label 'Frontend dist directory'
$backendDir = Assert-PathWithinRoot -Path $backendDir -Root $repoRoot -Label 'Backend directory'
$backendWebUiDir = Assert-PathWithinRoot -Path $backendWebUiDir -Root $repoRoot -Label 'Embedded frontend directory'
$embeddedDistDir = Assert-PathWithinRoot -Path $embeddedDistDir -Root $repoRoot -Label 'Embedded dist directory'
$outputPathFull = Assert-PathWithinRoot -Path $OutputPath -Root $repoRoot -Label 'Output binary'

if (-not (Test-Path -LiteralPath $frontendDir -PathType Container)) {
  throw "Frontend directory not found: $frontendDir"
}

if (-not (Test-Path -LiteralPath $backendDir -PathType Container)) {
  throw "Backend directory not found: $backendDir"
}

$resolvedPackageManager = switch ($PackageManager) {
  'auto' {
    if (Test-Path -LiteralPath (Join-Path $frontendDir 'package-lock.json')) {
      'npm'
    } elseif (Test-Path -LiteralPath (Join-Path $frontendDir 'pnpm-lock.yaml')) {
      'pnpm'
    } else {
      'npm'
    }
  }
  default {
    $PackageManager
  }
}

$packageManagerCommand = Resolve-RequiredCommand -Name $resolvedPackageManager
$goCommand = Resolve-RequiredCommand -Name 'go'

Write-Host "Repository root: $repoRoot"
Write-Host "Frontend builder: $resolvedPackageManager"
Write-Host "Embedded dist target: $embeddedDistDir"
Write-Host "Binary output: $outputPathFull"

Invoke-NativeCommand `
  -FilePath $packageManagerCommand `
  -ArgumentList @('run', 'build') `
  -WorkingDirectory $frontendDir `
  -FailureMessage 'Frontend build failed'

if (-not (Test-Path -LiteralPath $frontendDistDir -PathType Container)) {
  throw "Frontend build completed without producing dist output: $frontendDistDir"
}

$frontendDistEntries = Get-ChildItem -LiteralPath $frontendDistDir -Force
if ($frontendDistEntries.Count -eq 0) {
  throw "Frontend dist directory is empty: $frontendDistDir"
}

if (-not (Test-Path -LiteralPath $backendWebUiDir -PathType Container)) {
  New-Item -ItemType Directory -Path $backendWebUiDir -Force | Out-Null
}

if (Test-Path -LiteralPath $embeddedDistDir) {
  Remove-Item -LiteralPath $embeddedDistDir -Recurse -Force
}

New-Item -ItemType Directory -Path $embeddedDistDir -Force | Out-Null

foreach ($entry in $frontendDistEntries) {
  Copy-Item -LiteralPath $entry.FullName -Destination $embeddedDistDir -Recurse -Force
}

$copiedIndexPath = Join-Path $embeddedDistDir 'index.html'
if (-not (Test-Path -LiteralPath $copiedIndexPath -PathType Leaf)) {
  throw "Embedded frontend copy failed; missing index.html at $copiedIndexPath"
}

$outputParent = Split-Path -Path $outputPathFull -Parent
if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
  New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
}

Invoke-NativeCommand `
  -FilePath $goCommand `
  -ArgumentList @('build', '-tags', $GoBuildTags, '-o', $outputPathFull, './cmd/server') `
  -WorkingDirectory $backendDir `
  -FailureMessage 'Go build failed'

if (-not (Test-Path -LiteralPath $outputPathFull -PathType Leaf)) {
  throw "Go build reported success but binary was not created: $outputPathFull"
}

Write-Host "Embedded frontend build completed successfully."
Write-Host "Built binary: $outputPathFull"
