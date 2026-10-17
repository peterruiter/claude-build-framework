<#
.SYNOPSIS
    Shared helpers for the scripts in build/. Import it; do not copy from it.

.DESCRIPTION
    Every script in build/ starts with

        Import-Module "$PSScriptRoot/Common.psm1" -Force

    Four groups of helpers:

    - Console output (Write-Step, Write-Ok, Write-Warn, Write-Fail, Write-Skip).
    - Contracts and configuration (Get-RepoRoot, Get-Contract, Get-EnvironmentConfig).
    - The environment guard (Confirm-Environment): shows the environment URL, its kind and the
      signed-in account, and asks before anything touches it. Writes need the host name typed
      back; in CI the same is done by passing -ConfirmUrl with the exact URL. Production imports
      need the owner's go on top.
    - Dataverse and pac (Connect-Dataverse, Invoke-Dataverse, Get-DataverseAll, New-Label,
      Invoke-Pac). The Web API uses a token from the Azure CLI (the operator's own sign-in; no
      secret is read or written). pac uses its own auth profile; every pac call passes
      --environment explicitly, never the profile's default.

    Importing this module does nothing against any environment.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Generated output must not depend on the operator's regional settings.
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::InvariantCulture

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:PlaceholderTenant = '00000000-0000-0000-0000-000000000000'

# --- console -----------------------------------------------------------------------------------

