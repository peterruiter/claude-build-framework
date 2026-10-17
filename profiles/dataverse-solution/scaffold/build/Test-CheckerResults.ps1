<#
.SYNOPSIS
    Reads the Power Apps checker results (SARIF, as written by pac solution check
    --outputDirectory) and fails when a finding is at or above -FailOn. Offline.

.DESCRIPTION
    pac solution check writes a zip per solution with one or more .sarif files. This script
    expands them, counts findings per severity (the result's properties.severity, or its SARIF
    level when that is missing: error = High, warning = Medium, note = Low), lists every finding
    at or above -FailOn with its rule and file, and exits 1 if there is any.

    Rules the project has decided to accept go in build/contracts/checker-exceptions.json
    ({ "exceptions": [ { "rule": "...", "reason": "..." } ] }) with a reason; they are listed and
    not counted. Prefer fixing over excepting.

.PARAMETER Path
    The checker's output directory.

.PARAMETER FailOn
    Critical, High (default), Medium or Low.

.EXAMPLE
    ./build/Test-CheckerResults.ps1 -Path out/checker
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Path,
    [ValidateSet('Critical', 'High', 'Medium', 'Low')][string]$FailOn = 'High'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$rank = @{ Critical = 4; High = 3; Medium = 2; Low = 1; Informational = 0 }
$fromLevel = @{ error = 'High'; warning = 'Medium'; note = 'Low'; none = 'Informational' }

$root = Split-Path -Parent $PSScriptRoot
$exceptions = @{}
$exceptionsFile = Join-Path $root 'build/contracts/checker-exceptions.json'
if (Test-Path $exceptionsFile) { foreach ($e in (Get-Content $exceptionsFile -Raw | ConvertFrom-Json).exceptions) { $exceptions[$e.rule] = $e.reason } }

$expanded = Join-Path $Path 'expanded'
New-Item -ItemType Directory -Force -Path $expanded | Out-Null
foreach ($zip in Get-ChildItem -Path $Path -Filter *.zip -File) { Expand-Archive -Path $zip.FullName -DestinationPath (Join-Path $expanded $zip.BaseName) -Force }
$sarifFiles = @(Get-ChildItem -Path $Path -Recurse -File -Include *.sarif, *.sarif.json)
if ($sarifFiles.Count -eq 0) { throw "No SARIF results under $Path. Did pac solution check run?" }

$counts = @{ Critical = 0; High = 0; Medium = 0; Low = 0; Informational = 0 }
$blocking = @()
foreach ($file in $sarifFiles) {
    $sarif = Get-Content $file.FullName -Raw | ConvertFrom-Json
    foreach ($run in @($sarif.runs)) {
        foreach ($result in @($run.results)) {
            $severity = $null
            if ($result.PSObject.Properties['properties'] -and $result.properties -and $result.properties.PSObject.Properties['severity']) { $severity = [string]$result.properties.severity }
            if (-not $severity -or -not $rank.ContainsKey($severity)) {
                $level = if ($result.PSObject.Properties['level']) { [string]$result.level } else { 'warning' }
                $severity = $fromLevel[$level]
            }
            $rule = [string]$result.ruleId
            if ($exceptions.ContainsKey($rule)) { Write-Host "    [excepted] $rule ($severity): $($exceptions[$rule])" -ForegroundColor DarkGray; continue }
            $counts[$severity]++
            if ($rank[$severity] -ge $rank[$FailOn]) {
                $where = ''
                if ($result.PSObject.Properties['locations'] -and $result.locations) { $where = [string]$result.locations[0].physicalLocation.artifactLocation.uri }
                $blocking += "$severity $rule $where $($result.message.text)"
            }
        }
    }
}
Write-Host "    checker findings: Critical $($counts.Critical), High $($counts.High), Medium $($counts.Medium), Low $($counts.Low), Informational $($counts.Informational)"
if ($blocking.Count -gt 0) {
    foreach ($b in $blocking) { Write-Host "    [FAIL] $b" -ForegroundColor Red }
    Write-Host "$($blocking.Count) finding(s) at $FailOn or above." -ForegroundColor Red
    exit 1
}
Write-Host "No findings at $FailOn or above." -ForegroundColor Green
