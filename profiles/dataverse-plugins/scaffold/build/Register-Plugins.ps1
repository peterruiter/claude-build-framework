<#
.SYNOPSIS
    Registers the plug-in package, its steps and images, and the custom APIs from
    build/contracts/registration.json. A dry run unless -Apply.

.DESCRIPTION
    The manifest is the only place a step, image or custom API is defined; this script makes an
    environment match it. Three ways to run it:

      -Offline              No environment, no sign-in: checks the manifest and the package, and
                            prints what a first registration would create. CI runs this.
      -EnvironmentUrl ...   Signs in with the Azure CLI's CURRENT account (it never switches account),
                            reads the environment (GET only) and prints the plan: what it would
                            create, update or replace. Nothing changes.
      ... -Apply            Does it. Shows the environment and the signed-in account first and needs
                            the environment's host typed back (or -ConfirmEnvironment <host>, which
                            stands for the owner's explicit go for THIS environment).

    What it does, in order, every create in -SolutionName (MSCRM.SolutionUniqueName):
      1. Plug-in package: created (uniquename, version 1.0.0, content) or its content replaced. The
         package's name and version cannot change after creation; its version plays no part in upgrades.
      2. Plug-in types: the platform registers the IPlugin classes it finds; any it did not are created.
      3. Steps: matched by name on the package's types. Changed mode, rank, filtering attributes,
         configuration or description are updated; a changed message, table, stage or class is a
         delete-and-create. Steps on the package's types that the manifest no longer lists are
         reported, and deleted only with -Prune.
      4. Images: an image whose columns changed is deleted and created again (an in-place change has
         been seen to fail with "An unexpected error occurred").
      5. Custom APIs: created with their parameters (deep insert); the plug-in, display name and
         description are updated. Parameters cannot change type or name after creation: a difference
         is reported, never "fixed" by deleting the API (that breaks its callers).

    Secure configuration is never read from the repository: an administrator sets it per environment.

.PARAMETER EnvironmentUrl
    https://<org>.crm4.dynamics.com (any region). Required unless -Offline.

.PARAMETER Apply
    Make the changes. Without it the script only reads and prints.

.PARAMETER ConfirmEnvironment
    The environment's host name, given after the owner approved applying to exactly this environment
    (for non-interactive runs). Interactive runs ask for it.

