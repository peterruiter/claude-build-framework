<#
.SYNOPSIS
    Creates or reconciles everything the product runs on (infra/main.bicep), keeping what is deployed.

.DESCRIPTION
    Safe to run again: it reconciles rather than recreates. Before deploying it reads back what the
    running environment has, because a template deployed without it would remove it:

      custom domains        an ingress deployed without them removes them
      the running image     otherwise the placeholder comes back
      settings and secrets  set by hand and unknown to the template: carried over and named at the
                            end (add them to profile.config.json); -DropUnmanagedSettings removes them
      secret values         for secrets in the config without a value passed now: plain secrets are
                            read back with their value; Key Vault references are carried as the
                            reference (keyVaultUrl), never as an empty value
      database admin        the server's Entra administrator stays who it is
      backup retention      point-in-time restore days never shrink below what is set
      alert address         read from the action group when the config leaves it empty
      purge protection      read from the vault (it cannot be switched off)

    Everything happens in the configured subscription, passed to every az command. Secrets are
    passed in a parameters file in the user's temp folder (not on the command line, not in the
    process list) that is deleted as soon as the deployment has read it.

    The order on a new environment:
      1. ./build/Deploy-Infrastructure.ps1     (this; the app runs the platform placeholder)
      2. ./build/Initialize-Database.ps1       (the schema, as you)
      3. ./build/Grant-DatabaseAccess.ps1      (the app's identity may read and write)
      4. ./build/Publish-Container.ps1         (builds the image; the first one comes back here)

.PARAMETER SecretValues
    Values for the plain (non Key Vault) secrets in app.secrets, by secret name:
    @{ 'smtp-password' = (Read-Host -AsSecureString) }. Left out, the running app's value is kept.

.PARAMETER ContainerImage
    The image to run. Left out, the one already running (Publish-Container.ps1 passes the first one).

.PARAMETER ClientIp
    The address the SQL firewall lets in for migrations, when the automatic lookup fails.

.PARAMETER DropUnmanagedSettings
    Leaves out settings and secrets on the running app that the template and config do not know.

.EXAMPLE
    ./build/Deploy-Infrastructure.ps1 -WhatIf

.EXAMPLE
    ./build/Deploy-Infrastructure.ps1 -SecretValues @{ 'smtp-password' = (Read-Host 'SMTP password' -AsSecureString) }
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [hashtable] $SecretValues = @{},
    [string] $ContainerImage = '',
    [string] $ClientIp,
    [switch] $DropUnmanagedSettings
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Initialize-AzCli

$root = Get-RepositoryRoot
$config = Get-ProfileConfig
$sub = Get-ConfigValue $config 'azure.subscriptionId' -Required
$group = Get-ConfigValue $config 'azure.resourceGroup' -Required
$prefix = Get-ConfigValue $config 'azure.namePrefix' -Required
if ($prefix -notmatch '^[a-z0-9]{3,20}$') { throw "azure.namePrefix '$prefix' must be 3-20 lower case letters and digits." }
$location = Get-ConfigValue $config 'azure.location' -Default 'swedencentral'
$sqlLocation = Get-ConfigValue $config 'azure.sqlLocation' -Default ''
$containerLocation = Get-ConfigValue $config 'azure.containerLocation' -Default ''
$suffix = Get-ConfigValue $config 'azure.containerNameSuffix' -Default ''
$app = Get-AppName $config

function Plain([securestring] $value)
{
    if (-not $value) { return '' }
    return [System.Net.NetworkCredential]::new('', $value).Password
}

Write-Host "Subscription : $(Assert-AzSubscription -SubscriptionId $sub)"
Write-Host "Group        : $group ($location)"

$me = az ad signed-in-user show --query '{id:id, name:userPrincipalName}' --output json 2>$null | ConvertFrom-Json
if (-not $me) { throw 'Could not read the signed-in user (az ad signed-in-user show). Sign in as a person: az login.' }
if (-not $ClientIp) { try { $ClientIp = Get-PublicIpAddress } catch { Write-Warning $_.Exception.Message; $ClientIp = '' } }

if (-not $PSCmdlet.ShouldProcess("$group in $sub", 'Create or reconcile the infrastructure')) { return }

az group create --name $group --location $location --subscription $sub --output none
if ($LASTEXITCODE -ne 0) { throw "Could not create or read $group. Nothing was deployed." }

# What is there already. A read that fails on a resource that exists stops the deployment: carrying on
# would deploy blanks over it.
$present = @(az resource list --resource-group $group --subscription $sub --query '[].name' --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw "Could not list $group. Nothing was deployed." }

# ----------------------------------------------------------- the running app --
$domains = @()
$runningEnv = @()
$runningSecrets = @()
if ($present -contains $app)
{
    $show = az containerapp show --name $app --resource-group $group --subscription $sub --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $show) { throw "Could not read $app, so its domains and settings cannot be carried over. Nothing was deployed." }
    $ingress = $show.properties.configuration.ingress
    if ($ingress -and $ingress.PSObject.Properties['customDomains'] -and $ingress.customDomains) { $domains = @($ingress.customDomains) }
    $runningEnv = @($show.properties.template.containers[0].env | Where-Object { $_ })
    if (-not $ContainerImage)
    {
        $running = $show.properties.template.containers[0].image
        if ($running -and $running -notlike 'mcr.microsoft.com/k8se/*') { $ContainerImage = $running }
    }

    # --show-values returns the value of a plain secret, and for a Key Vault reference its keyVaultUrl and
    # NO value. Carrying the reference is right; carrying the missing value would deploy an empty secret.
    $runningSecrets = @(az containerapp secret list --name $app --resource-group $group --subscription $sub --show-values --output json | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw "Could not read the secrets of $app. Nothing was deployed." }
}

