<#
.SYNOPSIS
    Applies the schema to a deployed database, as you.

.DESCRIPTION
    The app's managed identity holds db_datareader and db_datawriter and nothing more, so it cannot
    change the schema and never tries. A person does it, signed in with az login, through the API's
    own "migrate" command, which applies the migrations embedded in the build you are running
    (idempotent files; a ledger refuses a file that changed after it ran).

    Authentication=Active Directory Default signs in as the az CLI's CURRENT account. When the CLI's
    default subscription is not the product's (a client's account is the default on this machine),
    the step is run through Invoke-WithAccount.ps1, which asks before switching and switches back.

    The server's firewall must let this machine in: the one named rule (database.firewallRuleName)
    is moved to this machine's address first, unless -SkipFirewall.

    Run it from the release worktree (Release-Worktree.ps1 -Keep), so the migrations applied are the
    ones in the commit being released.

.PARAMETER ConnectionString
    The database. Defaults to the one Deploy-Infrastructure.ps1 prints, built from the config.

.PARAMETER ClientIp
    The address to let through the firewall, when the automatic lookup fails (corporate proxies).

.PARAMETER SkipFirewall
    Leaves the firewall alone.

.EXAMPLE
    ./build/Initialize-Database.ps1 -WhatIf

.EXAMPLE
    ./build/Initialize-Database.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $ConnectionString,
    [string] $ClientIp,
    [switch] $SkipFirewall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Assert-Command -Name dotnet -InstallHint 'Install the .NET SDK from https://dot.net' | Out-Null
Initialize-AzCli

$root = Get-RepositoryRoot
$config = Get-ProfileConfig
$sub = Get-ConfigValue $config 'azure.subscriptionId' -Required
$group = Get-ConfigValue $config 'azure.resourceGroup' -Required
$prefix = Get-ConfigValue $config 'azure.namePrefix' -Required
$apiProject = Join-Path $root (Get-ConfigValue $config 'product.apiProject' -Required)
$setting = Get-ConfigValue $config 'database.connectionSetting' -Default 'ConnectionStrings__Database'
$ruleName = Get-ConfigValue $config 'database.firewallRuleName' -Default 'AllowDeployingMachine'

Write-Host "Subscription: $(Assert-AzSubscription -SubscriptionId $sub)"
$server = "$prefix-sql"

if (-not $ConnectionString)
{
    $fqdn = az sql server show --resource-group $group --name $server --subscription $sub --query fullyQualifiedDomainName --output tsv
    if ($LASTEXITCODE -ne 0 -or -not $fqdn) { throw "Could not read $server in $group. Run Deploy-Infrastructure.ps1 first." }
    $ConnectionString = "Server=tcp:$fqdn,1433;Initial Catalog=$prefix-db;Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;Authentication=Active Directory Default;"
}
elseif ($ConnectionString -notmatch 'Authentication=')
{
    $ConnectionString = $ConnectionString.TrimEnd(';') + ';Authentication=Active Directory Default;'
}

if (-not $SkipFirewall)
{
    if (-not $ClientIp) { $ClientIp = Get-PublicIpAddress }
    Set-SqlFirewallRule -SubscriptionId $sub -ResourceGroup $group -Server $server -RuleName $ruleName -IpAddress $ClientIp
}

if (-not $PSCmdlet.ShouldProcess($server, 'Apply the migrations embedded in this build, as the signed-in person')) { return }

$migrate = {
    Set-Item -Path "env:$setting" -Value $ConnectionString
    try
    {
        & dotnet run --project $apiProject --configuration Release --no-launch-profile -- migrate
        if ($LASTEXITCODE -ne 0) { throw 'Applying the migrations failed. The message above names the migration and the batch.' }
    }
    finally
    {
        Remove-Item -Path "env:$setting" -ErrorAction SilentlyContinue
    }
}.GetNewClosure()

if (Test-AzDefaultSubscription -SubscriptionId $sub)
{
    & $migrate
}
else
{
    & (Join-Path $PSScriptRoot 'Invoke-WithAccount.ps1') -SubscriptionId $sub -Reason "apply database migrations to $server as yourself" -ScriptBlock $migrate
}

Write-Host ''
Write-Host 'The schema is up to date.' -ForegroundColor Green
Write-Host '    New database? Next: ./build/Grant-DatabaseAccess.ps1 so the app can read and write.'
