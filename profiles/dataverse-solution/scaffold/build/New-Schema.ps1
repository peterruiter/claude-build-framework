<#
.SYNOPSIS
    Applies build/contracts/schema.json to a DEVELOPMENT environment through the Web API:
    publisher, solutions, global choices, tables, columns, lookups, environment variables and
    connection references. Additive only.

.DESCRIPTION
    Three modes, safest first:

    - No -Environment (default): prints the plan from the contract. Touches nothing, needs no
      sign-in. This is what the quality gate runs.
    - -Environment dev: signs in (Azure CLI), reads the environment and prints what is there and
      what would be created. Writes nothing.
    - -Environment dev -Apply: the same, then creates what is missing, after the host name is
      typed back. Only environments of kind development: test and production get the schema
      from the managed solution, never from this script.

    What it never does: delete or retype a column, rename a schema name, overwrite labels of an
    existing component (a translator may have improved them; use the translation export/import
    for that), or add anything without the solution header (every component lands in its
    solution from the start).

    Lessons built in: metadata created a second ago is not readable yet (it polls); a lookup is
    created with an explicit cascade (RemoveLink for delete and archive) so it never becomes a
    second parental relationship; labels go in every LCID of languages.lcids, and the script
    stops if a language is not provisioned in the environment.

    After -Apply: Export-Solution.ps1, then Build-Solution.ps1 -RoundTrip and npm test.

.PARAMETER Environment
    Id in environments.json. Without it, the offline plan.

.PARAMETER Apply
    Create what is missing. Without it, nothing is written.

.PARAMETER ConfirmUrl
    Non-interactive confirmation: the exact environment URL.

.EXAMPLE
    ./build/New-Schema.ps1

.EXAMPLE
    ./build/New-Schema.ps1 -Environment dev

.EXAMPLE
    ./build/New-Schema.ps1 -Environment dev -Apply
#>
[CmdletBinding()]
param(
    [string]$Environment,
    [switch]$Apply,
    [string]$ConfirmUrl
)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$schema = Get-Contract 'schema'
$api = '/api/data/v9.2'
function Has { param($Object, [string]$Name) return $null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name] }
function Get-Text { param($Text, [int]$Lcid) $p = $Text.PSObject.Properties["$Lcid"]; if ($p) { return [string]$p.Value } return '' }
$base = [int]$schema.languages.base

# --- offline plan ------------------------------------------------------------------------------
Write-Step "Schema from build/contracts/schema.json (publisher $($schema.publisher.uniqueName), prefix $($schema.publisher.prefix))"
Write-Host "    languages: $($schema.languages.lcids -join ', ') (base $base)"
foreach ($s in $schema.solutions) { Write-Host "    solution  $($s.uniqueName) ($($s.layer))" }
foreach ($c in @($schema.globalChoices)) { Write-Host "    choice    $($c.name) ($(@($c.options).Count) options)" }
foreach ($t in $schema.tables) {
    Write-Host "    table     $($t.schemaName) '$(Get-Text $t.displayName $base)' in $($t.solution)"
    Write-Host "      column  $($t.primaryName.schemaName) (primary name)"
    foreach ($col in @($t.columns)) { Write-Host "      column  $($col.schemaName) ($($col.type))" }
}
foreach ($v in @($schema.environmentVariables)) { Write-Host "    env var   $($v.schemaName) ($($v.type))" }
foreach ($r in @($schema.connectionReferences)) { Write-Host "    conn ref  $($r.logicalName)" }
if (-not $Environment) {
    Write-Host ''
    Write-Host 'Offline plan only. Next: -Environment dev (read-only comparison), then -Environment dev -Apply.' -ForegroundColor Cyan
    return
}

# --- connect -----------------------------------------------------------------------------------
$target = Get-EnvironmentConfig -Id $Environment
if ($target.kind -ne 'development') { throw "New-Schema writes to development only; '$Environment' is $($target.kind). Downstream environments get the schema from the managed solution." }
$account = Get-AzAccount -Environment $target
Confirm-Environment -Environment $target -Account $account -Action $(if ($Apply) { 'CREATE missing schema in' } else { 'compare the schema with' }) -Write:$Apply -ConfirmUrl $ConfirmUrl
Connect-Dataverse -Environment $target

$provisioned = @((Invoke-Dataverse -Path "$api/RetrieveProvisionedLanguages()").RetrieveProvisionedLanguages)
$missingLanguages = @($schema.languages.lcids | Where-Object { $provisioned -notcontains $_ })
if ($missingLanguages.Count -gt 0) {
    throw "Languages $($missingLanguages -join ', ') are not enabled in $($target.name) (enabled: $($provisioned -join ', ')). Enable them in the admin center (Settings, Languages) first; it takes minutes per language."
}