function Write-Step { param([Parameter(Mandatory)][string]$Message) Write-Host ''; Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok { param([Parameter(Mandatory)][string]$Message) Write-Host "    [ok]   $Message" -ForegroundColor Green }
function Write-Warn { param([Parameter(Mandatory)][string]$Message) Write-Host "    [warn] $Message" -ForegroundColor Yellow }
function Write-Fail { param([Parameter(Mandatory)][string]$Message) Write-Host "    [FAIL] $Message" -ForegroundColor Red }
function Write-Skip { param([Parameter(Mandatory)][string]$Message) Write-Host "    [skip] $Message" -ForegroundColor DarkGray }

# --- contracts and configuration ---------------------------------------------------------------

function Get-RepoRoot { return $script:RepoRoot }

function Get-Contract {
    <# Loads build/contracts/<Name>.json. #>
    param([Parameter(Mandatory)][string]$Name)
    $path = Join-Path $script:RepoRoot "build/contracts/$Name.json"
    if (-not (Test-Path $path)) { throw "Contract not found: $path" }
    return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-EnvironmentConfig {
    <#
    .SYNOPSIS
        Reads environments.json, merges environments.local.json (gitignored) on top by id, and
        returns one environment, or all of them without -Id. A personal development
        environment is a new entry in the local file; CI writes the real tenant and URLs there.
    .DESCRIPTION
        Refuses the placeholder tenant and URLs that are not a Dataverse organisation URL, so a
        freshly scaffolded repository cannot reach anything by accident.
    #>
    param([string]$Id)
    $path = Join-Path $script:RepoRoot 'environments.json'
    if (-not (Test-Path $path)) { throw "environments.json not found at $path" }
    $config = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($e in $config.environments) { $list.Add($e) }
    $local = Join-Path $script:RepoRoot 'environments.local.json'
    if (Test-Path $local) {
        $extra = Get-Content $local -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($extra.PSObject.Properties['tenantId']) { $config.tenantId = $extra.tenantId }
        foreach ($e in @($extra.environments)) {
            # Same id: the local file's properties win (CI writes just id and url). New id: a
            # personal environment, taken as it is.
            $existing = $list | Where-Object { $_.id -eq $e.id } | Select-Object -First 1
            if ($existing) { foreach ($p in $e.PSObject.Properties) { $existing | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force } }
            else { $list.Add($e) }
        }
    }
    if (-not $Id) { return [pscustomobject]@{ tenantId = $config.tenantId; environments = $list.ToArray() } }
    $match = @($list | Where-Object { $_.id -eq $Id })
    if ($match.Count -ne 1) { throw "No environment '$Id' in environments.json (known: $(($list | ForEach-Object id) -join ', '))." }
    $environment = $match[0]
    if ($config.tenantId -eq $script:PlaceholderTenant) {
        throw 'environments.json still has the placeholder tenantId. Fill in the real tenant id (in environments.local.json if it must stay out of git) before any script talks to an environment.'
    }
    if ($environment.url -notmatch '^https://[a-z0-9-]+\.crm[0-9]*\.dynamics\.com/?$') {
        throw "Environment '$Id' has url '$($environment.url)', which is not a Dataverse organisation URL."
    }
    $environment | Add-Member -NotePropertyName tenantId -NotePropertyValue $config.tenantId -Force
    $environment.url = $environment.url.TrimEnd('/')
    return $environment
}

# --- the environment guard ---------------------------------------------------------------------

function Test-NonInteractive {
    return [bool]($env:CI -or $env:GITHUB_ACTIONS -or $env:TF_BUILD -or [Console]::IsInputRedirected)
}

function Confirm-Environment {
    <#
    .SYNOPSIS
        Shows which environment and which account a script is about to use, and asks.
    .PARAMETER Environment
        An entry from Get-EnvironmentConfig.
    .PARAMETER Account
        The signed-in identity, as the caller found it (az or pac).
    .PARAMETER Write
        The script will change the environment: the operator types the host name back.
    .PARAMETER ConfirmUrl
        Non-interactive confirmation (CI): must equal the environment URL exactly.
    .PARAMETER ProductionGo
        The owner's go for this run. Required for any write to an environment with
        requireApproval, interactive or not.
    #>
    param(
        [Parameter(Mandatory)]$Environment,
        [Parameter(Mandatory)][string]$Account,
        [string]$Action = 'read from',
        [switch]$Write,
        [string]$ConfirmUrl,
        [switch]$ProductionGo
    )
    $hostName = ([Uri]$Environment.url).Host
    Write-Host ''
    Write-Host "    About to $Action" -ForegroundColor Yellow
    Write-Host "      environment  $($Environment.name) ($($Environment.id), kind $($Environment.kind))" -ForegroundColor Yellow
    Write-Host "      url          $($Environment.url)" -ForegroundColor Yellow
    Write-Host "      account      $Account" -ForegroundColor Yellow
    if ($Write -and $Environment.requireApproval -and -not $ProductionGo) {
        throw "$($Environment.name) needs the owner's go for this run. Ask, then pass -ProductionGo (in CI the GitHub environment's required reviewers give it)."
    }
    if ($ConfirmUrl) {
        if ($ConfirmUrl.TrimEnd('/') -ne $Environment.url) { throw "-ConfirmUrl '$ConfirmUrl' does not match $($Environment.url). Nothing was done." }
        Write-Ok "confirmed by -ConfirmUrl"
        return
    }
    if (Test-NonInteractive) { throw 'Not interactive and no -ConfirmUrl given. Nothing was done.' }
    if ($Write) {
        $answer = Read-Host "    Type the host name ($hostName) to continue, anything else stops"
        if ($answer.Trim() -ne $hostName) { throw 'Not confirmed. Nothing was done.' }
    }
    else {
        $answer = Read-Host '    Continue? (y/N)'
        if ($answer.Trim() -notin @('y', 'Y', 'yes')) { throw 'Not confirmed. Nothing was done.' }
    }
}

# --- Azure CLI identity and the Web API ---------------------------------------------------------

function Assert-Command {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name is not installed. $Hint" }
}

function Get-AzAccount {
    <#
    .SYNOPSIS
        The Azure CLI's signed-in user, checked against the tenant in environments.json. Never
        switches accounts: if the CLI is signed in elsewhere, it stops and says so.
    #>
    param([Parameter(Mandatory)]$Environment)
    Assert-Command az 'Install the Azure CLI and sign in with az login.'
    $account = az account show --only-show-errors -o json 2>$null | ConvertFrom-Json
    if (-not $account) { throw 'The Azure CLI is not signed in. Run az login (the owner decides which account).' }
    if ($account.tenantId -ne $Environment.tenantId) {
        throw "The Azure CLI is signed in to tenant $($account.tenantId); environments.json says $($Environment.tenantId). Ask the owner before switching accounts; sign in with: az login --tenant $($Environment.tenantId) --allow-no-subscriptions"
    }
    return "$($account.user.name) (Azure CLI, tenant $($account.tenantId))"
}

function Connect-Dataverse {
    <# Prepares the Web API transport. Call after Confirm-Environment. #>
    param([Parameter(Mandatory)]$Environment)
    $script:DataverseEnvironment = $Environment
    $token = az account get-access-token --resource "$($Environment.url)/" --tenant $Environment.tenantId --query accessToken -o tsv --only-show-errors
    if (-not $token) { throw "No token for $($Environment.url). Is this account a user in that environment?" }
    $script:DataverseHeaders = @{
        Authorization      = "Bearer $token"
        'OData-MaxVersion' = '4.0'
        'OData-Version'    = '4.0'
        Accept             = 'application/json'
        'Content-Type'     = 'application/json; charset=utf-8'
    }
    $who = Invoke-Dataverse -Path '/api/data/v9.2/WhoAmI'
    $user = Invoke-Dataverse -Path "/api/data/v9.2/systemusers($($who.UserId))?`$select=fullname,domainname"
    Write-Host "    connected to $($Environment.url) as $($user.fullname) <$($user.domainname)>" -ForegroundColor DarkGray
}

function Invoke-Dataverse {
    <#
    .SYNOPSIS
        Calls the Dataverse Web API and throws with the message Dataverse returned.
    .DESCRIPTION
        Retries only what is safe to retry:
        - 429 (service protection limits): waits the Retry-After the server sends. The request
          was not carried out.
        - 502/503/504 on a GET.
        - "another solution import or publish is running": the request was refused, not carried
          out; such an operation can take minutes.
        - one 401: the token expired, a new one is fetched.
        Nothing else is retried: a second attempt at a write the platform may already have half
        applied is worse than the first failure. Scripts are idempotent instead: run them again.
    #>
    param(
        [string]$Method = 'GET',
        [Parameter(Mandatory)][string]$Path,
        $Body,
        [string]$SolutionName,
        [switch]$Representation,
        [int]$MaxAttempts = 8
    )
    if (-not $script:DataverseHeaders) { throw 'Call Connect-Dataverse first.' }
    $uri = if ($Path -like 'http*') { $Path } else { "$($script:DataverseEnvironment.url)$Path" }
    $refreshed = $false
    for ($attempt = 1; ; $attempt++) {
        $headers = $script:DataverseHeaders.Clone()
        if ($SolutionName) { $headers['MSCRM.SolutionUniqueName'] = $SolutionName }
        if ($Representation) { $headers['Prefer'] = 'return=representation' }
        try {
            $arguments = @{ Method = $Method; Uri = $uri; Headers = $headers; TimeoutSec = 600 }
            if ($null -ne $Body) {
                $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 30 -Compress }
                $arguments.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
            }
            return Invoke-RestMethod @arguments
        }
        catch {
            $status = 0
            $retryAfter = $null
            try {
                $response = $_.Exception.Response
                if ($null -ne $response) {
                    $status = [int]$response.StatusCode
                    if ($response.Headers.RetryAfter -and $response.Headers.RetryAfter.Delta) { $retryAfter = [int][Math]::Ceiling($response.Headers.RetryAfter.Delta.TotalSeconds) }
                }
            }
            catch { $status = 0 }
            $detail = if ($_.ErrorDetails) { [string]$_.ErrorDetails.Message } else { '' }
            $reason = if ($detail -match '"message":\s*"((?:[^"\\]|\\.)*)"') { $Matches[1] } else { $_.Exception.Message }

            if ($status -eq 401 -and -not $refreshed) {
                $refreshed = $true
                Connect-Dataverse -Environment $script:DataverseEnvironment
                continue
            }
            if ($attempt -lt $MaxAttempts -and $status -eq 429) {
                $wait = if ($retryAfter) { $retryAfter } else { 30 * $attempt }
                Write-Host "    ... service protection limit, waiting ${wait}s as the server asks ($attempt of $($MaxAttempts - 1))" -ForegroundColor DarkGray
                Start-Sleep -Seconds $wait
                continue
            }
            if ($attempt -lt $MaxAttempts -and $Method -eq 'GET' -and $status -in 502, 503, 504) {
                Start-Sleep -Seconds (10 * $attempt)
                continue
            }
            if ($attempt -lt $MaxAttempts -and "$detail $reason" -match 'another \[?[A-Za-z]+\]? (is )?running|installation or removal of another solution|solution is currently being imported|customization lock') {
                Write-Host '    ... another solution operation is running in the environment, waiting 30s' -ForegroundColor DarkGray
                Start-Sleep -Seconds 30
                continue
            }
            throw "$Method $Path failed ($status): $reason"
        }
    }
}

function Get-DataverseAll {
    <# Follows @odata.nextLink until every page is read. A first page alone silently drops the rest. #>
    param([Parameter(Mandatory)][string]$Path)
    $rows = [System.Collections.Generic.List[object]]::new()
    $next = $Path
    while ($next) {
        $page = Invoke-Dataverse -Path $next
        foreach ($row in @($page.value)) { $rows.Add($row) }
        $next = if ($page.PSObject.Properties['@odata.nextLink']) { $page.'@odata.nextLink' } else { $null }
    }
    return $rows.ToArray()
}

function Test-DataverseExists {
    param([Parameter(Mandatory)][string]$Path)
    try { [void](Invoke-Dataverse -Path $Path -MaxAttempts 3); return $true }
    catch { if ("$_" -match '\(404\)|does not exist|Could not find') { return $false }; throw }
}

function New-Label {
    <#
    .SYNOPSIS
        A Dataverse Label with one LocalizedLabel per LCID, from a contract text object such as
        { "1033": "Request", "1043": "Verzoek" }.
    #>
    param([Parameter(Mandatory)]$Text)
    $localized = foreach ($p in $Text.PSObject.Properties) {
        @{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = [string]$p.Value; LanguageCode = [int]$p.Name }
    }
    return @{ '@odata.type' = 'Microsoft.Dynamics.CRM.Label'; LocalizedLabels = @($localized) }
}

# --- pac ---------------------------------------------------------------------------------------

function Invoke-Pac {
    <#
    .SYNOPSIS
        Runs pac and throws on a non-zero exit code. Returns the output lines.
    .PARAMETER Environment
        When given, --environment <url> is added: never rely on the auth profile's default.
    #>
    param([Parameter(Mandatory)][string[]]$Arguments, $Environment)
    Assert-Command pac 'Install the Power Platform CLI: dotnet tool install --global Microsoft.PowerApps.CLI.Tool'
    $all = @($Arguments)
    if ($Environment) { $all += @('--environment', $Environment.url) }
    $output = & pac @all 2>&1
    $code = $LASTEXITCODE
    $text = @($output | ForEach-Object { "$_" })
    # pac can print "Error: ..." and still exit 0 (seen with pack on a path over 260 characters).
    $errorLine = $text | Where-Object { $_ -match '^Error:' } | Select-Object -First 1
    if ($code -ne 0 -or $errorLine) { throw "pac $($Arguments -join ' ') failed ($code):`n$($text -join "`n")" }
    return $text
}

function Get-PacAccount {
    <#
    .SYNOPSIS
        Who pac will act as: the user (or application id) of the ACTIVE auth profile, read from
        `pac auth list`, which is local and calls no environment. pac uses the active profile's
        identity for every --environment, so this is what the operator confirms.
    #>
    $lines = Invoke-Pac -Arguments @('auth', 'list')
    $active = $lines | Where-Object { $_ -match '^\[\d+\]\s+\*' } | Select-Object -First 1
    if (-not $active) { throw 'pac has no active auth profile. Create one with pac auth create (the owner decides which account), then select it with pac auth select.' }
    $user = if ($active -match '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})') { $Matches[1] }
            elseif ($active -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') { "application $($Matches[1])" }
            else { $active.Trim() }
    return "$user (active pac auth profile)"
}

function Assert-PacReaches {
    <# After the confirmation: pac org who must report the confirmed host, or nothing runs. #>
    param([Parameter(Mandatory)]$Environment)
    $text = (Invoke-Pac -Arguments @('org', 'who') -Environment $Environment) -join "`n"
    $hostName = ([Uri]$Environment.url).Host
    if ($text -notmatch [regex]::Escape($hostName)) {
        throw "pac org who does not report $hostName. Check pac auth list; the active profile may not reach this environment."
    }
    Write-Ok "pac reaches $hostName"
}

function Get-SolutionManifest {
    <# Unique name, version and managed flag from a solution zip (solution.xml inside it). Reads only. #>
    param([Parameter(Mandatory)][string]$ZipPath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $ZipPath).Path)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -ieq 'solution.xml' } | Select-Object -First 1
        if (-not $entry) { throw "$ZipPath has no solution.xml; is it a solution zip?" }
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    finally { $zip.Dispose() }
    $manifest = $xml.ImportExportXml.SolutionManifest
    return [pscustomobject]@{ UniqueName = $manifest.UniqueName; Version = $manifest.Version; Managed = ($manifest.Managed -eq '1') }
}

Export-ModuleMember -Function *
