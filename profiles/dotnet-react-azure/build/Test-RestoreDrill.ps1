<#
.SYNOPSIS
    The restore drill: restores the production database to a NEW database at a point in time,
    compares it with production, times it, and deletes it again. Asks for explicit confirmation.

.DESCRIPTION
    Proves, without touching production's data, that point-in-time restore works and how long it
    takes: the first half of the runbook "if production data is lost or corrupted".

      1. Shows the backup settings: PITR days and earliest restore point, long-term retention,
         backup storage redundancy.
      2. Asks you to type the drill database's name to go ahead (or pass -Confirm:$false only when
         the owner has said so for this run).
      3. Restores <prefix>-db to <prefix>-db-drill-<yyyyMMdd-HHmm> on the same server, as it was
         -MinutesAgo minutes ago (60) or at -PointInTime; serverless, pausing after an hour.
      4. Waits for it, saying how long it has been.
      5. Runs read-only queries on the copy and on production, side by side: row counts of
         database.restoreDrill.tables and the database.restoreDrill.queries.
      6. Deletes the copy, unless -Keep; also when a check fails.
      7. Shows blob soft delete for the storage account; -BlobUndeleteTest proves an undelete with a
         small blob under <first container>/_drill/ (needs Storage Blob Data Contributor).

    Production is changed in two named ways only: the SQL firewall rule (database.firewallRuleName) is
    moved to this machine's address when needed (-SkipFirewall leaves it), and the drill blob.

    Queries sign in with a token from az for the configured subscription's tenant.

.PARAMETER MinutesAgo
    How far back to restore to. 60 by default.

.PARAMETER PointInTime
    The moment to restore to, instead (UTC unless it says otherwise).

.PARAMETER Keep
    Leaves the drill database in place to look at; the command to delete it is printed.

.PARAMETER SkipFirewall
    Leaves the SQL firewall alone.

.PARAMETER ClientIp
    The address to let through, when the automatic lookup fails.

.PARAMETER BlobUndeleteTest
    Also proves a blob undelete.

.EXAMPLE
    ./build/Test-RestoreDrill.ps1 -WhatIf

.EXAMPLE
    ./build/Test-RestoreDrill.ps1 -MinutesAgo 120 -BlobUndeleteTest
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [ValidateRange(5, 50400)] [int] $MinutesAgo = 60,
    [Nullable[datetime]] $PointInTime = $null,
    [switch] $Keep,
    [switch] $SkipFirewall,
    [string] $ClientIp,
    [switch] $BlobUndeleteTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Initialize-AzCli

$config = Get-ProfileConfig
$sub = Get-ConfigValue $config 'azure.subscriptionId' -Required
$group = Get-ConfigValue $config 'azure.resourceGroup' -Required
$prefix = Get-ConfigValue $config 'azure.namePrefix' -Required
$ruleName = Get-ConfigValue $config 'database.firewallRuleName' -Default 'AllowDeployingMachine'
$tables = @(Get-ConfigValue $config 'database.restoreDrill.tables' -Default @('ops.SchemaMigration'))
$queries = @(Get-ConfigValue $config 'database.restoreDrill.queries' -Default @())
$timeoutMinutes = [int] (Get-ConfigValue $config 'database.restoreDrill.timeoutMinutes' -Default 120)
$server = "$prefix-sql"
$source = "$prefix-db"

foreach ($table in $tables) { if ($table -notmatch '^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$') { throw "restoreDrill table '$table' is not schema.table." } }

Write-Host "Subscription: $(Assert-AzSubscription -SubscriptionId $sub)"

