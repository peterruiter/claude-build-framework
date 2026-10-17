<#
.SYNOPSIS
    Checks, offline, that every label the product owns exists in every configured language:
    in build/contracts/schema.json, in the unpacked solutions, and in RESX web resources.

.DESCRIPTION
    The languages are languages.lcids in schema.json (from the project's locales.json).

    1. schema.json: every displayName, pluralName, description and option label has a non-empty
       text per LCID, none longer than 500 characters (the translation import refuses longer).
    2. Unpacked solutions (solutions/*/src): for the product's own components (names that start
       with the publisher prefix, and the solution itself) every localized label element
       (LocalizedName, LocalizedCollectionName, displayname, Description, label) has one entry
       per LCID. Platform columns and empty descriptions are skipped. A gap here means the
       translation was never imported in development, or a label was added after the last
       translation round: export translations (solution, Translations, Export translations, or
       the ExportTranslation message), fill the column for the language, import, export the
       solution again.
    3. RESX web resources (any *.resx under solutions/): for a base file named <name>.<lcid>.resx
       every other LCID has its file with the same keys and no empty values.

    Sitemap titles and form labels that are not in the export are the usual leftovers: the
    sitemap's titles are set per language in the app designer, not by the translation export.

    Exit code 1 on any gap. Never connects to an environment.

.PARAMETER Lcid
    Check only these LCIDs (default: all configured).

.EXAMPLE
    ./build/Test-Translations.ps1
#>
[CmdletBinding()]
param([int[]]$Lcid)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Get-RepoRoot
$schema = Get-Contract 'schema'
$prefix = "$($schema.publisher.prefix)_"
$lcids = @(if ($Lcid) { $Lcid } else { $schema.languages.lcids | ForEach-Object { [int]$_ } })
$gaps = [System.Collections.Generic.List[string]]::new()

# --- 1. the contract ---------------------------------------------------------------------------
Write-Step "schema.json, languages $($lcids -join ', ')"
function Test-Text {
    param($Text, [string]$Where)
    if ($null -eq $Text) { $gaps.Add("$Where has no text at all"); return }
    foreach ($l in $lcids) {
        $p = $Text.PSObject.Properties["$l"]
        if (-not $p -or -not "$($p.Value)".Trim()) { $gaps.Add("$Where has no $l text") }
        elseif ("$($p.Value)".Length -gt 500) { $gaps.Add("$Where $l text is longer than 500 characters") }
    }
}
foreach ($c in @($schema.globalChoices)) {
    Test-Text $c.displayName "choice $($c.name)"
    foreach ($o in $c.options) { Test-Text $o.label "choice $($c.name) option $($o.value)" }
}
foreach ($t in $schema.tables) {
    foreach ($field in 'displayName', 'pluralName', 'description') { Test-Text $t.$field "table $($t.schemaName) $field" }
    Test-Text $t.primaryName.displayName "column $($t.primaryName.schemaName)"
    foreach ($col in @($t.columns)) {
        Test-Text $col.displayName "column $($col.schemaName)"
        Test-Text $col.description "column $($col.schemaName) description"
        if ($col.type -eq 'yesno') { Test-Text $col.trueLabel "column $($col.schemaName) yes"; Test-Text $col.falseLabel "column $($col.schemaName) no" }
    }
}
foreach ($v in @($schema.environmentVariables)) { Test-Text $v.displayName "environment variable $($v.schemaName)" }
$contractGaps = $gaps.Count
if ($contractGaps -eq 0) { Write-Ok 'every label in every language' }

# --- 2. unpacked solutions ---------------------------------------------------------------------
Write-Step 'Unpacked solutions'
$labelTags = @('LocalizedName', 'LocalizedCollectionName', 'displayname', 'Description', 'label')
$checked = 0
foreach ($s in $schema.solutions) {
    $folder = Join-Path $root $s.folder
    if (-not (Test-Path $folder)) { $gaps.Add("$($s.folder) does not exist"); continue }
    foreach ($file in Get-ChildItem -Path $folder -Recurse -File -Filter *.xml) {
        $relative = [System.IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
        [xml]$xml = [System.IO.File]::ReadAllText($file.FullName)
        # A group of sibling label elements = one localizable text.
        $parents = $xml.SelectNodes('//*[*[@languagecode]]')
        foreach ($parent in $parents) {
            $owner = $parent
            $name = $null
            while ($owner -and -not $name) {
                # The publisher's name is shared by every solution of the publisher and normally
                # kept in the base language only.
                if ($owner.LocalName -eq 'Publisher') { break }
                foreach ($attr in 'PhysicalName', 'Name', 'schemaname', 'connectionreferencelogicalname') {
                    if ($owner.Attributes -and $owner.Attributes[$attr]) { $name = $owner.Attributes[$attr].Value; break }
                }
                if (-not $name -and $owner.LocalName -eq 'SolutionManifest') { $name = $s.uniqueName }
                $owner = $owner.ParentNode
            }
            if (-not $name) { continue }
            # The product's own components: prefixed names (tables, custom columns, choices, their
            # status option sets, environment variables) and the solution. Platform columns of a
            # custom table get their labels from the language packs.
            $own = $name.ToLowerInvariant().StartsWith($prefix) -or $name -eq $s.uniqueName
            if (-not $own) { continue }
            $entries = @($parent.ChildNodes | Where-Object { $_.NodeType -eq 'Element' -and $labelTags -contains $_.LocalName -and $_.Attributes['languagecode'] })
            if ($entries.Count -eq 0) { continue }
            $texts = @{}
            foreach ($e in $entries) { $texts[[int]$e.Attributes['languagecode'].Value] = $e.Attributes['description'].Value }
            # An empty description in the base language is an empty description, not a gap.
            if (-not ($texts.Values | Where-Object { $_ })) { continue }
            $checked++
            foreach ($l in $lcids) {
                if (-not $texts.ContainsKey($l) -or -not $texts[$l]) { $gaps.Add("${relative}: $name $($parent.LocalName) has no $l label") }
            }
        }
    }
}
if ($gaps.Count -eq $contractGaps) { Write-Ok "$checked label group(s) complete" }

# --- 3. RESX web resources ---------------------------------------------------------------------
Write-Step 'RESX web resources'
$base = [int]$schema.languages.base
$resx = @(Get-ChildItem -Path (Join-Path $root 'solutions') -Recurse -File -Filter "*.$base.resx" -ErrorAction SilentlyContinue)
if ($resx.Count -eq 0) { Write-Skip 'no RESX web resources' }
foreach ($file in $resx) {
    [xml]$source = [System.IO.File]::ReadAllText($file.FullName)
    $keys = @($source.root.data | ForEach-Object { $_.name })
    foreach ($l in ($lcids | Where-Object { $_ -ne $base })) {
        $sibling = $file.FullName -replace "\.$base\.resx$", ".$l.resx"
        $relative = [System.IO.Path]::GetRelativePath($root, $sibling).Replace('\', '/')
        if (-not (Test-Path $sibling)) { $gaps.Add("$relative is missing"); continue }
        [xml]$other = [System.IO.File]::ReadAllText($sibling)
        $values = @{}
        foreach ($d in @($other.root.data)) { $values[$d.name] = [string]$d.value }
        foreach ($k in $keys) { if (-not $values.ContainsKey($k) -or -not $values[$k].Trim()) { $gaps.Add("$relative has no text for '$k'") } }
    }
}

Write-Host ''
if ($gaps.Count -gt 0) {
    foreach ($g in $gaps) { Write-Fail $g }
    Write-Host "$($gaps.Count) translation gap(s)." -ForegroundColor Red
    exit 1
}
Write-Host 'No translation gaps.' -ForegroundColor Green