function RunningSecret([string] $name)
{
    return $runningSecrets | Where-Object { $_.name -eq $name } | Select-Object -First 1
}

function CarriedSecret($secret)
{
    if ($secret.PSObject.Properties['keyVaultUrl'] -and $secret.keyVaultUrl) { return @{ name = $secret.name; keyVaultUrl = $secret.keyVaultUrl } }
    if ($secret.PSObject.Properties['value'] -and $null -ne $secret.value) { return @{ name = $secret.name; value = [string] $secret.value } }
    throw "The app's secret $($secret.name) has neither a value nor a Key Vault reference that could be read, so it cannot be carried over. Nothing was deployed."
}

# ------------------------------------------------------------ settings, secrets --
$settings = @()
$configSettings = Get-ConfigValue $config 'app.settings'
if ($configSettings) { foreach ($p in $configSettings.PSObject.Properties) { if ($p.Name -notlike '_doc*') { $settings += @{ name = $p.Name; value = [string] $p.Value } } } }

$secretItems = @()
foreach ($secret in @(Get-ConfigValue $config 'app.secrets' -Default @()))
{
    $item = @{ name = $secret.name }
    if ($secret.PSObject.Properties['env'] -and $secret.env) { $item.env = $secret.env }
    if ($secret.PSObject.Properties['keyVaultSecret'] -and $secret.keyVaultSecret)
    {
        $item.keyVaultSecret = $secret.keyVaultSecret
    }
    elseif ($SecretValues.ContainsKey($secret.name))
    {
        $value = $SecretValues[$secret.name]
        $item.value = if ($value -is [securestring]) { Plain $value } else { [string] $value }
    }
    elseif ($existing = RunningSecret $secret.name)
    {
        $carried = CarriedSecret $existing
        foreach ($key in $carried.Keys) { if ($key -ne 'name') { $item[$key] = $carried[$key] } }
    }
    else
    {
        Write-Host "No value for secret $($secret.name): left out. Pass -SecretValues @{ '$($secret.name)' = (Read-Host -AsSecureString) } or set keyVaultSecret." -ForegroundColor Yellow
        continue
    }
    $secretItems += $item
}

$carriedEnv = @()
if (-not $DropUnmanagedSettings)
{
    $known = @($secretItems | ForEach-Object { $_.name })
    foreach ($secret in $runningSecrets | Where-Object { $known -notcontains $_.name })
    {
        $secretItems += CarriedSecret $secret
        Write-Host "Carrying over secret $($secret.name), which the config does not know." -ForegroundColor Yellow
    }
    $carriedEnv = @($runningEnv | ForEach-Object {
        if ($_.PSObject.Properties['secretRef'] -and $_.secretRef) { @{ name = $_.name; secretRef = [string] $_.secretRef } }
        else { @{ name = $_.name; value = $(if ($_.PSObject.Properties['value']) { [string] $_.value } else { '' }) } }
    })
}