$database = az sql db show --resource-group $group --server $server --name $source --subscription $sub `
    --query '{earliest:earliestRestoreDate, redundancy:currentBackupStorageRedundancy}' --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $database) { throw "Could not read $server/$source. Nothing was restored." }
$fqdn = az sql server show --resource-group $group --name $server --subscription $sub --query fullyQualifiedDomainName --output tsv
$retention = az sql db str-policy show --resource-group $group --server $server --name $source --subscription $sub --query retentionDays --output tsv
$ltr = az sql db ltr-policy show --resource-group $group --server $server --name $source --subscription $sub --query '{weekly:weeklyRetention, monthly:monthlyRetention, yearly:yearlyRetention}' --output json | ConvertFrom-Json

$target = if ($PointInTime) { ([datetime] $PointInTime).ToUniversalTime() } else { [datetime]::UtcNow.AddMinutes(-$MinutesAgo) }
$earliest = ([datetimeoffset] $database.earliest).UtcDateTime
if ($target -lt $earliest) { throw "$($target.ToString('u')) is before the earliest restore point, $($earliest.ToString('u')). Nothing was restored." }
if ($target -gt [datetime]::UtcNow.AddMinutes(-5)) { throw 'Restore to at least five minutes ago: the last log backup may not cover the last few minutes yet.' }

$drill = "$source-drill-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmm'))"
$when = $target.ToString('yyyy-MM-ddTHH:mm:ssZ')

Write-Host ''
Write-Host 'Backups now' -ForegroundColor Cyan
Write-Host "    Point-in-time restore : $retention days, earliest point $($earliest.ToString('u'))"
Write-Host "    Long-term retention   : weekly $($ltr.weekly), monthly $($ltr.monthly), yearly $($ltr.yearly)"
Write-Host "    Backup storage        : $($database.redundancy)"
Write-Host ''
Write-Host "The drill restores $source as it was at $when to a NEW database $drill on $server," -ForegroundColor Cyan
Write-Host "compares it with production (read-only) and deletes it$(if ($Keep) { ' (kept: -Keep)' })."

if (-not $PSCmdlet.ShouldProcess("$server/$drill", "Restore $source at $when")) { return }
if ($ConfirmPreference -ne 'None' -and -not $WhatIfPreference)
{
    $typed = Read-Host "Type the drill database's name ($drill) to go ahead"
    if ($typed -ne $drill) { Write-Host 'Not confirmed; nothing was restored.'; return }
}

if (-not $SkipFirewall)
{
    if (-not $ClientIp) { $ClientIp = Get-PublicIpAddress }
    Set-SqlFirewallRule -SubscriptionId $sub -ResourceGroup $group -Server $server -RuleName $ruleName -IpAddress $ClientIp -Confirm:$false
}

function Invoke-Query([string] $databaseName, [string] $sql)
{
    $token = az account get-access-token --resource https://database.windows.net/ --subscription $sub --query accessToken --output tsv
    if ($LASTEXITCODE -ne 0 -or -not $token) { throw 'Could not get a token for SQL from az.' }
    Add-Type -AssemblyName System.Data.SqlClient
    $connection = [System.Data.SqlClient.SqlConnection]::new("Server=tcp:$fqdn,1433;Initial Catalog=$databaseName;Encrypt=True;TrustServerCertificate=False;Connect Timeout=60")
    $connection.AccessToken = $token
    try
    {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandTimeout = 120
        $command.CommandText = "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; $sql"
        return [string] $command.ExecuteScalar()
    }
    finally
    {
        $connection.Dispose()
    }
}

# Row counts from the partitions: exact for a heap or clustered index, and no table scans.
$checks = @($tables | ForEach-Object {
    @{ label = "$_ rows"; sql = "SELECT CAST(ISNULL(SUM(p.rows), 0) AS NVARCHAR(40)) FROM sys.partitions p WHERE p.object_id = OBJECT_ID('$_') AND p.index_id IN (0, 1)" }
}) + @($queries | ForEach-Object { @{ label = $_.label; sql = $_.sql } })

$started = [datetime]::UtcNow
$restored = $false
$failure = $null
try
{
    az sql db restore --resource-group $group --server $server --name $source --subscription $sub `
        --dest-name $drill --time $target.ToString('yyyy-MM-ddTHH:mm:ss') --compute-model Serverless --auto-pause-delay 60 --min-capacity 0.5 `
        --backup-storage-redundancy Local --no-wait --output none
    if ($LASTEXITCODE -ne 0) { throw "Azure refused the restore of $source to $drill." }

    $deadline = $started.AddMinutes($timeoutMinutes)
    while ($true)
    {
        Start-Sleep -Seconds 20
        $status = az sql db show --resource-group $group --server $server --name $drill --subscription $sub --query status --output tsv 2>$null
        Write-Host ("    {0:hh\:mm\:ss}  {1}" -f ([datetime]::UtcNow - $started), $(if ($status) { $status } else { 'restoring' }))
        if ($status -in 'Online', 'Paused') { break }
        if ([datetime]::UtcNow -gt $deadline) { throw "The restore was not online after $timeoutMinutes minutes." }
    }

    $restored = $true
    $duration = [datetime]::UtcNow - $started
    Write-Host ("Restored in {0:hh\:mm\:ss} ({1:N1} minutes)." -f $duration, $duration.TotalMinutes) -ForegroundColor Green
    Write-Host ''
    Write-Host ("{0,-44} {1,-28} {2}" -f 'Check', "Drill ($when)", 'Production now') -ForegroundColor Cyan
    foreach ($check in $checks)
    {
        Write-Host ("{0,-44} {1,-28} {2}" -f $check.label, (Invoke-Query $drill $check.sql), (Invoke-Query $source $check.sql))
    }
}
catch
{
    $failure = $_
}
finally
{
    $delete = "az sql db delete --resource-group $group --server $server --name $drill --subscription $sub --yes"
    if ($Keep)
    {
        Write-Host ''
        Write-Host "Kept $drill. Delete it when done: $delete" -ForegroundColor Yellow
    }
    else
    {
        $exists = az sql db show --resource-group $group --server $server --name $drill --subscription $sub --query name --output tsv 2>$null
        if ($exists)
        {
            az sql db delete --resource-group $group --server $server --name $drill --subscription $sub --yes --output none
            if ($LASTEXITCODE -eq 0) { Write-Host "Deleted $drill." } else { Write-Warning "Could not delete $drill. Delete it by hand: $delete" }
        }
        elseif (-not $restored)
        {
            Write-Warning "$drill does not exist (yet). If the restore is still running, delete it once it appears: $delete"
        }
    }
}

# ------------------------------------------------------------------- blobs --
Write-Host ''
Write-Host 'Blob storage' -ForegroundColor Cyan
$account = az storage account list --resource-group $group --subscription $sub --query "[?starts_with(name, '$($prefix)st')].name | [0]" --output tsv
if (-not $account)
{
    Write-Warning "No storage account $($prefix)st* in $group."
}
else
{
    $blob = az storage account blob-service-properties show --account-name $account --resource-group $group --subscription $sub `
        --query '{blobDays:deleteRetentionPolicy.days, blobOn:deleteRetentionPolicy.enabled, containerDays:containerDeleteRetentionPolicy.days, containerOn:containerDeleteRetentionPolicy.enabled, versioning:isVersioningEnabled}' --output json | ConvertFrom-Json
    Write-Host "    Account             : $account"
    Write-Host "    Blob soft delete    : $(if ($blob.blobOn) { "on, $($blob.blobDays) days" } else { 'OFF' })"
    Write-Host "    Container soft del. : $(if ($blob.containerOn) { "on, $($blob.containerDays) days" } else { 'OFF' })"
    Write-Host "    Versioning          : $(if ($blob.versioning) { 'on' } else { 'off' })"
    if (-not $blob.blobOn -or -not $blob.containerOn) { Write-Warning 'Soft delete is not fully on: run Deploy-Infrastructure.ps1.' }

    $container = @(Get-ConfigValue $config 'storage.containers' -Default @('media')) | Select-Object -Last 1
    if ($BlobUndeleteTest -and $PSCmdlet.ShouldProcess("$account/$container/_drill", 'Write, delete and undelete a drill blob'))
    {
        $name = "_drill/$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')).txt"
        $file = New-TemporaryFile
        try
        {
            Set-Content -Path $file -Value "restore drill $((Get-Date).ToUniversalTime().ToString('o'))" -Encoding utf8
            az storage blob upload --account-name $account --container-name $container --name $name --file $file --auth-mode login --subscription $sub --output none
            if ($LASTEXITCODE -ne 0) { throw 'Could not write the drill blob (needs Storage Blob Data Contributor).' }
            az storage blob delete --account-name $account --container-name $container --name $name --auth-mode login --subscription $sub --output none
            az storage blob undelete --account-name $account --container-name $container --name $name --auth-mode login --subscription $sub --output none
            $back = az storage blob exists --account-name $account --container-name $container --name $name --auth-mode login --subscription $sub --query exists --output tsv
            if ($back -eq 'true') { Write-Host "    Undelete            : proven on $container/$name" -ForegroundColor Green }
            else { Write-Warning "The drill blob $container/$name did not come back from soft delete." }
        }
        finally
        {
            az storage blob delete --account-name $account --container-name $container --name $name --auth-mode login --subscription $sub --output none 2>$null
            Remove-Item $file -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($failure) { throw $failure }
