[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$SourceDir,
    [Parameter(Mandatory)] [string]$Version,
    [string]$Ref,
    [string]$BuildDir,
    [switch]$SkipInstaller,
    [switch]$AlreadyApplied
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $SourceDir).Path
$versionNumber = $Version.TrimStart('v')
if ($versionNumber -notmatch '^\d+\.\d+\.\d+([+-][A-Za-z0-9.-]+)?$') {
    throw "Specify the upstream release version, for example 0.14.1. Received $Version"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'Enable pnpm for the upstream build, for example with corepack enable pnpm.'
}

if ($AlreadyApplied) {
    if ($Ref -or $BuildDir) { throw '-AlreadyApplied uses -SourceDir directly. Omit -Ref and -BuildDir.' }
    $buildRoot = $sourceRoot
} else {
    if (-not $Ref) { $Ref = "v$versionNumber" }
    $revision = & git -C $sourceRoot rev-parse --verify "$Ref^{commit}"
    if ($LASTEXITCODE -ne 0) { throw "Fetch or check the upstream ref $Ref in $sourceRoot." }
    if (-not $BuildDir) {
        $builds = Join-Path (Split-Path -Parent $sourceRoot) 'clowder-builds'
        $BuildDir = Join-Path $builds ("ja-$versionNumber-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }
    $buildRoot = [IO.Path]::GetFullPath($BuildDir)
    if (Test-Path -LiteralPath $buildRoot) { throw "Choose a new build directory. It already exists: $buildRoot" }
    & git -C $sourceRoot worktree add --detach -- $buildRoot $revision
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the build worktree.' }

    & node (Join-Path $PSScriptRoot 'localize.cjs') source $buildRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply the Japanese localization.' }

    # The upstream builder binds the Web, API and packages to a committed source revision.
    & git -C $buildRoot add -- packages/web/src
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the generated translations.' }
    & git -C $buildRoot -c 'user.name=Clowder AI Japanese build' -c 'user.email=localizer@localhost' `
        commit -m 'build: apply Japanese localization'
    if ($LASTEXITCODE -ne 0) { throw 'Could not record the localized source revision.' }
}

$upstreamBuild = Join-Path $buildRoot 'desktop\scripts\build-desktop.ps1'
if (-not (Test-Path -LiteralPath $upstreamBuild -PathType Leaf)) {
    throw "The upstream Windows build script is missing from $buildRoot"
}

$previousVersion = $env:CATCAFE_VERSION
$previousDefault = $env:NEXT_PUBLIC_CLOWDER_JAPANESE_DEFAULT
try {
    $env:CATCAFE_VERSION = $versionNumber
    $env:NEXT_PUBLIC_CLOWDER_JAPANESE_DEFAULT = '1'
    $arguments = @('-NoProfile', '-File', $upstreamBuild)
    if ($SkipInstaller) { $arguments += '-SkipInstaller' }
    & pwsh @arguments
    if ($LASTEXITCODE -ne 0) { throw "Upstream Windows build exited with code $LASTEXITCODE." }
    Get-ChildItem -LiteralPath (Join-Path $buildRoot 'dist') -File |
        Where-Object Name -Like "*${versionNumber}*" |
        Select-Object FullName, Length
} finally {
    $env:CATCAFE_VERSION = $previousVersion
    $env:NEXT_PUBLIC_CLOWDER_JAPANESE_DEFAULT = $previousDefault
}