# ------------------------------------------------------------------- database --
$server = "$prefix-sql"
$adminId = $me.id
$adminName = $me.name
$adminType = 'User'
$autoPause = [int] (Get-ConfigValue $config 'database.autoPauseMinutes' -Default -1)
$retention = [int] (Get-ConfigValue $config 'database.backupRetentionDays' -Default 14)
if ($present -contains $server)
{
    $existing = az sql server show --resource-group $group --subscription $sub --name $server --query '{location:location, sid:administrators.sid, login:administrators.login, type:administrators.principalType}' --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $existing) { throw "Could not read $server. Nothing was deployed." }
    # A server cannot move region, and its administrator stays who it is.
    $sqlLocation = $existing.location
    if ($existing.sid) { $adminId = $existing.sid; $adminName = $existing.login; if ($existing.type) { $adminType = $existing.type } }

    $kept = az sql db str-policy show --resource-group $group --subscription $sub --server $server --name "$prefix-db" --query retentionDays --output tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $kept -and [int] $kept -gt $retention)
    {
        Write-Host "Keeping point-in-time restore of $kept days (longer than the config's $retention)." -ForegroundColor Yellow
        $retention = [int] $kept
    }
}

# --------------------------------------------------------------- vault, alerts --
$purge = [bool] (Get-ConfigValue $config 'keyVault.purgeProtection' -Default $false)
$vault = $present | Where-Object { $_ -like "$prefix-kv-*" } | Select-Object -First 1
if ($vault)
{
    $on = az keyvault show --name $vault --resource-group $group --subscription $sub --query 'properties.enablePurgeProtection' --output tsv
    if ($LASTEXITCODE -ne 0) { throw "Could not read $vault. Nothing was deployed." }
    if ($on -eq 'true') { $purge = $true }
}

$alertEmail = Get-ConfigValue $config 'monitoring.alertEmail' -Default ''
if (-not $alertEmail -and $present -contains "$prefix-alerts")
{
    $alertEmail = az monitor action-group show --resource-group $group --subscription $sub --name "$prefix-alerts" --query 'emailReceivers[0].emailAddress' --output tsv
    if ($LASTEXITCODE -ne 0) { throw "Could not read the action group $prefix-alerts; deploying without its address would remove every alert. Nothing was deployed." }
}
if (-not $alertEmail) { Write-Host 'No monitoring.alertEmail: no availability tests or alerts are deployed.' -ForegroundColor Yellow }

# ----------------------------------------------------------------- parameters --
function Value($path, $default) { return @{ value = (Get-ConfigValue $config $path -Default $default) } }

