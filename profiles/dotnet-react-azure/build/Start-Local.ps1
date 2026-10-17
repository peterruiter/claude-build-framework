<#
.SYNOPSIS
    Runs the product on this machine: LocalDB, both web apps built, the API on a loopback port.

.DESCRIPTION
    No Azure needed. The database is SQL Server LocalDB, created and migrated on start (Development
    only: the person running this is the person who would run the migrations). A different SQL Server
    works too: pass -ConnectionString.

    Give each parallel agent its own -Port and -Database, so two runs never share a database.

.PARAMETER Port
    Where to listen (loopback only). 5080 by default.

.PARAMETER Database
    The LocalDB database name. Defaults to the product name plus _Local.

.PARAMETER ConnectionString
    Another SQL Server instead of LocalDB.

.PARAMETER SkipWeb
    Do not rebuild the web apps.

.EXAMPLE
    ./build/Start-Local.ps1 -Port 5090 -Database MyProduct_AgentB
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)] [int] $Port = 5080,
    [ValidatePattern('^[A-Za-z0-9_]+$')] [string] $Database,
    [string] $ConnectionString,
    [switch] $SkipWeb
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
$root = Get-RepositoryRoot
$config = Get-ProfileConfig
$product = Get-ConfigValue $config 'product.name' -Required
$apiProject = Join-Path $root (Get-ConfigValue $config 'product.apiProject' -Required)
$web = Join-Path $root (Get-ConfigValue $config 'product.webFolder' -Default 'src/web')
if (-not $Database) { $Database = "${product}_Local" }

if (-not $ConnectionString)
{
    Assert-Command -Name sqllocaldb -InstallHint 'LocalDB comes with Visual Studio, or from https://aka.ms/sqllocaldb. Or pass -ConnectionString.' | Out-Null
    & sqllocaldb start MSSQLLocalDB | Out-Null
    $ConnectionString = "Server=(localdb)\MSSQLLocalDB;Database=$Database;Trusted_Connection=True;TrustServerCertificate=True"
}

if (-not $SkipWeb)
{
    Write-Host 'Building the web apps.' -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $web 'node_modules'))) { npm ci --prefix $web --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
    npm run build --prefix $web
    if ($LASTEXITCODE -ne 0) { throw 'The web build failed; npm run check names a missing string.' }
}

$env:ConnectionStrings__Database = $ConnectionString
$env:Database__ApplyMigrations = 'true'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = "http://127.0.0.1:$Port"

Write-Host ''
Write-Host "App    : http://127.0.0.1:$Port/app/"
Write-Host "Portal : http://127.0.0.1:$Port/portal/"
Write-Host "Health : http://127.0.0.1:$Port/health/ready"
Write-Host ''

& dotnet run --project $apiProject --no-launch-profile
