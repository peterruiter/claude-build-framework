<#
.SYNOPSIS
    Runs a script block with the az CLI's default subscription switched to the product's, asking
    first, and switches it back afterwards whatever happens.

.DESCRIPTION
    Most scripts here pass --subscription to every az command and never need this. Some steps sign
    in "as the az CLI" instead: a connection string with Authentication=Active Directory Default (the
    migrate command, Initialize-Database.ps1), DefaultAzureCredential, sqlcmd -G. Those use the CLI's
    current account and tenant, so on a machine whose default is another account (a client's), they
    run as the wrong person or fail.

    Switching the default affects every terminal and tool on the machine, so this asks every time,
    shows what will be switched and why, and restores the previous default in a finally block. An
    agent must never answer the question for the owner, and approval for one run does not carry over
    to the next.

    When the subscription is in another tenant the CLI is not signed in to, the switch fails: run
    "az login --tenant <tenant>" first (that also changes the default; this script restores it).

.PARAMETER ScriptBlock
    What to run while the product's subscription is the default.

.PARAMETER Reason
    Shown in the question: what the switch is for.

.PARAMETER SubscriptionId
    The subscription to switch to. Defaults to azure.subscriptionId in profile.config.json.

.EXAMPLE
    ./build/Invoke-WithAccount.ps1 -Reason 'apply migrations' -ScriptBlock { ./build/Initialize-Database.ps1 }
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [scriptblock] $ScriptBlock,
    [Parameter(Mandatory)] [string] $Reason,
    [string] $SubscriptionId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Initialize-AzCli

if (-not $SubscriptionId) { $SubscriptionId = Get-ConfigValue (Get-ProfileConfig) 'azure.subscriptionId' -Required }

$previous = az account show --query '{id:id, name:name, user:user.name}' --output json 2>$null | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $previous) { throw 'az is not signed in. Run az login first.' }

if ($previous.id -eq $SubscriptionId)
{
    Write-Host "The az default is already $($previous.name); running."
    & $ScriptBlock
    return
}

$target = az account show --subscription $SubscriptionId --query '{id:id, name:name}' --output json 2>$null | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $target)
{
    throw "The signed-in az account cannot see $SubscriptionId. Run 'az login --tenant <tenant>' first; nothing was switched."
}

Write-Host ''
Write-Host 'This switches the az CLI default subscription for every terminal on this machine:' -ForegroundColor Yellow
Write-Host "    from  $($previous.name) ($($previous.id)), signed in as $($previous.user)"
Write-Host "    to    $($target.name) ($($target.id))"
Write-Host "    for   $Reason"
Write-Host '    and back again afterwards, also when the step fails.'
Write-Host ''

if (-not $PSCmdlet.ShouldProcess("az default subscription", "Switch to $($target.name) for: $Reason")) { return }
if (-not $PSCmdlet.ShouldContinue("Switch the az default to $($target.name) for '$Reason'?", 'Switch the az CLI account'))
{
    Write-Host 'Not switched; nothing was run.'
    return
}

try
{
    az account set --subscription $SubscriptionId
    if ($LASTEXITCODE -ne 0) { throw "Could not switch to $SubscriptionId." }
    & $ScriptBlock
}
finally
{
    az account set --subscription $previous.id
    if ($LASTEXITCODE -eq 0) { Write-Host "The az default is $($previous.name) again." -ForegroundColor Green }
    else { Write-Warning "Could not switch the az default back. Run: az account set --subscription $($previous.id)" }
}
