<#
.SYNOPSIS
    Lets the app's managed identity read and write the database (and nothing more).

.DESCRIPTION
    Azure SQL does not know the identity until somebody creates a contained database user for it, and
    Bicep cannot: it is a statement run inside the database. So this runs once after the first
    deployment, and again if the identity is recreated. Safe to repeat.

    The identity gets db_datareader and db_datawriter, not db_owner: schema changes belong to a
    person (Initialize-Database.ps1). An app that can alter its own schema can do it by accident.

    You must be the server's Entra administrator (or in its admin group); sqlcmd -G signs in as the
    az CLI's current account, so the CLI default must be the product's subscription (this script
    offers Invoke-WithAccount.ps1 when it is not).

.PARAMETER IdentityName
    The managed identity's name: <namePrefix>-identity by default (Deploy-Infrastructure.ps1 prints it).

.EXAMPLE
    ./build/Grant-DatabaseAccess.ps1 -WhatIf

    Prints the statements without running them.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $IdentityName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Initialize-AzCli

$config = Get-ProfileConfig
$sub = Get-ConfigValue $config 'azure.subscriptionId' -Required
$group = Get-ConfigValue $config 'azure.resourceGroup' -Required
$prefix = Get-ConfigValue $config 'azure.namePrefix' -Required
if (-not $IdentityName) { $IdentityName = "$prefix-identity" }

# Bracket-quoted below; an identity name cannot contain these, and checking costs nothing.
if ($IdentityName -match '[\[\]'']') { throw 'The identity name contains a bracket or a quote.' }

$sql = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$IdentityName')
BEGIN
    CREATE USER [$IdentityName] FROM EXTERNAL PROVIDER;
    PRINT 'User created.';
END
ELSE
    PRINT 'User already exists.';
ALTER ROLE db_datareader ADD MEMBER [$IdentityName];
ALTER ROLE db_datawriter ADD MEMBER [$IdentityName];
PRINT 'Read and write granted.';
"@

$fqdn = "$prefix-sql.database.windows.net"
Write-Host "Database : $prefix-db on $fqdn"
Write-Host "Identity : $IdentityName"

if (-not $PSCmdlet.ShouldProcess("$prefix-db", "Create user $IdentityName with read and write"))
{
    Write-Host ''
    Write-Host $sql
    return
}

Assert-Command -Name sqlcmd -InstallHint 'Install from https://aka.ms/sqlcmd' | Out-Null
Write-Host "Subscription: $(Assert-AzSubscription -SubscriptionId $sub)"
$fqdn = az sql server show --resource-group $group --name "$prefix-sql" --subscription $sub --query fullyQualifiedDomainName --output tsv
if ($LASTEXITCODE -ne 0 -or -not $fqdn) { throw "Could not read $prefix-sql." }

$grant = {
    $file = New-TemporaryFile
    try
    {
        Set-Content -Path $file -Value $sql -Encoding utf8
        sqlcmd -S $fqdn -d "$prefix-db" -G -i $file -b
        if ($LASTEXITCODE -ne 0) { throw 'Grant failed: are you the server''s Entra administrator, and does the firewall let this machine in (Initialize-Database.ps1 moves the rule)?' }
    }
    finally
    {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}.GetNewClosure()

if (Test-AzDefaultSubscription -SubscriptionId $sub) { & $grant }
else { & (Join-Path $PSScriptRoot 'Invoke-WithAccount.ps1') -SubscriptionId $sub -Reason "create the app's database user on $prefix-sql" -ScriptBlock $grant }

Write-Host "$IdentityName can read and write $prefix-db." -ForegroundColor Green