.PARAMETER Subscription
    Passed to az for the token (some machines hold several accounts; the script never changes the
    CLI's default).

.PARAMETER PackagePath
    The .nupkg to upload. Default: the newest under out/package, then src/**/bin/Release.

.PARAMETER SolutionName
    The unmanaged solution new components are added to. Default: the manifest's solution.

.PARAMETER Prune
    Also delete steps on the package's plug-in types that the manifest no longer lists.

.EXAMPLE
    ./build/Register-Plugins.ps1 -Offline

.EXAMPLE
    ./build/Register-Plugins.ps1 -EnvironmentUrl https://contoso-dev.crm4.dynamics.com

.EXAMPLE
    ./build/Register-Plugins.ps1 -EnvironmentUrl https://contoso-dev.crm4.dynamics.com -Apply -ConfirmEnvironment contoso-dev.crm4.dynamics.com
#>
[CmdletBinding()]
param(
    [string] $EnvironmentUrl,
    [switch] $Apply,
    [string] $ConfirmEnvironment,
    [switch] $Offline,
    [string] $Subscription,
    [string] $PackagePath,
    [string] $SolutionName,
    [string] $Manifest = (Join-Path $PSScriptRoot 'contracts/registration.json'),
    [switch] $Prune
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# ------------------------------------------------------------------ manifest --
$stages = @{ PreValidation = 10; PreOperation = 20; PostOperation = 40 }
$modes = @{ Synchronous = 0; Asynchronous = 1 }
$imageTypes = @{ Pre = 0; Post = 1 }
$bindingTypes = @{ Global = 0; Entity = 1; EntityCollection = 2 }
$processingStepTypes = @{ None = 0; AsyncOnly = 1; SyncAndAsync = 2 }
$parameterTypes = @{ Boolean = 0; DateTime = 1; Decimal = 2; Entity = 3; EntityCollection = 4; EntityReference = 5; Float = 6; Integer = 7; Money = 8; Picklist = 9; String = 10; StringArray = 11; Guid = 12 }

function Get-Optional($object, [string] $name, $default = $null)
{
    if ($null -ne $object -and $object.PSObject.Properties[$name]) { return $object.$name }
    return $default
}

function Read-Manifest([string] $path)
{
    if (-not (Test-Path $path)) { throw "No manifest at $path." }
    $m = Get-Content $path -Raw | ConvertFrom-Json
    $problems = @()
    if (-not (Get-Optional $m 'solution') -or -not $m.solution.uniqueName -or -not $m.solution.publisherPrefix) { $problems += 'solution.uniqueName and solution.publisherPrefix are required' }
    if (-not (Get-Optional $m 'package') -or -not $m.package.uniqueName -or -not $m.package.assembly) { $problems += 'package.uniqueName and package.assembly are required' }
    $names = @{}
    foreach ($step in @(Get-Optional $m 'steps' @()))
    {
        $label = Get-Optional $step 'name' '(no name)'
        if ($names.ContainsKey($label)) { $problems += "step '$label' is listed twice" }
        $names[$label] = $true
        if (-not $stages.ContainsKey([string](Get-Optional $step 'stage'))) { $problems += "step '$label': stage must be one of $($stages.Keys -join ', ')" }
        if (-not $modes.ContainsKey([string](Get-Optional $step 'mode'))) { $problems += "step '$label': mode must be Synchronous or Asynchronous" }
        if ($step.mode -eq 'Asynchronous' -and $step.stage -ne 'PostOperation') { $problems += "step '$label': asynchronous steps run PostOperation only" }
        if ($step.message -eq 'Update' -and @(Get-Optional $step 'filteringAttributes' @()).Count -eq 0) { $problems += "step '$label': an Update step needs filteringAttributes" }
        foreach ($image in @(Get-Optional $step 'images' @()))
        {
            if (-not $imageTypes.ContainsKey([string]$image.type)) { $problems += "step '$label': image type must be Pre or Post" }
            if (@($image.attributes).Count -eq 0) { $problems += "step '$label': image '$($image.name)' must list its columns" }
        }
    }
    foreach ($api in @(Get-Optional $m 'customApis' @()))
    {
        if (-not $bindingTypes.ContainsKey([string]$api.bindingType)) { $problems += "custom API '$($api.uniqueName)': bindingType must be Global, Entity or EntityCollection" }
        foreach ($p in @($api.requestParameters) + @($api.responseProperties)) { if ($p -and -not $parameterTypes.ContainsKey([string]$p.type)) { $problems += "custom API '$($api.uniqueName)': '$($p.uniqueName)' has an unknown type '$($p.type)'" } }
    }
    if ($problems.Count -gt 0) { throw "The manifest has problems:`n  - $($problems -join "`n  - ")" }
    return $m
}

function Find-Package([string] $assembly)
{
    $candidates = @(Get-ChildItem -Path (Join-Path $root 'out/package') -Filter "$assembly.*.nupkg" -ErrorAction SilentlyContinue) +
                  @(Get-ChildItem -Path (Join-Path $root 'src') -Recurse -Filter "$assembly.*.nupkg" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\\/]Release[\\/]' })
    $newest = $candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $newest) { throw "No $assembly package found. Build it: dotnet build -c Release; dotnet pack $($manifestData.package.project) -c Release --no-build -o out/package" }
    return $newest.FullName
}

function Get-MessagePropertyName([string] $message)
{
    switch ($message)
    {
        'Create' { 'Id' }
        'SetState' { 'EntityMoniker' }
        { $_ -in 'Send', 'DeliverIncoming', 'DeliverPromote' } { 'EmailId' }
        default { 'Target' }
    }
}

$manifestData = Read-Manifest $Manifest
if (-not $SolutionName) { $SolutionName = $manifestData.solution.uniqueName }
if (-not $PackagePath) { $PackagePath = Find-Package $manifestData.package.assembly }
if (-not (Test-Path $PackagePath)) { throw "Package not found: $PackagePath" }
$packageBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $PackagePath).Path)
Write-Host "Manifest:  $(@($manifestData.steps).Count) steps, $(@(Get-Optional $manifestData 'customApis' @()).Count) custom APIs, solution $SolutionName"
Write-Host "Package:   $PackagePath ($([math]::Round($packageBytes.Length / 1KB)) KB)"
if ($packageBytes.Length -gt 16MB) { throw 'The package is larger than 16 MB, the platform limit for a plug-in assembly.' }

# ------------------------------------------------------------------- offline --
if ($Offline)
{
    Write-Host ''
    Write-Host 'Offline: a first registration would create' -ForegroundColor Cyan
    Write-Host "  package   $($manifestData.package.uniqueName) (version 1.0.0) in solution $SolutionName"
    foreach ($step in $manifestData.steps)
    {
        $images = @(Get-Optional $step 'images' @()) | ForEach-Object { "$($_.type)Image $($_.name)" }
        Write-Host ("  step      {0}: {1} {2} {3} {4}, rank {5}{6}{7}" -f $step.plugin.Split('.')[-1], $step.message, $step.table, $step.stage, $step.mode, $step.rank,
            $(if (Get-Optional $step 'filteringAttributes') { ", on $($step.filteringAttributes -join ',')" } else { '' }),
            $(if ($images) { ", $($images -join ', ')" } else { '' }))
    }
    foreach ($api in @(Get-Optional $manifestData 'customApis' @()))
    {
        Write-Host ("  custom API {0} ({1}{2}), {3} in, {4} out" -f $api.uniqueName, $api.bindingType, $(if ($api.isFunction) { ' function' } else { ' action' }), @($api.requestParameters).Count, @($api.responseProperties).Count)
    }
    Write-Host ''
    Write-Host 'Nothing contacted. Against an environment: -EnvironmentUrl <url> (dry run), then -Apply with the owner''s go.'
    return
}

# --------------------------------------------------------------- environment --
if (-not $EnvironmentUrl) { throw 'Give -EnvironmentUrl https://<org>.crm4.dynamics.com, or -Offline.' }
$EnvironmentUrl = $EnvironmentUrl.TrimEnd('/')
$environmentHost = ([Uri]$EnvironmentUrl).Host
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'The Azure CLI (az) is needed for the token: https://learn.microsoft.com/cli/azure/install-azure-cli' }

$azArgs = @('--resource', $EnvironmentUrl, '--output', 'json')
if ($Subscription) { $azArgs += @('--subscription', $Subscription) }
$tokenJson = & az account get-access-token @azArgs 2>$null
if ($LASTEXITCODE -ne 0 -or -not $tokenJson) { throw "No token for $EnvironmentUrl from the Azure CLI's current account. Sign in as the right person (az login), then run again; this script does not switch accounts." }
$token = ($tokenJson | ConvertFrom-Json).accessToken
$showArgs = @('account', 'show', '--output', 'json')
if ($Subscription) { $showArgs += @('--subscription', $Subscription) }
$account = (& az @showArgs | ConvertFrom-Json)

$headers = @{
    Authorization      = "Bearer $token"
    'OData-MaxVersion' = '4.0'
    'OData-Version'    = '4.0'
    Accept             = 'application/json'
    'User-Agent'       = 'register-plugins'
}

function Invoke-Dataverse([string] $Method = 'GET', [string] $Path, $Body, [switch] $InSolution)
{
    $request = @{ Method = $Method; Uri = "$EnvironmentUrl/api/data/v9.2/$Path"; Headers = $headers.Clone() }
    if ($InSolution) { $request.Headers['MSCRM.SolutionUniqueName'] = $SolutionName }
    if ($null -ne $Body)
    {
        $request.Body = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 20 -Compress))
        $request.ContentType = 'application/json; charset=utf-8'
    }
    if ($Method -eq 'POST') { $request.Headers['Prefer'] = 'return=representation' }
    try { return Invoke-RestMethod @request }
    catch
    {
        $detail = $_.ErrorDetails.Message
        throw "$Method $Path failed: $(if ($detail) { $detail } else { $_.Exception.Message })"
    }
}

function Get-Rows([string] $Path) { return @((Invoke-Dataverse -Path $Path).value) }

$who = Invoke-Dataverse -Path 'WhoAmI'
Write-Host "Environment: $environmentHost (organization $($who.OrganizationId))"
Write-Host "Signed in:   $($account.user.name) (tenant $($account.tenantId)), Dataverse user $($who.UserId)"

# ---------------------------------------------------------------------- read --
$package = Get-Rows "pluginpackages?`$select=pluginpackageid,uniquename,version&`$filter=uniquename eq '$($manifestData.package.uniqueName)'" | Select-Object -First 1
$assemblyRow = $null
$types = @{}
if ($package)
{
    $assemblyRow = Get-Rows "pluginassemblies?`$select=pluginassemblyid,name,version&`$filter=_packageid_value eq $($package.pluginpackageid)" | Where-Object { $_.name -eq $manifestData.package.assembly } | Select-Object -First 1
    if ($assemblyRow)
    {
        foreach ($t in Get-Rows "plugintypes?`$select=plugintypeid,typename&`$filter=_pluginassemblyid_value eq $($assemblyRow.pluginassemblyid)") { $types[$t.typename] = $t.plugintypeid }
    }
}

$existingSteps = @()
foreach ($typeName in $types.Keys)
{
    $existingSteps += Get-Rows ("sdkmessageprocessingsteps?`$select=sdkmessageprocessingstepid,name,stage,mode,rank,filteringattributes,configuration,description,asyncautodelete,_sdkmessageid_value,_sdkmessagefilterid_value,_eventhandler_value" +
        "&`$filter=_eventhandler_value eq $($types[$typeName])")
}

$messageIds = @{}
foreach ($name in @($manifestData.steps | ForEach-Object { $_.message } | Select-Object -Unique))
{
    $row = Get-Rows "sdkmessages?`$select=sdkmessageid,name&`$filter=name eq '$name'" | Select-Object -First 1
    if (-not $row) { throw "Message '$name' does not exist in this environment." }
    $messageIds[$name] = $row.sdkmessageid
}
$filterIds = @{}
foreach ($step in $manifestData.steps)
{
    $key = "$($step.message)|$($step.table)"
    if ($filterIds.ContainsKey($key) -or $step.table -eq 'none') { continue }
    $row = Get-Rows "sdkmessagefilters?`$select=sdkmessagefilterid&`$filter=_sdkmessageid_value eq $($messageIds[$step.message]) and primaryobjecttypecode eq '$($step.table)'" | Select-Object -First 1
    if (-not $row) { throw "No $($step.message) filter for table '$($step.table)'. Is the table there, and does it support the message?" }
    $filterIds[$key] = $row.sdkmessagefilterid
}

# ---------------------------------------------------------------------- plan --
$plan = [System.Collections.Generic.List[object]]::new()
# Each action carries its own data: the script blocks run later, after the loops have moved on.
function Add-Action([string] $Kind, [string] $What, [scriptblock] $Do, [hashtable] $Data = @{}) { $plan.Add([pscustomobject]@{ Kind = $Kind; What = $What; Do = $Do; Data = $Data }) }

$content = [Convert]::ToBase64String($packageBytes)
if (-not $package)
{
    Add-Action 'create' "package $($manifestData.package.uniqueName)" {
        $created = Invoke-Dataverse -Method POST -Path 'pluginpackages' -InSolution -Body @{ name = $manifestData.package.assembly; uniquename = $manifestData.package.uniqueName; version = '1.0.0'; content = $content }
        $script:package = $created
    }
}
else
{
    Add-Action 'update' "package $($manifestData.package.uniqueName): content" {
        Invoke-Dataverse -Method PATCH -Path "pluginpackages($($package.pluginpackageid))" -Body @{ content = $content } | Out-Null
    }
}

$neededTypes = @($manifestData.steps | ForEach-Object { $_.plugin }) + @(Get-Optional $manifestData 'customApis' @() | ForEach-Object { $_.plugin }) | Select-Object -Unique
Add-Action 'check' "plug-in types: $($neededTypes.Count) ($((@($neededTypes | Where-Object { -not $types.ContainsKey($_) })).Count) not registered yet)" {
    $deadline = (Get-Date).AddSeconds(90)
    do
    {
        $script:assemblyRow = Get-Rows "pluginassemblies?`$select=pluginassemblyid,name&`$filter=_packageid_value eq $($script:package.pluginpackageid)" | Where-Object { $_.name -eq $manifestData.package.assembly } | Select-Object -First 1
        if (-not $script:assemblyRow) { Start-Sleep -Seconds 5 }
    } while (-not $script:assemblyRow -and (Get-Date) -lt $deadline)
    if (-not $script:assemblyRow) { throw "The package has no assembly named $($manifestData.package.assembly) after 90 seconds." }
    $script:types = @{}
    foreach ($t in Get-Rows "plugintypes?`$select=plugintypeid,typename&`$filter=_pluginassemblyid_value eq $($script:assemblyRow.pluginassemblyid)") { $script:types[$t.typename] = $t.plugintypeid }
    foreach ($typeName in $neededTypes | Where-Object { -not $script:types.ContainsKey($_) })
    {
        $created = Invoke-Dataverse -Method POST -Path 'plugintypes' -InSolution -Body @{
            typename = $typeName; name = $typeName; friendlyname = $typeName.Split('.')[-1]
            'pluginassemblyid@odata.bind' = "/pluginassemblies($($script:assemblyRow.pluginassemblyid))"
        }
        $script:types[$typeName] = $created.plugintypeid
        Write-Host "    type $typeName registered"
    }
}

function New-StepBody($step)
{
    $body = [ordered]@{
        name = $step.name; description = (Get-Optional $step 'description' ''); stage = $stages[$step.stage]; mode = $modes[$step.mode]; rank = [int]$step.rank
        supporteddeployment = 0; invocationsource = 0; asyncautodelete = [bool](Get-Optional $step 'asyncAutoDelete' $false)
        filteringattributes = $(if (Get-Optional $step 'filteringAttributes') { ($step.filteringAttributes -join ',') } else { $null })
        configuration = (Get-Optional $step 'unsecureConfiguration')
        'eventhandler_plugintype@odata.bind' = "/plugintypes($($script:types[$step.plugin]))"
        'sdkmessageid@odata.bind' = "/sdkmessages($($messageIds[$step.message]))"
    }
    if ($step.table -ne 'none') { $body['sdkmessagefilterid@odata.bind'] = "/sdkmessagefilters($($filterIds["$($step.message)|$($step.table)"]))" }
    return $body
}

function Get-ImageKey($images, [string] $nameProperty, [string] $typeProperty, [string] $columnsProperty)
{
    # One comparable line per image: name, type, sorted columns.
    return (@($images | Where-Object { $_ } | ForEach-Object {
        $type = $_.$typeProperty
        if ($type -is [string]) { $type = $imageTypes[$type] }
        "$($_.$nameProperty)|$type|$((@($_.$columnsProperty -split ',' | ForEach-Object { "$_".Trim() }) | Sort-Object) -join ',')"
    }) | Sort-Object) -join ';'
}

function Test-ImagesDiffer($step, [string] $stepId)
{
    $current = @(Get-Rows "sdkmessageprocessingstepimages?`$select=entityalias,imagetype,attributes&`$filter=_sdkmessageprocessingstepid_value eq $stepId")
    $wanted = @(Get-Optional $step 'images' @()) | ForEach-Object { [pscustomobject]@{ name = $_.name; type = $_.type; attributes = (@($_.attributes) -join ',') } }
    return (Get-ImageKey $current 'entityalias' 'imagetype' 'attributes') -ne (Get-ImageKey $wanted 'name' 'type' 'attributes')
}

function Set-Images($step, [string] $stepId)
{
    $current = @(Get-Rows "sdkmessageprocessingstepimages?`$select=sdkmessageprocessingstepimageid,entityalias,imagetype,attributes&`$filter=_sdkmessageprocessingstepid_value eq $stepId")
    foreach ($image in @(Get-Optional $step 'images' @()))
    {
        $columns = (@($image.attributes) | Sort-Object) -join ','
        $match = $current | Where-Object { $_.entityalias -eq $image.name } | Select-Object -First 1
        if ($match -and $match.imagetype -eq $imageTypes[$image.type] -and ((@($match.attributes -split ',') | Sort-Object) -join ',') -eq $columns) { continue }
        if ($match) { Invoke-Dataverse -Method DELETE -Path "sdkmessageprocessingstepimages($($match.sdkmessageprocessingstepimageid))" | Out-Null }
        Invoke-Dataverse -Method POST -Path 'sdkmessageprocessingstepimages' -InSolution -Body @{
            name = $image.name; entityalias = $image.name; imagetype = $imageTypes[$image.type]; attributes = $columns
            messagepropertyname = (Get-MessagePropertyName $step.message)
            'sdkmessageprocessingstepid@odata.bind' = "/sdkmessageprocessingsteps($stepId)"
        } | Out-Null
        Write-Host "    image $($image.name) ($($image.type)) set"
    }
    foreach ($extra in $current | Where-Object { $_.entityalias -notin @(@(Get-Optional $step 'images' @()) | ForEach-Object { $_.name }) })
    {
        Invoke-Dataverse -Method DELETE -Path "sdkmessageprocessingstepimages($($extra.sdkmessageprocessingstepimageid))" | Out-Null
        Write-Host "    image $($extra.entityalias) removed"
    }
}

foreach ($step in $manifestData.steps)
{
    $existing = $existingSteps | Where-Object { $_.name -eq $step.name } | Select-Object -First 1
    if (-not $existing)
    {
        Add-Action 'create' "step $($step.name)" {
            param($d)
            $created = Invoke-Dataverse -Method POST -Path 'sdkmessageprocessingsteps' -InSolution -Body (New-StepBody $d.Step)
            Set-Images $d.Step $created.sdkmessageprocessingstepid
        } @{ Step = $step }
        continue
    }

    $sameShape = $existing._eventhandler_value -eq $types[$step.plugin] -and
                 $existing._sdkmessageid_value -eq $messageIds[$step.message] -and
                 $existing.stage -eq $stages[$step.stage] -and
                 ($step.table -eq 'none' -or $existing._sdkmessagefilterid_value -eq $filterIds["$($step.message)|$($step.table)"])
    $id = $existing.sdkmessageprocessingstepid
    if (-not $sameShape)
    {
        Add-Action 'replace' "step $($step.name) (class, message, table or stage changed)" {
            param($d)
            Invoke-Dataverse -Method DELETE -Path "sdkmessageprocessingsteps($($d.Id))" | Out-Null
            $created = Invoke-Dataverse -Method POST -Path 'sdkmessageprocessingsteps' -InSolution -Body (New-StepBody $d.Step)
            Set-Images $d.Step $created.sdkmessageprocessingstepid
        } @{ Step = $step; Id = $id }
        continue
    }

    $wanted = @{
        mode = $modes[$step.mode]; rank = [int]$step.rank; description = (Get-Optional $step 'description' '')
        filteringattributes = $(if (Get-Optional $step 'filteringAttributes') { ($step.filteringAttributes -join ',') } else { $null })
        configuration = (Get-Optional $step 'unsecureConfiguration'); asyncautodelete = [bool](Get-Optional $step 'asyncAutoDelete' $false)
    }
    $changes = @{}
    foreach ($field in $wanted.Keys)
    {
        $have = $existing.$field
        if ($field -eq 'filteringattributes' -and $have) { $have = (($have -split ',') | ForEach-Object { $_.Trim() }) -join ',' }
        if ([string]$have -ne [string]$wanted[$field]) { $changes[$field] = $wanted[$field] }
    }
    $imagesDiffer = Test-ImagesDiffer $step $id
    if ($changes.Count -gt 0 -or $imagesDiffer)
    {
        $what = @($changes.Keys) + @(if ($imagesDiffer) { 'images' })
        Add-Action 'update' "step $($step.name): $($what -join ', ')" {
            param($d)
            if ($d.Patch.Count -gt 0) { Invoke-Dataverse -Method PATCH -Path "sdkmessageprocessingsteps($($d.Id))" -Body $d.Patch | Out-Null }
            Set-Images $d.Step $d.Id
        } @{ Step = $step; Id = $id; Patch = $changes }
    }
    else
    {
        Write-Verbose "step $($step.name): unchanged"
    }
}

foreach ($orphan in $existingSteps | Where-Object { $_.name -notin @($manifestData.steps | ForEach-Object { $_.name }) })
{
    if ($Prune) { Add-Action 'delete' "step $($orphan.name) (not in the manifest)" { param($d) Invoke-Dataverse -Method DELETE -Path "sdkmessageprocessingsteps($($d.Id))" | Out-Null } @{ Id = $orphan.sdkmessageprocessingstepid } }
    else { Write-Warning "Step '$($orphan.name)' is on this package's types but not in the manifest. Left alone; -Prune deletes it." }
}

foreach ($api in @(Get-Optional $manifestData 'customApis' @()))
{
    $current = Get-Rows ("customapis?`$select=customapiid,uniquename,displayname,description,bindingtype,isfunction,_plugintypeid_value" +
        "&`$filter=uniquename eq '$($api.uniqueName)'&`$expand=CustomAPIRequestParameters(`$select=uniquename,type,isoptional),CustomAPIResponseProperties(`$select=uniquename,type)") | Select-Object -First 1
    if (-not $current)
    {
        Add-Action 'create' "custom API $($api.uniqueName)" {
            param($d)
            $a = $d.Api
            $body = [ordered]@{
                uniquename = $a.uniqueName; name = $a.uniqueName; displayname = $a.displayName; description = (Get-Optional $a 'description' $a.displayName)
                bindingtype = $bindingTypes[$a.bindingType]; boundentitylogicalname = (Get-Optional $a 'boundTable')
                isfunction = [bool]$a.isFunction; isprivate = [bool](Get-Optional $a 'isPrivate' $false)
                allowedcustomprocessingsteptype = $processingStepTypes[[string](Get-Optional $a 'allowedCustomProcessingStepType' 'None')]
                executeprivilegename = (Get-Optional $a 'executePrivilegeName')
                'PluginTypeId@odata.bind' = "/plugintypes($($script:types[$a.plugin]))"
                CustomAPIRequestParameters = @(@($a.requestParameters) | Where-Object { $_ } | ForEach-Object {
                    @{ uniquename = $_.uniqueName; name = "$($a.uniqueName).$($_.uniqueName)"; displayname = $_.displayName; description = (Get-Optional $_ 'description' $_.displayName); type = $parameterTypes[$_.type]; isoptional = [bool](Get-Optional $_ 'isOptional' $false); logicalentityname = (Get-Optional $_ 'table') } })
                CustomAPIResponseProperties = @(@($a.responseProperties) | Where-Object { $_ } | ForEach-Object {
                    @{ uniquename = $_.uniqueName; name = "$($a.uniqueName).$($_.uniqueName)"; displayname = $_.displayName; description = (Get-Optional $_ 'description' $_.displayName); type = $parameterTypes[$_.type]; logicalentityname = (Get-Optional $_ 'table') } })
            }
            Invoke-Dataverse -Method POST -Path 'customapis' -InSolution -Body $body | Out-Null
        } @{ Api = $api }
        continue
    }

    $apiId = $current.customapiid
    if ($current.bindingtype -ne $bindingTypes[$api.bindingType] -or [bool]$current.isfunction -ne [bool]$api.isFunction)
    {
        Write-Warning "Custom API '$($api.uniqueName)': binding or function/action differs from the manifest. That cannot change in place; it needs a new API (and its callers moved). Not changed."
    }
    foreach ($p in @($api.requestParameters) | Where-Object { $_ })
    {
        $have = @($current.CustomAPIRequestParameters) | Where-Object { $_.uniquename -eq $p.uniqueName } | Select-Object -First 1
        if (-not $have)
        {
            Add-Action 'create' "custom API $($api.uniqueName): request parameter $($p.uniqueName)" {
                param($d)
                $param = $d.Item
                Invoke-Dataverse -Method POST -Path 'customapirequestparameters' -InSolution -Body @{
                    uniquename = $param.uniqueName; name = "$($d.ApiName).$($param.uniqueName)"; displayname = $param.displayName; description = (Get-Optional $param 'description' $param.displayName)
                    type = $parameterTypes[$param.type]; isoptional = [bool](Get-Optional $param 'isOptional' $false); logicalentityname = (Get-Optional $param 'table')
                    'CustomAPIId@odata.bind' = "/customapis($($d.ApiId))"
                } | Out-Null
            } @{ Item = $p; ApiId = $apiId; ApiName = $api.uniqueName }
        }
        elseif ($have.type -ne $parameterTypes[$p.type]) { Write-Warning "Custom API '$($api.uniqueName)': parameter '$($p.uniqueName)' has another type in the environment. Not changed." }
    }
    foreach ($p in @($api.responseProperties) | Where-Object { $_ })
    {
        $have = @($current.CustomAPIResponseProperties) | Where-Object { $_.uniquename -eq $p.uniqueName } | Select-Object -First 1
        if (-not $have)
        {
            Add-Action 'create' "custom API $($api.uniqueName): response property $($p.uniqueName)" {
                param($d)
                $prop = $d.Item
                Invoke-Dataverse -Method POST -Path 'customapiresponseproperties' -InSolution -Body @{
                    uniquename = $prop.uniqueName; name = "$($d.ApiName).$($prop.uniqueName)"; displayname = $prop.displayName; description = (Get-Optional $prop 'description' $prop.displayName)
                    type = $parameterTypes[$prop.type]; logicalentityname = (Get-Optional $prop 'table')
                    'CustomAPIId@odata.bind' = "/customapis($($d.ApiId))"
                } | Out-Null
            } @{ Item = $p; ApiId = $apiId; ApiName = $api.uniqueName }
        }
        elseif ($have.type -ne $parameterTypes[$p.type]) { Write-Warning "Custom API '$($api.uniqueName)': response property '$($p.uniqueName)' has another type in the environment. Not changed." }
    }
    $apiChanges = @{}
    if ($current.displayname -ne $api.displayName) { $apiChanges.displayname = $api.displayName }
    if ([string]$current.description -ne [string](Get-Optional $api 'description' $api.displayName)) { $apiChanges.description = (Get-Optional $api 'description' $api.displayName) }
    $wantedType = $types[$api.plugin]
    if ($current._plugintypeid_value -ne $wantedType) { $apiChanges['PluginTypeId@odata.bind'] = 'resolved at apply time' }
    if ($apiChanges.Count -gt 0)
    {
        Add-Action 'update' "custom API $($api.uniqueName): $($apiChanges.Keys -join ', ')" {
            param($d)
            $body = $d.Changes
            if ($body.ContainsKey('PluginTypeId@odata.bind')) { $body['PluginTypeId@odata.bind'] = "/plugintypes($($script:types[$d.Plugin]))" }
            Invoke-Dataverse -Method PATCH -Path "customapis($($d.Id))" -Body $body | Out-Null
        } @{ Changes = $apiChanges; Id = $apiId; Plugin = $api.plugin }
    }
}

# --------------------------------------------------------------- show, apply --
Write-Host ''
Write-Host "Plan for $environmentHost (solution $SolutionName):" -ForegroundColor Cyan
foreach ($action in $plan) { Write-Host ("  {0,-8} {1}" -f $action.Kind, $action.What) }
$changing = @($plan | Where-Object { $_.Kind -ne 'check' }).Count

if (-not $Apply)
{
    Write-Host ''
    Write-Host "Dry run: nothing changed. $changing change(s) planned. With the owner's go for $environmentHost, run again with -Apply."
    return
}

$typed = $ConfirmEnvironment
if (-not $typed)
{
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { throw "Not applied: pass -ConfirmEnvironment $environmentHost once the owner has approved this environment." }
    $typed = Read-Host "Type the environment host ($environmentHost) to apply $changing change(s) as $($account.user.name)"
}
if ($typed.Trim() -ne $environmentHost) { throw "Not applied: '$typed' is not $environmentHost." }

foreach ($action in $plan)
{
    Write-Host ("{0,-8} {1}" -f $action.Kind, $action.What) -ForegroundColor Green
    & $action.Do $action.Data
}
Write-Host ''
Write-Host "Done: $environmentHost matches the manifest. Check the steps in the solution ($SolutionName) and run a smoke test."
