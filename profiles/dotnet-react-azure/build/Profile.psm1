<#
.SYNOPSIS
    Shared helpers for every script in build/: the repository, profile.config.json, az.

.DESCRIPTION
    Import this rather than copying helpers between scripts: two scripts that each carry their
    own copy of a path resolver will eventually disagree about where the repository is.
#>

Set-StrictMode -Version Latest

function Get-RepositoryRoot
{
    <#
    .SYNOPSIS
        The repository root, from this module's location (not the current directory).
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Merge-ConfigObject
{
    # Recursively copies the properties of $Overlay onto $Base (objects merge, everything else replaces).
    param([Parameter(Mandatory)] $Base, [Parameter(Mandatory)] $Overlay)

    foreach ($property in $Overlay.PSObject.Properties)
    {
        $existing = $Base.PSObject.Properties[$property.Name]
        if ($existing -and $existing.Value -is [pscustomobject] -and $property.Value -is [pscustomobject])
        {
            Merge-ConfigObject -Base $existing.Value -Overlay $property.Value
        }
        elseif ($existing)
        {
            $existing.Value = $property.Value
        }
        else
        {
            $Base | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
        }
    }
}

function Get-ProfileConfig
{
    <#
    .SYNOPSIS
        Reads profile.config.json at the repository root, with profile.config.local.json merged on top.

    .DESCRIPTION
        Fails once, here, with the file named, rather than later as a null reference. Keys starting
        with _doc are documentation and are left in place (nothing reads them).

    .EXAMPLE
        $config = Get-ProfileConfig
        $config.azure.resourceGroup
    #>
    [CmdletBinding()]
    param()

    $root = Get-RepositoryRoot
    $path = Join-Path $root 'profile.config.json'
    if (-not (Test-Path $path))
    {
        throw "No profile.config.json at $root. Copy profile.config.json.example from the profile and fill it in."
    }

    try { $config = Get-Content -Path $path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { throw "profile.config.json is not valid JSON: $($_.Exception.Message)" }

    $local = Join-Path $root 'profile.config.local.json'
    if (Test-Path $local)
    {
        try { Merge-ConfigObject -Base $config -Overlay (Get-Content -Path $local -Raw -Encoding utf8 | ConvertFrom-Json) }
        catch { throw "profile.config.local.json is not valid JSON: $($_.Exception.Message)" }
    }

    return $config
}

function Get-ConfigValue
{
    <#
    .SYNOPSIS
        One setting by dotted path, such as azure.subscriptionId, with a default or a clear failure.

    .EXAMPLE
        Get-ConfigValue $config 'azure.resourceGroup' -Required
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)] $Config,
        [Parameter(Mandatory, Position = 1)] [string] $Path,
        $Default = $null,
        [switch] $Required
    )

    $node = $Config
    foreach ($part in $Path.Split('.'))
    {
        if ($null -eq $node -or -not $node.PSObject.Properties[$part]) { $node = $null; break }
        $node = $node.$part
    }

    $empty = $null -eq $node -or ($node -is [string] -and [string]::IsNullOrWhiteSpace($node))
    if ($empty -and $Required) { throw "profile.config.json has no value for '$Path'." }
    if ($empty) { return $Default }
    if ($node -is [string] -and $node -match '^0{8}-0{4}-0{4}-0{4}-0{12}$' -and $Required)
    {
        throw "profile.config.json still has the placeholder for '$Path'. Fill in the real value."
    }

    return $node
}

function Assert-Command
{
    <#
    .SYNOPSIS
        Checks a command line tool is installed, and says where to get it if not.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Name,
        [string] $InstallHint = ''
    )

    $command = Get-Command -Name $Name -ErrorAction SilentlyContinue
    if (-not $command)
    {
        $message = "'$Name' is not installed, or is not on PATH."
        if ($InstallHint) { $message += " $InstallHint" }
        throw $message
    }

    return $command
}

function Get-RepositoryVersion
{
    <#
    .SYNOPSIS
        The version in the VERSION file: what the assemblies report and the image tag starts with.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    $path = Join-Path (Get-RepositoryRoot) 'VERSION'
    if (-not (Test-Path $path)) { throw "No VERSION file at $path." }
    return (Get-Content $path -Raw).Trim()
}

