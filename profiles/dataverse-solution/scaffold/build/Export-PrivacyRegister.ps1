<#
.SYNOPSIS
    Writes the privacy register (record of processing activities, GDPR article 30) from
    build/contracts/privacy.json and schema.json, as Markdown or CSV. Offline.

.DESCRIPTION
    One section per purpose (legal basis, data subjects, recipients, retention, transfers) and
    one table per Dataverse table with every column, its category of personal data and its
    label in the chosen language. The controller and DPO placeholders stay visible until a
    deployment fills them: each customer is its own controller.

    Never connects to an environment. Run in the quality gate (it fails on a contract it cannot
    read) and for every release; hand the file to the privacy officer.

.PARAMETER Out
    The file to write: .md or .csv. Default out/privacy-register.md.

.PARAMETER Lcid
    Language of the table and column names. Default: the base language.

.EXAMPLE
    ./build/Export-PrivacyRegister.ps1

.EXAMPLE
    ./build/Export-PrivacyRegister.ps1 -Out out/privacy-register.csv -Lcid 1043
#>
[CmdletBinding()]
param(
    [string]$Out = 'out/privacy-register.md',
    [int]$Lcid
)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Get-RepoRoot
$schema = Get-Contract 'schema'
$privacy = Get-Contract 'privacy'
if (-not $Lcid) { $Lcid = [int]$schema.languages.base }
function Get-Text { param($Text) if ($null -eq $Text) { return '' }; $p = $Text.PSObject.Properties["$Lcid"]; if ($p) { return [string]$p.Value }; return '' }

$purposes = @{}
foreach ($p in $privacy.purposes) { $purposes[$p.id] = $p }

$rows = foreach ($t in $schema.tables) {
    $entry = $privacy.tables.PSObject.Properties[$t.logicalName]
    if (-not $entry) { throw "privacy.json has no entry for table $($t.logicalName). Add it (npm test says the same)." }
    $entry = $entry.Value
    $columns = @([pscustomobject]@{ logicalName = $t.primaryName.logicalName; displayName = $t.primaryName.displayName }) + @($t.columns)
    foreach ($c in $columns) {
        $info = $entry.columns.PSObject.Properties[$c.logicalName]
        if (-not $info) { throw "privacy.json has no entry for column $($t.logicalName).$($c.logicalName)." }
        [pscustomobject]@{
            Table       = Get-Text $t.displayName
            TableName   = $t.logicalName
            Column      = Get-Text $c.displayName
            ColumnName  = $c.logicalName
            Category    = $info.Value.category
            Purposes    = (@($entry.purposes) -join '; ')
            Erasure     = $entry.erasure
            Note        = $(if ($info.Value.PSObject.Properties['note']) { $info.Value.note } else { '' })
        }
    }
}

$path = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null

if ($path -like '*.csv') {
    $rows | Export-Csv -Path $path -NoTypeInformation -Encoding utf8NoBOM
}
else {
    $md = [System.Text.StringBuilder]::new()
    [void]$md.AppendLine('# Privacy register (record of processing activities)')
    [void]$md.AppendLine('')
    [void]$md.AppendLine("Generated from build/contracts/privacy.json on $((Get-Date).ToString('yyyy-MM-dd')). Edit the contract, not this file.")
    [void]$md.AppendLine('')
    [void]$md.AppendLine("| Controller | $($privacy.controller) |")
    [void]$md.AppendLine('| --- | --- |')
    [void]$md.AppendLine("| Data protection officer | $($privacy.dataProtectionOfficer) |")
    [void]$md.AppendLine('')
    [void]$md.AppendLine('## Purposes')
    foreach ($p in $privacy.purposes) {
        [void]$md.AppendLine('')
        [void]$md.AppendLine("### $($p.name)")
        [void]$md.AppendLine('')
        [void]$md.AppendLine($p.description)
        [void]$md.AppendLine('')
        [void]$md.AppendLine('| | |')
        [void]$md.AppendLine('| --- | --- |')
        [void]$md.AppendLine("| Legal basis | $($p.legalBasis)$(if ($p.PSObject.Properties['legalBasisNote']) { " ($($p.legalBasisNote))" }) |")
        [void]$md.AppendLine("| Data subjects | $(@($p.dataSubjects) -join ', ') |")
        [void]$md.AppendLine("| Recipients | $(@($p.recipients) -join ', ') |")
        [void]$md.AppendLine("| Retention | $($p.retention) $($p.retentionTrigger) |")
        [void]$md.AppendLine("| Transfers outside the region | $($p.transfersOutsideRegion) |")
    }
    [void]$md.AppendLine('')
    [void]$md.AppendLine('## Tables and columns')
    foreach ($group in ($rows | Group-Object TableName)) {
        $first = $group.Group[0]
        [void]$md.AppendLine('')
        [void]$md.AppendLine("### $($first.Table) (``$($first.TableName)``)")
        [void]$md.AppendLine('')
        [void]$md.AppendLine("Purposes: $($first.Purposes). Erasure: $($first.Erasure).")
        [void]$md.AppendLine('')
        [void]$md.AppendLine('| Column | Name | Category | Note |')
        [void]$md.AppendLine('| --- | --- | --- | --- |')
        foreach ($r in $group.Group) { [void]$md.AppendLine("| $($r.Column) | ``$($r.ColumnName)`` | $($r.Category) | $($r.Note) |") }
    }
    [System.IO.File]::WriteAllText($path, $md.ToString(), [System.Text.UTF8Encoding]::new($false))
}
Write-Ok "privacy register written to $path ($(@($rows).Count) columns, $(@($privacy.purposes).Count) purpose(s))"