$script:toCreate = 0
$script:created = 0
function Invoke-Create {
    param([string]$What, [scriptblock]$Action)
    $script:toCreate++
    if (-not $Apply) { Write-Host "    [new]  $What (not created: no -Apply)" -ForegroundColor Yellow; return }
    & $Action
    $script:created++
    Write-Ok "created $What"
}
function Wait-Exists {
    # Metadata just created is not readable for a few seconds; reading it straight away is a 404.
    param([string]$Path)
    for ($i = 0; $i -lt 30; $i++) { if (Test-DataverseExists $Path) { return }; Start-Sleep -Seconds 2 }
    throw "Created, but still not readable after 60 seconds: $Path"
}
$requiredLevel = @{ none = 'None'; recommended = 'Recommended'; required = 'ApplicationRequired' }
function Get-RequiredLevel { param($Column) $r = if (Has $Column 'required') { $Column.required } else { 'none' }; return @{ Value = $requiredLevel[$r]; CanBeChanged = $true } }

# --- publisher and solutions -------------------------------------------------------------------
Write-Step 'Publisher and solutions'
$pub = $schema.publisher
$existing = @((Invoke-Dataverse -Path "$api/publishers?`$select=publisherid,customizationprefix&`$filter=uniquename eq '$($pub.uniqueName)'").value)
$script:publisherId = $null
if ($existing.Count -gt 0) {
    if ($existing[0].customizationprefix -ne $pub.prefix) { throw "Publisher $($pub.uniqueName) exists with prefix '$($existing[0].customizationprefix)'; the contract says '$($pub.prefix)'. Stop and ask." }
    $script:publisherId = $existing[0].publisherid
    Write-Skip "publisher $($pub.uniqueName) exists"
}
else {
    Invoke-Create "publisher $($pub.uniqueName)" {
        $r = Invoke-Dataverse -Method POST -Path "$api/publishers" -Representation -Body @{ uniquename = $pub.uniqueName; friendlyname = $pub.friendlyName; customizationprefix = $pub.prefix; customizationoptionvalueprefix = $pub.optionValuePrefix }
        $script:publisherId = $r.publisherid
    }
}
$version = (Get-Content (Join-Path (Get-RepoRoot) 'VERSION') -Raw).Trim() + '.0'
foreach ($s in $schema.solutions) {
    $found = @((Invoke-Dataverse -Path "$api/solutions?`$select=solutionid,version&`$filter=uniquename eq '$($s.uniqueName)'").value)
    if ($found.Count -gt 0) { Write-Skip "solution $($s.uniqueName) $($found[0].version) exists"; continue }
    Invoke-Create "solution $($s.uniqueName) $version" {
        Invoke-Dataverse -Method POST -Path "$api/solutions" -Body @{ uniquename = $s.uniqueName; friendlyname = $s.uniqueName; version = $version; description = $s.description; 'publisherid@odata.bind' = "/publishers($($script:publisherId))" } | Out-Null
    }
}

# --- global choices ----------------------------------------------------------------------------
Write-Step 'Global choices'
$choiceIds = @{}
foreach ($c in @($schema.globalChoices)) {
    $path = "$api/GlobalOptionSetDefinitions(Name='$($c.name)')"
    if (Test-DataverseExists $path) {
        $current = Invoke-Dataverse -Path $path
        $choiceIds[$c.name] = $current.MetadataId
        $have = @($current.Options | ForEach-Object { $_.Value })
        Write-Skip "choice $($c.name) exists"
        foreach ($o in @($c.options | Where-Object { $have -notcontains $_.value })) {
            Invoke-Create "option $($o.value) in $($c.name)" {
                Invoke-Dataverse -Method POST -Path "$api/InsertOptionValue" -Body @{ OptionSetName = $c.name; Value = $o.value; Label = (New-Label $o.label); SolutionUniqueName = $c.solution } | Out-Null
            }
        }
        continue
    }
    Invoke-Create "choice $($c.name)" {
        Invoke-Dataverse -Method POST -Path "$api/GlobalOptionSetDefinitions" -SolutionName $c.solution -Body @{
            '@odata.type' = 'Microsoft.Dynamics.CRM.OptionSetMetadata'; Name = $c.name; IsGlobal = $true; OptionSetType = 'Picklist'
            DisplayName = (New-Label $c.displayName); Description = (New-Label $c.description)
            Options = @($c.options | ForEach-Object { @{ Value = $_.value; Label = (New-Label $_.label) } })
        } | Out-Null
        Wait-Exists $path
        $choiceIds[$c.name] = (Invoke-Dataverse -Path "$path`?`$select=MetadataId").MetadataId
    }
}