function Get-PublicIpAddress
{
    <#
    .SYNOPSIS
        The public IP this machine reaches Azure from (behind a router the adapter's address is not it).

    .DESCRIPTION
        Behind a TLS-inspecting corporate proxy (Zscaler and the like) this call can fail with a
        certificate error, and the address Azure sees is the proxy's egress address, which changes.
        Pass the address explicitly to the calling script when that happens.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param()

    try
    {
        return ([string] (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15)).Trim()
    }
    catch
    {
        throw "Could not find this machine's public IP address, which the SQL firewall needs: $($_.Exception.Message). Pass -ClientIp to set it yourself."
    }
}

function Initialize-AzCli
{
    <#
    .SYNOPSIS
        Makes az output safe to stream on a Windows console, and checks az is there.

    .DESCRIPTION
        The registry's build log contains characters a non-UTF-8 Windows console cannot print; the az
        client then crashes mid-stream and reports a failure for a build that carried on and succeeded.
    #>
    [CmdletBinding()]
    param()

    Assert-Command -Name az -InstallHint 'Install from https://aka.ms/installazurecli' | Out-Null
    $env:PYTHONIOENCODING = 'utf-8'
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { Write-Verbose 'Console encoding unchanged.' }
}

function Assert-AzSubscription
{
    <#
    .SYNOPSIS
        Checks the signed-in az account can see the configured subscription, and returns its name.

    .DESCRIPTION
        Every az command in these scripts passes --subscription explicitly. That does not depend on
        the CLI's default account; but it needs an account that can see the subscription.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $SubscriptionId)

    $subscription = az account show --subscription $SubscriptionId --query '{id:id, name:name}' --output json 2>$null | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $subscription)
    {
        throw "The signed-in az account cannot see subscription $SubscriptionId. Run 'az login --tenant <tenant>' with an account that can. Nothing was changed."
    }

    return "$($subscription.name) ($($subscription.id))"
}

function Test-AzDefaultSubscription
{
    <#
    .SYNOPSIS
        Whether the az CLI's DEFAULT subscription is the configured one.

    .DESCRIPTION
        Matters for anything that signs in "as the az CLI" rather than passing --subscription:
        Authentication=Active Directory Default in a connection string (the migrate command) and
        DefaultAzureCredential use the CLI's current account and tenant. When it is another account
        (a client's), run the step through Invoke-WithAccount.ps1, which asks first and restores it.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param([Parameter(Mandatory)] [string] $SubscriptionId)

    $current = az account show --query id --output tsv 2>$null
    return $LASTEXITCODE -eq 0 -and $current -eq $SubscriptionId
}

function Set-SqlFirewallRule
{
    <#
    .SYNOPSIS
        Moves one named SQL firewall rule to an address (never adds one rule per address).
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $Server,
        [Parameter(Mandatory)] [string] $RuleName,
        [Parameter(Mandatory)] [string] $IpAddress
    )

    $rule = az sql server firewall-rule show --resource-group $ResourceGroup --server $Server --subscription $SubscriptionId --name $RuleName --query startIpAddress --output tsv 2>$null
    if ($rule -eq $IpAddress) { return }

    if ($PSCmdlet.ShouldProcess("$Server firewall rule $RuleName", "Allow $IpAddress (was $(if ($rule) { $rule } else { 'absent' }))"))
    {
        az sql server firewall-rule create --resource-group $ResourceGroup --server $Server --subscription $SubscriptionId `
            --name $RuleName --start-ip-address $IpAddress --end-ip-address $IpAddress --output none
        if ($LASTEXITCODE -ne 0) { throw "Could not let $IpAddress through the firewall of $Server." }
        Write-Host "The firewall rule $RuleName of $Server now lets $IpAddress in." -ForegroundColor Yellow
    }
}

function Get-AppName
{
    <#
    .SYNOPSIS
        The container app's name, as infra/modules/containerapps.bicep names it.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] $Config)

    $prefix = Get-ConfigValue $Config 'azure.namePrefix' -Required
    $suffix = Get-ConfigValue $Config 'azure.containerNameSuffix' -Default ''
    return "$prefix-api$suffix"
}

Export-ModuleMember -Function Get-RepositoryRoot, Get-ProfileConfig, Get-ConfigValue, Assert-Command, Get-RepositoryVersion,
    Get-PublicIpAddress, Initialize-AzCli, Assert-AzSubscription, Test-AzDefaultSubscription, Set-SqlFirewallRule, Get-AppName
