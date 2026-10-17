<#
.SYNOPSIS
    Shows the errors and warnings of the newest revision (or a given one) from Log Analytics.

.DESCRIPTION
    Run after every release: a revision can be Healthy and still fail every request of one kind.
    Reads the container's console log (ContainerAppConsoleLogs_CL) and the platform's system log
    (ContainerAppSystemLogs_CL) for the revision over the last -Minutes, and prints error and warning
    lines (fail:, crit:, warn:, exceptions, probe failures). Read-only.

    Logs arrive in Log Analytics a few minutes late; a clean result two minutes after a release means
    little. Wait five, or run it again.

.PARAMETER Revision
    The revision name. Defaults to the app's latest revision.

.PARAMETER Minutes
    How far back to look. Defaults to logs.minutes in the config (15).

.EXAMPLE
    ./build/Check-Logs.ps1

.EXAMPLE
    ./build/Check-Logs.ps1 -Minutes 60 -IncludeInfo
#>
[CmdletBinding()]
param(
    [string] $Revision,
    [ValidateRange(1, 1440)] [int] $Minutes,
    [switch] $IncludeInfo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Initialize-AzCli

$config = Get-ProfileConfig
$sub = Get-ConfigValue $config 'azure.subscriptionId' -Required
$group = Get-ConfigValue $config 'azure.resourceGroup' -Required
$prefix = Get-ConfigValue $config 'azure.namePrefix' -Required
$app = Get-AppName $config
if (-not $Minutes) { $Minutes = [int] (Get-ConfigValue $config 'logs.minutes' -Default 15) }
$top = [int] (Get-ConfigValue $config 'logs.top' -Default 50)

Write-Host "Subscription: $(Assert-AzSubscription -SubscriptionId $sub)"
if (-not $Revision)
{
    $Revision = az containerapp show --name $app --resource-group $group --subscription $sub --query 'properties.latestRevisionName' --output tsv
    if ($LASTEXITCODE -ne 0 -or -not $Revision) { throw "Could not read the latest revision of $app." }
}
if ($Revision -notmatch '^[a-z0-9-]+$') { throw "'$Revision' is not a revision name." }

$workspace = az monitor log-analytics workspace show --resource-group $group --workspace-name "$prefix-logs" --subscription $sub --query customerId --output tsv
if ($LASTEXITCODE -ne 0 -or -not $workspace) { throw "Could not read the workspace $prefix-logs." }

$filter = if ($IncludeInfo) { 'true' } else { @'
Line startswith "fail:" or Line startswith "crit:" or Line startswith "warn:" or Line matches regex @"^\s*[A-Za-z_][\w.]*Exception: " or Source == "system"
'@.Trim() }

$query = @"
union
  (ContainerAppConsoleLogs_CL | where RevisionName_s == '$Revision' | project TimeGenerated, Source = 'console', Line = Log_s),
  (ContainerAppSystemLogs_CL | where RevisionName_s == '$Revision' and Reason_s !in ('ContainerStarted', 'Pulled', 'Pulling', 'Created', 'Started', 'AssigningReplica', 'ContainerCreated', 'RevisionReady', 'KEDAScalersStarted') | project TimeGenerated, Source = 'system', Line = strcat(Reason_s, ': ', Log_s))
| where TimeGenerated > ago(${Minutes}m)
| where $filter
| order by TimeGenerated desc
| take $top
"@

Write-Host "Revision $Revision, last $Minutes minutes$(if (-not $IncludeInfo) { ', errors and warnings' }):"
$rows = az monitor log-analytics query --workspace $workspace --analytics-query $query --subscription $sub --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'The log query failed (az monitor log-analytics query).' }

$rows = @($rows)
if ($rows.Count -eq 0)
{
    Write-Host '    nothing' -ForegroundColor Green
    return
}

foreach ($row in $rows | Sort-Object TimeGenerated)
{
    $colour = if ($row.Line -match '^(fail|crit):|Exception: ') { 'Red' } elseif ($row.Line -match '^warn:') { 'Yellow' } else { 'Gray' }
    Write-Host ("    {0}  {1,-7} {2}" -f $row.TimeGenerated, $row.Source, $row.Line) -ForegroundColor $colour
}
Write-Host "$($rows.Count) line(s)$(if ($rows.Count -ge $top) { " (the newest $top)" })."