# --- tables and simple columns (lookups after, when every target exists) -----------------------
Write-Step 'Tables and columns'
$lookups = @()
foreach ($t in $schema.tables) {
    $tablePath = "$api/EntityDefinitions(LogicalName='$($t.logicalName)')"
    if (Test-DataverseExists "$tablePath`?`$select=MetadataId") { Write-Skip "table $($t.schemaName) exists" }
    else {
        Invoke-Create "table $($t.schemaName)" {
            Invoke-Dataverse -Method POST -Path "$api/EntityDefinitions" -SolutionName $t.solution -Body @{
                '@odata.type' = 'Microsoft.Dynamics.CRM.EntityMetadata'; SchemaName = $t.schemaName
                DisplayName = (New-Label $t.displayName); DisplayCollectionName = (New-Label $t.pluralName); Description = (New-Label $t.description)
                OwnershipType = $t.ownership; IsActivity = $false; HasActivities = $false; HasNotes = $false
                IsAuditEnabled = @{ Value = [bool]$t.audit; CanBeChanged = $true }
                Attributes = @(@{
                        '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'; SchemaName = $t.primaryName.schemaName; IsPrimaryName = $true
                        MaxLength = $t.primaryName.maxLength; FormatName = @{ Value = 'Text' }; RequiredLevel = @{ Value = 'ApplicationRequired'; CanBeChanged = $true }
                        DisplayName = (New-Label $t.primaryName.displayName); Description = (New-Label $t.primaryName.description)
                    })
            } | Out-Null
            Wait-Exists "$tablePath`?`$select=MetadataId"
        }
    }
    foreach ($col in @($t.columns)) {
        if ($col.type -eq 'lookup') { $lookups += [pscustomobject]@{ Table = $t; Column = $col }; continue }
        $colPath = "$tablePath/Attributes(LogicalName='$($col.logicalName)')"
        if ($Apply -or (Test-DataverseExists "$tablePath`?`$select=MetadataId")) {
            if (Test-DataverseExists "$colPath`?`$select=MetadataId,AttributeType") { Write-Skip "  $($col.schemaName) exists"; continue }
        }
        $body = @{
            SchemaName = $col.schemaName; DisplayName = (New-Label $col.displayName); Description = (New-Label $col.description)
            RequiredLevel = (Get-RequiredLevel $col); IsAuditEnabled = @{ Value = [bool]$col.audit; CanBeChanged = $true }
        }
        switch ($col.type) {
            'text' { $body['@odata.type'] = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'; $body.MaxLength = $col.maxLength; $body.FormatName = @{ Value = 'Text' } }
            'email' { $body['@odata.type'] = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'; $body.MaxLength = $col.maxLength; $body.FormatName = @{ Value = 'Email' } }
            'multiline' { $body['@odata.type'] = 'Microsoft.Dynamics.CRM.MemoAttributeMetadata'; $body.MaxLength = $col.maxLength; $body.Format = 'TextArea' }
            'date' { $body['@odata.type'] = 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata'; $body.Format = 'DateOnly'; $body.DateTimeBehavior = @{ Value = 'DateOnly' } }
            'datetime' { $body['@odata.type'] = 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata'; $body.Format = 'DateAndTime'; $body.DateTimeBehavior = @{ Value = 'UserLocal' } }
            'whole' { $body['@odata.type'] = 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata'; $body.Format = 'None'; $body.MinValue = $(if (Has $col 'min') { $col.min } else { 0 }); $body.MaxValue = $(if (Has $col 'max') { $col.max } else { 2147483647 }) }
            'yesno' {
                $body['@odata.type'] = 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata'
                $body.OptionSet = @{ '@odata.type' = 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata'; TrueOption = @{ Value = 1; Label = (New-Label $col.trueLabel) }; FalseOption = @{ Value = 0; Label = (New-Label $col.falseLabel) } }
            }
            'choice' {
                if (-not $choiceIds.ContainsKey($col.globalChoice) -and $Apply) { throw "Column $($col.schemaName) needs global choice $($col.globalChoice), which is not in this environment." }
                $body['@odata.type'] = 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata'
                $body['GlobalOptionSet@odata.bind'] = "/GlobalOptionSetDefinitions($($choiceIds[$col.globalChoice]))"
            }
            default { throw "Column $($col.schemaName): type '$($col.type)' is not supported by this script. Add it here, or create it in the maker portal and export." }
        }
        Invoke-Create "  $($col.schemaName) ($($col.type))" {
            Invoke-Dataverse -Method POST -Path "$tablePath/Attributes" -SolutionName $t.solution -Body $body | Out-Null
            Wait-Exists "$colPath`?`$select=MetadataId"
        }
    }
}

# --- lookups -----------------------------------------------------------------------------------
if ($lookups.Count -gt 0) { Write-Step 'Lookups' }
foreach ($l in $lookups) {
    $t = $l.Table; $col = $l.Column
    $colPath = "$api/EntityDefinitions(LogicalName='$($t.logicalName)')/Attributes(LogicalName='$($col.logicalName)')"
    if (Test-DataverseExists "$colPath`?`$select=MetadataId") { Write-Skip "  $($col.schemaName) exists"; continue }
    $relationship = "$($schema.publisher.prefix)_$($col.target)_$($t.logicalName)_$($col.logicalName)"
    Invoke-Create "  $($col.schemaName) -> $($col.target)" {
        Invoke-Dataverse -Method POST -Path "$api/RelationshipDefinitions" -SolutionName $t.solution -Body @{
            '@odata.type' = 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata'; SchemaName = $relationship
            ReferencedEntity = $col.target; ReferencingEntity = $t.logicalName
            CascadeConfiguration = @{ Assign = 'NoCascade'; Share = 'NoCascade'; Unshare = 'NoCascade'; Reparent = 'NoCascade'; Delete = 'RemoveLink'; Merge = 'NoCascade'; Archive = 'RemoveLink'; RollupView = 'NoCascade' }
            Lookup = @{
                '@odata.type' = 'Microsoft.Dynamics.CRM.LookupAttributeMetadata'; SchemaName = $col.schemaName
                DisplayName = (New-Label $col.displayName); Description = (New-Label $col.description); RequiredLevel = (Get-RequiredLevel $col)
            }
        } | Out-Null
        Wait-Exists "$colPath`?`$select=MetadataId"
    }
}

# --- environment variables and connection references -------------------------------------------
Write-Step 'Environment variables and connection references'
$envTypes = @{ String = 100000000; Number = 100000001; Boolean = 100000002; JSON = 100000003; DataSource = 100000004; Secret = 100000005 }
foreach ($v in @($schema.environmentVariables)) {
    $found = @((Invoke-Dataverse -Path "$api/environmentvariabledefinitions?`$select=schemaname&`$filter=schemaname eq '$($v.schemaName)'").value)
    if ($found.Count -gt 0) { Write-Skip "env var $($v.schemaName) exists"; continue }
    Invoke-Create "env var $($v.schemaName)" {
        $body = @{ schemaname = $v.schemaName; displayname = (Get-Text $v.displayName $base); type = $envTypes[$v.type]; isrequired = [bool]$v.required }
        if ($v.secret) { $body.secretstore = 0 }
        Invoke-Dataverse -Method POST -Path "$api/environmentvariabledefinitions" -SolutionName $v.solution -Body $body | Out-Null
    }
}
foreach ($r in @($schema.connectionReferences)) {
    $found = @((Invoke-Dataverse -Path "$api/connectionreferences?`$select=connectionreferencelogicalname&`$filter=connectionreferencelogicalname eq '$($r.logicalName)'").value)
    if ($found.Count -gt 0) { Write-Skip "connection reference $($r.logicalName) exists"; continue }
    Invoke-Create "connection reference $($r.logicalName)" {
        Invoke-Dataverse -Method POST -Path "$api/connectionreferences" -SolutionName $r.solution -Body @{ connectionreferencelogicalname = $r.logicalName; connectionreferencedisplayname = $r.logicalName; connectorid = $r.connectorId } | Out-Null
    }
}

# --- publish what changed ----------------------------------------------------------------------
if ($Apply -and $script:created -gt 0) {
    Write-Step 'Publish'
    $entities = ($schema.tables | ForEach-Object { "<entity>$($_.logicalName)</entity>" }) -join ''
    $choices = (@($schema.globalChoices) | ForEach-Object { "<optionset>$($_.name)</optionset>" }) -join ''
    Invoke-Dataverse -Method POST -Path "$api/PublishXml" -Body @{ ParameterXml = "<importexportxml><entities>$entities</entities><optionsets>$choices</optionsets></importexportxml>" } | Out-Null
    Write-Ok 'published the tables and choices of the contract'
}

Write-Host ''
if ($Apply) { Write-Host "Created $($script:created) of $($script:toCreate) missing component(s). Next: ./build/Export-Solution.ps1, ./build/Build-Solution.ps1 -RoundTrip, npm test." -ForegroundColor Cyan }
else { Write-Host "$($script:toCreate) component(s) missing. Run again with -Apply to create them." -ForegroundColor Cyan }
