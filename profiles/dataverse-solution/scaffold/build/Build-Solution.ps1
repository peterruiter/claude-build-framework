<#
.SYNOPSIS
    Packs every solution in source control into a zip, offline, and proves the source is
    complete: packing and unpacking again gives back the same files.

.DESCRIPTION
    Never connects to an environment. For each solution in build/contracts/schema.json
    (solutions[], in importOrder):

    1. Copies the unpacked source (solutions/<name>/src) to out/staging/<name>.
    2. Stamps the version in the copy: major.minor.patch from VERSION, build number from
       -BuildNumber (CI passes its run number). The committed source keeps its version.
    3. pac solution pack into out/<name>.zip (unmanaged by default: the managed release is made
       by the build environment, see README "Release flow").
    4. With -RoundTrip: unpacks the zip again into out/roundtrip/<name> and compares it with the
       source, ignoring byte order marks, line endings and the stamped version. A difference
       means a file in source control is not what pac produces (hand-edited XML, a missing file
       for a root component): fix the source, do not ship it.

    Writes out/build.json with what was packed, for the release workflow.

.PARAMETER Solution
    Unique names to pack. Default: every solution in schema.json.

.PARAMETER BuildNumber
    The fourth part of the version. Default 0.

.PARAMETER PackageType
    Unmanaged (default) or Managed. Managed needs a source unpacked with --packagetype Both.

.PARAMETER RoundTrip
    Also unpack and compare (the quality gate does this).

.EXAMPLE
    ./build/Build-Solution.ps1 -RoundTrip

.EXAMPLE
    ./build/Build-Solution.ps1 -BuildNumber 412
#>
[CmdletBinding()]
param(
    [string[]]$Solution,
    [int]$BuildNumber = 0,
    [ValidateSet('Unmanaged', 'Managed')][string]$PackageType = 'Unmanaged',
    [switch]$RoundTrip
)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Get-RepoRoot
$schema = Get-Contract 'schema'
$version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "VERSION must be major.minor.patch, found '$version'." }
$fullVersion = "$version.$BuildNumber"
$out = Join-Path $root 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Get-NormalizedText {
    param([string]$Path)
    $text = [System.IO.File]::ReadAllText($Path)
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    return ($text -replace "`r`n", "`n").TrimEnd()
}

$solutions = @($schema.solutions | Sort-Object importOrder)
if ($Solution) { $solutions = @($solutions | Where-Object { $Solution -contains $_.uniqueName }) }
if ($solutions.Count -eq 0) { throw 'No solutions to pack.' }

$built = @()
$problems = 0
foreach ($s in $solutions) {
    Write-Step "$($s.uniqueName) $fullVersion ($PackageType)"
    $source = Join-Path $root $s.folder
    if (-not (Test-Path (Join-Path $source 'Other/Solution.xml'))) { throw "$source has no Other/Solution.xml. Export and unpack the solution first (Export-Solution.ps1)." }

    # Staging and the round trip live in a short temporary folder: pac's Windows (.NET Framework)
    # build fails on paths over 260 characters, and solution folders nest deep.
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ("dvs-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $staging = Join-Path $work 's'
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $staging -Recurse -Force

    $manifestPath = Join-Path $staging 'Other/Solution.xml'
    $manifestText = [System.IO.File]::ReadAllText($manifestPath)
    $stamped = [regex]::Replace($manifestText, '<Version>[^<]*</Version>', "<Version>$fullVersion</Version>", 1)
    [System.IO.File]::WriteAllText($manifestPath, $stamped, [System.Text.UTF8Encoding]::new($false))

    $zip = Join-Path $out "$($s.uniqueName).zip"
    if (Test-Path $zip) { Remove-Item -Force $zip }
    [void](Invoke-Pac -Arguments @('solution', 'pack', '--zipfile', $zip, '--folder', $staging, '--packagetype', $PackageType))
    $manifest = Get-SolutionManifest -ZipPath $zip
    if ($manifest.UniqueName -ne $s.uniqueName -or $manifest.Version -ne $fullVersion) {
        throw "Packed $zip says $($manifest.UniqueName) $($manifest.Version); expected $($s.uniqueName) $fullVersion."
    }
    Write-Ok "packed $zip"

    if ($RoundTrip) {
        $again = Join-Path $work 'r'
        [void](Invoke-Pac -Arguments @('solution', 'unpack', '--zipfile', $zip, '--folder', $again, '--packagetype', $PackageType))
        $left = @(Get-ChildItem -Path $source -Recurse -File | ForEach-Object { [System.IO.Path]::GetRelativePath($source, $_.FullName).Replace('\', '/') })
        $right = @(Get-ChildItem -Path $again -Recurse -File | ForEach-Object { [System.IO.Path]::GetRelativePath($again, $_.FullName).Replace('\', '/') })
        foreach ($file in ($left | Where-Object { $right -notcontains $_ })) { Write-Fail "only in source: $file"; $problems++ }
        foreach ($file in ($right | Where-Object { $left -notcontains $_ })) { Write-Fail "pac adds a file the source lacks: $file"; $problems++ }
        foreach ($file in ($left | Where-Object { $right -contains $_ })) {
            $a = Get-NormalizedText (Join-Path $source $file)
            $b = Get-NormalizedText (Join-Path $again $file)
            if ($file -eq 'Other/Solution.xml') { $b = [regex]::Replace($b, '<Version>[^<]*</Version>', ([regex]::Match($a, '<Version>[^<]*</Version>').Value), 1) }
            if ($a -ne $b) { Write-Fail "differs after pack and unpack: $file"; $problems++ }
        }
        if ($problems -eq 0) { Write-Ok "round trip: $($left.Count) files identical" }
    }
    # $work is a folder this run created under the temp path, never anything else.
    if ($work.StartsWith([System.IO.Path]::GetTempPath()) -and (Split-Path -Leaf $work) -like 'dvs-*') { Remove-Item -LiteralPath $work -Recurse -Force }
    $built += [pscustomobject]@{ uniqueName = $s.uniqueName; version = $fullVersion; packageType = $PackageType; zip = "out/$($s.uniqueName).zip"; importOrder = $s.importOrder }
}

[ordered]@{ version = $fullVersion; builtAt = (Get-Date).ToUniversalTime().ToString('o'); solutions = $built } |
    ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $out 'build.json') -Encoding utf8NoBOM
if ($problems -gt 0) { throw "$problems round-trip difference(s). The source in git is not what pac produces." }
Write-Host ''
Write-Host "Done. Next: ./build/Test-Translations.ps1, then in CI pac solution check on out/*.zip." -ForegroundColor Cyan
