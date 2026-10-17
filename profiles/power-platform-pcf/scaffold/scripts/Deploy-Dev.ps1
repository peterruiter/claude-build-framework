<#
.SYNOPSIS
    Imports the solution into a DEVELOPMENT environment, as the person running it, after the
    owner's go.

.DESCRIPTION
    Builds the solution (unless -SkipBuild), shows who pac is signed in as and which environment
    it points at, and imports the unmanaged zip only when:

      - the active pac auth profile is connected to -EnvironmentUrl (the script never switches
        accounts or profiles: switching is the owner's decision; it prints how),
      - the confirmation (typed at the prompt, or -ConfirmHost) is that environment's host name.

    Unmanaged zips belong in development environments only. Test, acceptance and production get
    the managed zip (solution/bin/Release/*_managed.zip) through the release flow, with the
    owner's go per release.

.PARAMETER EnvironmentUrl
    The development environment, for example https://contoso-dev.crm4.dynamics.com.

.PARAMETER ConfirmHost
    The environment's host name, exactly as the owner gave it in their go. Without it the script
    asks at the prompt. An agent passes it only with the host the owner typed, never its own.

.PARAMETER SkipBuild
    Import the zip already in solution/bin/Release.

.EXAMPLE
    ./scripts/Deploy-Dev.ps1 -EnvironmentUrl https://contoso-dev.crm4.dynamics.com
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidatePattern('^https://[a-z0-9.-]+/?$')] [string] $EnvironmentUrl,
    [string] $ConfirmHost,
    [switch] $SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$targetHost = ([Uri]$EnvironmentUrl).Host

if (-not (Get-Command pac -ErrorAction SilentlyContinue)) {
    throw 'pac is not installed: dotnet tool install --global Microsoft.PowerApps.CLI.Tool'
}

# ------------------------------------------------------------------ who --
$who = (& pac org who 2>&1) -join "`n"
$connected = [regex]::Match($who, 'Org URL:\s*(\S+)').Groups[1].Value
$user = [regex]::Match($who, '(?:User Email|Connected as):?\s*(\S+@\S+)').Groups[1].Value
if (-not $connected) {
    Write-Host $who
    throw "pac has no active connection. The owner creates or selects a profile: pac auth create --environment $EnvironmentUrl (or pac auth list, then pac auth select --index <n>)."
}
$connectedHost = ([Uri]$connected).Host
Write-Host "pac is signed in as $user, connected to $connectedHost."
if ($connectedHost -ne $targetHost) {
    & pac auth list
    throw "The active profile points at $connectedHost, not $targetHost. This script does not switch profiles: ask the owner, who runs pac auth select --index <n> (and switches back afterwards)."
}

# ---------------------------------------------------------------- build --
if (-not $SkipBuild) {
    Push-Location (Join-Path $root 'controls')
    try {
        npm run check
        if ($LASTEXITCODE -ne 0) { throw 'npm run check failed.' }
    }
    finally { Pop-Location }
    $project = Get-ChildItem (Join-Path $root 'solution') -Filter *.cdsproj | Select-Object -First 1
    dotnet build $project.FullName --configuration Release
    if ($LASTEXITCODE -ne 0) { throw 'The solution build failed.' }
}

$zip = Get-ChildItem (Join-Path $root 'solution/bin/Release') -Filter *.zip -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*_managed.zip' } | Select-Object -First 1
if (-not $zip) { throw 'No unmanaged solution zip in solution/bin/Release: build first.' }
$version = [regex]::Match((Get-Content (Join-Path $root 'solution/src/Other/Solution.xml') -Raw), '<Version>([^<]+)</Version>').Groups[1].Value

# -------------------------------------------------------------- confirm --
Write-Host ''
Write-Host "Import $($zip.Name) (solution version $version, unmanaged) into $targetHost as $user." -ForegroundColor Yellow
if (-not $ConfirmHost) { $ConfirmHost = Read-Host "Type $targetHost to import, anything else to stop" }
if ($ConfirmHost.Trim() -ne $targetHost) {
    Write-Host 'Not confirmed. Nothing was imported.'
    exit 1
}

# --------------------------------------------------------------- import --
& pac solution import --environment $EnvironmentUrl --path $zip.FullName --publish-changes --async
if ($LASTEXITCODE -ne 0) { throw 'The import failed: see the output above (pac solution import).' }
Write-Host "Imported $($zip.Name) $version into $targetHost. Hard-refresh the app (Ctrl+F5) to load the new control version." -ForegroundColor Green
