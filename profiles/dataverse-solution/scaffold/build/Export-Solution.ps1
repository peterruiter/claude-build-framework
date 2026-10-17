<#
.SYNOPSIS
    Exports solutions from the development environment and unpacks them into solutions/, so the
    change made in Dataverse becomes a reviewable diff in git.

.DESCRIPTION
    Only from an environment of kind development (environments.json). Reads from it; changes
    nothing there unless -SetVersion is given.

    1. Shows the environment, its URL and the pac account, and asks (Confirm-Environment).
    2. With -SetVersion: sets the solution's version in development to VERSION + .0
       (pac solution online-version), so the export carries the bumped version. That is a write:
       the host name has to be typed back.
    3. pac solution export (unmanaged) into out/export/<name>.zip.
    4. pac solution unpack into solutions/<name>/src with --allowDelete and --allowWrite, so a
       component removed in development disappears from git too.
    5. Normalises line endings and byte order marks (git stores LF).

    Then: git diff, Build-Solution.ps1 -RoundTrip, the contract tests, commit.

.PARAMETER Environment
    Id in environments.json. Default: dev.

.PARAMETER Solution
    Unique names. Default: every solution in build/contracts/schema.json.

.PARAMETER SetVersion
    Set the version in development to VERSION.0 before exporting.

.PARAMETER ConfirmUrl
    Non-interactive confirmation: the exact environment URL.

.EXAMPLE
    ./build/Export-Solution.ps1

.EXAMPLE
    ./build/Export-Solution.ps1 -Environment dev-alex -Solution CaseAppCore
#>
[CmdletBinding()]
param(
    [string]$Environment = 'dev',
    [string[]]$Solution,
    [switch]$SetVersion,
    [string]$ConfirmUrl
)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Get-RepoRoot
$schema = Get-Contract 'schema'
$target = Get-EnvironmentConfig -Id $Environment
if ($target.kind -ne 'development') { throw "Exports into source control come from development only; '$Environment' is $($target.kind)." }

$solutions = @($schema.solutions | Sort-Object importOrder)
if ($Solution) { $solutions = @($solutions | Where-Object { $Solution -contains $_.uniqueName }) }
if ($solutions.Count -eq 0) { throw 'No solutions to export.' }

$account = Get-PacAccount
$names = ($solutions | ForEach-Object uniqueName) -join ', '
Confirm-Environment -Environment $target -Account $account -Action "export $names from" -Write:$SetVersion -ConfirmUrl $ConfirmUrl
Assert-PacReaches -Environment $target

$version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
$exportDir = Join-Path $root 'out/export'
New-Item -ItemType Directory -Force -Path $exportDir | Out-Null

foreach ($s in $solutions) {
    Write-Step $s.uniqueName
    if ($SetVersion) {
        [void](Invoke-Pac -Arguments @('solution', 'online-version', '--solution-name', $s.uniqueName, '--solution-version', "$version.0") -Environment $target)
        Write-Ok "version in $($target.name) set to $version.0"
    }
    $zip = Join-Path $exportDir "$($s.uniqueName).zip"
    [void](Invoke-Pac -Arguments @('solution', 'export', '--name', $s.uniqueName, '--path', $zip, '--overwrite') -Environment $target)
    $manifest = Get-SolutionManifest -ZipPath $zip
    if ($manifest.Managed) { throw "$($s.uniqueName) came out managed; development must hold it unmanaged." }
    Write-Ok "exported $($manifest.UniqueName) $($manifest.Version)"

    $folder = Join-Path $root $s.folder
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    [void](Invoke-Pac -Arguments @('solution', 'unpack', '--zipfile', $zip, '--folder', $folder, '--packagetype', 'Unmanaged', '--allowDelete', 'true', '--allowWrite', 'true', '--clobber', 'true'))

    $count = 0
    foreach ($file in Get-ChildItem -Path $folder -Recurse -File -Include *.xml, *.json, *.resx, *.js, *.html, *.css, *.yml) {
        $text = [System.IO.File]::ReadAllText($file.FullName)
        if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
        $text = ($text -replace "`r`n", "`n").TrimEnd() + "`n"
        [System.IO.File]::WriteAllText($file.FullName, $text, [System.Text.UTF8Encoding]::new($false))
        $count++
    }
    Write-Ok "unpacked into $($s.folder) ($count files)"
    if (-not $manifest.Version.StartsWith("$version.")) { Write-Warn "the solution says $($manifest.Version) and VERSION says $version; the contract test will fail until they agree (use -SetVersion)." }
}

Write-Host ''
Write-Host 'Next: git diff; ./build/Build-Solution.ps1 -RoundTrip; npm test; commit.' -ForegroundColor Cyan
