<#
.SYNOPSIS
    Imports solution zips into one environment, in order, with that environment's deployment
    settings, after showing the URL and the account and getting a typed confirmation.

.DESCRIPTION
    The only script that deploys. It refuses rather than guesses:

    - The environment must be in environments.json, with a real tenant id.
    - What it accepts must match the zip: managed zips for test and production, unmanaged for
      development and build (accepts in environments.json).
    - Production (requireApproval) needs -ProductionGo: the owner's go for this run. Never
      assume it from an earlier run.
    - The operator types the host name back (or, in CI, passes -ConfirmUrl with the exact URL;
      the GitHub environment's required reviewers are the go there).
    - The installed version is read first. Same or lower than the zip's: refused, unless
      -AllowSameVersion. A managed solution already installed is upgraded (single-step
      --stage-and-upgrade: components the new version dropped are removed); a first install is a
      plain import.
    - Connection references without a ConnectionId in the settings file are named: flows that
      use them stay off until someone sets the connection.

    Options follow Microsoft's import performance guidance: no publish-all for managed
    solutions, no overwrite of unmanaged customisations (block those in test and production
    instead), plug-ins and flows activated.

.PARAMETER Environment
    Id in environments.json.

.PARAMETER Path
    One or more solution zips, imported in the order given. Or -BuildManifest.

.PARAMETER BuildManifest
    out/build.json (or a release's release.json): imports its solutions in importOrder.

.PARAMETER SettingsFile
    Deployment settings for this environment. Default: the environment's deploymentSettings.

.PARAMETER WhatIf
    Shows what would be imported, with which settings, and stops before importing.

.EXAMPLE
    ./build/Import-Solution.ps1 -Environment test -BuildManifest ./release/release.json

.EXAMPLE
    ./build/Import-Solution.ps1 -Environment prod -BuildManifest ./release/release.json -ProductionGo
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$Environment,
    [string[]]$Path,
    [string]$BuildManifest,
    [string]$SettingsFile,
    [string]$ConfirmUrl,
    [switch]$ProductionGo,
    [switch]$AllowSameVersion,
    [int]$MaxWaitMinutes = 60
)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Get-RepoRoot
$target = Get-EnvironmentConfig -Id $Environment

# --- what to import ----------------------------------------------------------------------------
$zips = @()
if ($BuildManifest) {
    $manifestFile = (Resolve-Path $BuildManifest).Path
    $build = Get-Content $manifestFile -Raw | ConvertFrom-Json
    $base = Split-Path -Parent $manifestFile
    foreach ($s in @($build.solutions | Sort-Object importOrder)) {
        $candidate = if ($s.PSObject.Properties['file']) { Join-Path $base $s.file } else { Join-Path $root $s.zip }
        $zips += (Resolve-Path $candidate).Path
    }
}
foreach ($p in @($Path)) { if ($p) { $zips += (Resolve-Path $p).Path } }
if ($zips.Count -eq 0) { throw 'Nothing to import: pass -Path or -BuildManifest.' }

$plan = foreach ($zip in $zips) {
    $m = Get-SolutionManifest -ZipPath $zip
    $wantManaged = $target.accepts -eq 'managed'
    if ($m.Managed -ne $wantManaged) {
        throw "$($m.UniqueName) $($m.Version) is $(if ($m.Managed) { 'managed' } else { 'unmanaged' }); $($target.name) accepts $($target.accepts) solutions only."
    }
    [pscustomobject]@{ Zip = $zip; UniqueName = $m.UniqueName; Version = [version]$m.Version; Managed = $m.Managed }
}

if (-not $SettingsFile -and $target.deploymentSettings) { $SettingsFile = Join-Path $root $target.deploymentSettings }
if ($SettingsFile) {
    $SettingsFile = (Resolve-Path $SettingsFile).Path
    $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
    foreach ($c in @($settings.ConnectionReferences)) {
        if (-not $c.ConnectionId) { Write-Warn "connection reference $($c.LogicalName) has no ConnectionId in $(Split-Path -Leaf $SettingsFile): flows that use it stay off until a connection is set." }
    }
}

Write-Step "Import into $($target.name)"
foreach ($p in $plan) { Write-Host "    $($p.UniqueName) $($p.Version) $(if ($p.Managed) { 'managed' } else { 'unmanaged' })  <- $(Split-Path -Leaf $p.Zip)" }
Write-Host "    settings: $(if ($SettingsFile) { $SettingsFile } else { 'none' })"
if (-not $PSCmdlet.ShouldProcess($target.url, 'import solutions')) { return }

# --- who and where, then the go ----------------------------------------------------------------
$account = Get-PacAccount
Confirm-Environment -Environment $target -Account $account -Action "IMPORT $($plan.Count) solution(s) into" -Write -ConfirmUrl $ConfirmUrl -ProductionGo:$ProductionGo
Assert-PacReaches -Environment $target

# --- installed versions (pac solution list; text output) ----------------------------------------
$listed = Invoke-Pac -Arguments @('solution', 'list') -Environment $target
function Get-InstalledVersion {
    param([string]$UniqueName)
    foreach ($line in $listed) {
        $cells = @($line.Trim() -split '\s{2,}')
        if ($cells.Count -ge 2 -and $cells[0] -eq $UniqueName) {
            $v = $cells | Where-Object { $_ -match '^\d+(\.\d+){1,3}$' } | Select-Object -First 1
            $managed = [bool]($cells | Where-Object { $_ -eq 'True' } | Select-Object -First 1)
            if ($v) { return [pscustomobject]@{ Version = [version]$v; Managed = $managed } }
        }
    }
    return $null
}

foreach ($p in $plan) {
    Write-Step "$($p.UniqueName) $($p.Version)"
    $installed = Get-InstalledVersion -UniqueName $p.UniqueName
    $arguments = @('solution', 'import', '--path', $p.Zip, '--activate-plugins', '--async', '--max-async-wait-time', "$MaxWaitMinutes")
    if ($SettingsFile) { $arguments += @('--settings-file', $SettingsFile) }
    if ($installed) {
        Write-Host "    installed: $($installed.Version) $(if ($installed.Managed) { 'managed' } else { 'unmanaged' })" -ForegroundColor DarkGray
        if ($installed.Version -ge $p.Version -and -not $AllowSameVersion) {
            throw "$($p.UniqueName) $($installed.Version) is already installed; the zip is $($p.Version). Bump the version (VERSION, Export-Solution -SetVersion) or pass -AllowSameVersion."
        }
        if ($p.Managed -and -not $installed.Managed) { throw "$($p.UniqueName) is unmanaged in $($target.name); a managed import over it is not allowed. This environment was set up wrong: ask the owner." }
        if ($p.Managed) { $arguments += '--stage-and-upgrade' }
    }
    if (-not $p.Managed) { $arguments += '--publish-changes' }
    $output = Invoke-Pac -Arguments $arguments -Environment $target
    $output | Select-Object -Last 3 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Ok "$($p.UniqueName) $($p.Version) imported"
}

Write-Host ''
Write-Host "Done. Next: smoke test $($target.name) (sign in as a test user per role), check the flows are on, record the release in STATE.md." -ForegroundColor Cyan