$parameters = [ordered] @{
    namePrefix              = @{ value = $prefix }
    location                = @{ value = $location }
    sqlLocation             = @{ value = $(if ($sqlLocation) { $sqlLocation } else { $location }) }
    containerLocation       = @{ value = $(if ($containerLocation) { $containerLocation } elseif ($sqlLocation) { $sqlLocation } else { $location }) }
    containerNameSuffix     = @{ value = $suffix }
    administratorObjectId   = @{ value = $adminId }
    administratorName       = @{ value = $adminName }
    administratorType       = @{ value = $adminType }
    clientIpAddress         = @{ value = $ClientIp }
    containerImage          = @{ value = $ContainerImage }
    publicBaseUrl           = Value 'app.publicBaseUrl' ''
    appSettings             = @{ value = @($settings) }
    appSecrets              = @{ value = @{ items = @($secretItems) } }
    carriedEnv              = @{ value = @($carriedEnv) }
    customDomains           = @{ value = @($domains) }
    minReplicas             = Value 'app.minReplicas' 1
    maxReplicas             = Value 'app.maxReplicas' 5
    httpConcurrency         = Value 'app.httpConcurrency' 100
    cpu                     = Value 'app.cpu' '0.5'
    memory                  = Value 'app.memory' '1Gi'
    sqlAutoPauseMinutes     = @{ value = $autoPause }
    sqlMinVCores            = Value 'database.minVCores' '0.5'
    sqlMaxVCores            = Value 'database.maxVCores' 1
    sqlBackupRetentionDays  = @{ value = $retention }
    sqlWeeklyRetention      = Value 'database.weeklyRetention' 'P4W'
    sqlMonthlyRetention     = Value 'database.monthlyRetention' 'P6M'
    sqlYearlyRetention      = Value 'database.yearlyRetention' 'PT0S'
    sqlBackupRedundancy     = Value 'database.backupRedundancy' 'Local'
    storageContainers       = @{ value = @(Get-ConfigValue $config 'storage.containers' -Default @('dataprotection', 'media')) }
    storageSoftDeleteDays   = Value 'storage.softDeleteDays' 14
    storageSku              = Value 'storage.sku' 'Standard_LRS'
    vaultPurgeProtection    = @{ value = $purge }
    logRetentionDays        = Value 'monitoring.logRetentionDays' 30
    deployOpenAi            = @{ value = [bool] (Get-ConfigValue $config 'openAi.enabled' -Default $false) }
    openAiDeploymentName    = Value 'openAi.deploymentName' 'chat'
    openAiModel             = Value 'openAi.model' 'gpt-4o-mini'
    openAiModelVersion      = Value 'openAi.modelVersion' '2024-07-18'
    openAiDeploymentType    = Value 'openAi.deploymentType' 'DataZoneStandard'
    openAiCapacity          = Value 'openAi.capacity' 10
    alertEmail              = @{ value = [string] $alertEmail }
    testTier                = Value 'monitoring.testTier' 'core'
    testLocationCount       = Value 'monitoring.testLocationCount' 3
    testFrequencySeconds    = Value 'monitoring.testFrequencySeconds' 600
    disabledAlertRules      = @{ value = @(Get-ConfigValue $config 'monitoring.disabledRules' -Default @()) }
    testLocations           = @{ value = @(Get-ConfigValue $config 'monitoring.testLocations' -Default @()) }
    serverErrorsPer5Minutes = Value 'monitoring.serverErrorsPer5Minutes' 20
    errorLinesPer15Minutes  = Value 'monitoring.errorLinesPer15Minutes' 10
    sqlAlertPercent         = Value 'monitoring.sqlAlertPercent' 80
}
$tests = Get-ConfigValue $config 'monitoring.availabilityTests'
if ($tests) { $parameters.availabilityTests = @{ value = @($tests) } }

$file = Join-Path ([System.IO.Path]::GetTempPath()) "deploy-$([guid]::NewGuid()).parameters.json"
@{ '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'; contentVersion = '1.0.0.0'; parameters = $parameters } |
    ConvertTo-Json -Depth 20 | Set-Content -Path $file -Encoding utf8

try
{
    $deployment = "$prefix-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
    $raw = az deployment group create --resource-group $group --subscription $sub --name $deployment `
        --template-file (Join-Path $root 'infra/main.bicep') --parameters "@$file" --query properties.outputs --output json 2>&1
    $failed = $LASTEXITCODE -ne 0
    $text = ($raw | ForEach-Object { "$_" }) -join "`n"
    if ($failed)
    {
        # az names a nested deployment, not the reason; the reason is on the failed operation inside it.
        Write-Host $text -ForegroundColor Yellow
        $reasons = foreach ($nested in 'monitoring', 'registry', 'sql', 'keyvault', 'storage', 'openai', 'containerapps', 'alerts')
        {
            az deployment operation group list --resource-group $group --subscription $sub --name $nested `
                --query "[?properties.provisioningState=='Failed'].properties.statusMessage.error.message" --output tsv 2>$null
        }
        throw "The deployment failed. $(($reasons | Where-Object { $_ }) -join ' ')"
    }
    $outputs = ($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n" | ConvertFrom-Json
}
finally
{
    Remove-Item $file -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Deployed.' -ForegroundColor Green
Write-Host "    App        : $($outputs.appUrl.value)"
Write-Host "    Registry   : $($outputs.registryName.value)"
Write-Host "    SQL server : $($outputs.sqlServer.value)"
Write-Host "    Identity   : $($outputs.identityName.value)"
Write-Host "    Static IP  : $($outputs.staticIp.value)"
if (-not $ContainerImage) { Write-Host '    Image      : the platform placeholder, until Publish-Container.ps1 builds one' -ForegroundColor Yellow }

$carried = @($outputs.carriedSettings.value)
if ($carried.Count -gt 0)
{
    Write-Host ''
    Write-Host "Carried over from the running app, unknown to the config: $($carried -join ', '). Add them to profile.config.json (app.settings / app.secrets)." -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next:'
Write-Host '    ./build/Initialize-Database.ps1      (schema changes; a new database)'
Write-Host '    ./build/Grant-DatabaseAccess.ps1     (a new database or identity)'
Write-Host '    ./build/Publish-Container.ps1        (the image)'
