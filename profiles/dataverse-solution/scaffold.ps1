<#
.SYNOPSIS
    Creates a new Dataverse solution repository from this profile's scaffold: renames the
    sample (CaseApp, Contoso, contoso_) to the product, publisher and prefix, and writes every
    label of the sample solution and the contracts in each chosen language.

.DESCRIPTION
    1. Refuses a destination that exists and is not empty: it never overwrites a project.
    2. Copies scaffold/ to the destination.
    3. Maps -Languages to Dataverse LCIDs (the first is the base language: every environment of
       the product must be created with it). An unknown language stops the script with the
       list of known ones.
    4. Writes the labels: every localized label in the unpacked sample solution and every
       label object in build/contracts/schema.json gets one entry per LCID, in that language
       for English, Dutch and German, in English for any other language (listed at the end:
       translating them is the first task, Test-Translations.ps1 cannot tell English from a
       translation).
    5. Renames, in file contents and in file and folder names: CaseApp to -Name, Contoso to
       -Publisher, contoso_ / contoso to -Prefix, the option value prefix 75259 to one derived
       from the prefix.
    6. git init on main (nothing committed), when git is available.

    Never connects to an environment. Afterwards, in the destination: npm test,
    ./build/Build-Solution.ps1 -RoundTrip, ./build/Test-Translations.ps1.

.PARAMETER Name
    The product, PascalCase (Fabrikam). Becomes the solution prefix (FabrikamCore) and the
    product name in texts and URLs.

.PARAMETER Prefix
    The publisher's customization prefix: 2 to 8 lower-case letters and digits, starting with a
    letter, not "mscrm". It never changes once anything is released.

.PARAMETER Languages
    Language codes or cultures (en, en-GB, nl, de, fr-BE ...). The first is the base language.

.PARAMETER Publisher
    The publisher's unique name. Default: -Name.

.PARAMETER Destination
    Folder to create. Default: ./<name in lower case>.

.EXAMPLE
    ./profiles/dataverse-solution/scaffold.ps1 -Name Fabrikam -Prefix fab -Languages en,nl,de -Destination C:\src\fabrikam

.EXAMPLE
    ./profiles/dataverse-solution/scaffold.ps1 -Name Gemeentezaken -Prefix gz -Languages nl
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Z][A-Za-z0-9]{1,30}$')][string]$Name,
    [Parameter(Mandatory)][string]$Prefix,
    [Parameter(Mandatory)][string[]]$Languages,
    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_]{0,63}$')][string]$Publisher,
    [string]$Destination
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Prefix -cnotmatch '^[a-z][a-z0-9]{1,7}$' -or $Prefix.StartsWith('mscrm')) {
    throw "Prefix '$Prefix': 2 to 8 lower-case letters and digits, starting with a letter, not 'mscrm'."
}
if (-not $Publisher) { $Publisher = $Name }
$lower = $Name.ToLowerInvariant()
if (-not $Destination) { $Destination = Join-Path (Get-Location) $lower }
$Destination = [System.IO.Path]::GetFullPath($Destination)
if ((Test-Path $Destination) -and @(Get-ChildItem -Path $Destination -Force).Count -gt 0) {
    throw "$Destination exists and is not empty. Nothing was written; choose another -Destination."
}

# --- languages ---------------------------------------------------------------------------------
# Bare codes take the likely culture; give the culture when it matters (en-GB, pt-PT, fr-BE).
$culture = @{
    en = 'en-US'; nl = 'nl-NL'; de = 'de-DE'; fr = 'fr-FR'; es = 'es-ES'; it = 'it-IT'; pt = 'pt-BR'; pl = 'pl-PL'; sv = 'sv-SE'
    da = 'da-DK'; fi = 'fi-FI'; nb = 'nb-NO'; no = 'nb-NO'; cs = 'cs-CZ'; sk = 'sk-SK'; hu = 'hu-HU'; ro = 'ro-RO'; el = 'el-GR'
    et = 'et-EE'; lv = 'lv-LV'; lt = 'lt-LT'; sl = 'sl-SI'; hr = 'hr-HR'; bg = 'bg-BG'; tr = 'tr-TR'; uk = 'uk-UA'; ar = 'ar-SA'
    he = 'he-IL'; ja = 'ja-JP'; zh = 'zh-CN'; ko = 'ko-KR'
}
$lcidOf = [ordered]@{
    'en-US' = 1033; 'en-GB' = 2057; 'nl-NL' = 1043; 'nl-BE' = 2067; 'de-DE' = 1031; 'de-AT' = 3079; 'de-CH' = 2055; 'fr-FR' = 1036
    'fr-BE' = 2060; 'es-ES' = 3082; 'it-IT' = 1040; 'pt-PT' = 2070; 'pt-BR' = 1046; 'pl-PL' = 1045; 'sv-SE' = 1053; 'da-DK' = 1030
    'fi-FI' = 1035; 'nb-NO' = 1044; 'cs-CZ' = 1029; 'sk-SK' = 1051; 'hu-HU' = 1038; 'ro-RO' = 1048; 'el-GR' = 1032; 'et-EE' = 1061
    'lv-LV' = 1062; 'lt-LT' = 1063; 'sl-SI' = 1060; 'hr-HR' = 1050; 'bg-BG' = 1026; 'tr-TR' = 1055; 'uk-UA' = 1058; 'ar-SA' = 1025
    'he-IL' = 1037; 'ja-JP' = 1041; 'zh-CN' = 2052; 'ko-KR' = 1042
}
$targets = foreach ($code in ($Languages | ForEach-Object { $_ -split ',' } | Where-Object { $_.Trim() })) {
    $c = $code.Trim()
    $full = if ($culture.ContainsKey($c.ToLowerInvariant())) { $culture[$c.ToLowerInvariant()] } else { ($lcidOf.Keys | Where-Object { $_ -ieq $c } | Select-Object -First 1) }
    if (-not $full) { throw "Language '$c' is not in this script's table. Known cultures: $($lcidOf.Keys -join ', '). Add it (culture and LCID) to scaffold.ps1 and dataverse-lib.mjs, or choose a known one." }
    [pscustomobject]@{ Culture = $full; Lcid = $lcidOf[$full]; Language = $full.Split('-')[0] }
}
# Drop repeats, keep the order given: the first is the base language.
$seen = @{}
$targets = @($targets | Where-Object { if ($seen.ContainsKey($_.Lcid)) { $false } else { $seen[$_.Lcid] = $true; $true } })
$base = $targets[0]
$lcids = @($targets | ForEach-Object Lcid)

# --- sample label translations (English source; Dutch and German) ------------------------------
$dictionary = @{
    'Created By' = @{ nl = 'Gemaakt door'; de = 'Erstellt von' }
    'User who created the record.' = @{ nl = 'Gebruiker die het record heeft gemaakt.'; de = 'Benutzer, der den Datensatz erstellt hat.' }
    'Created On' = @{ nl = 'Gemaakt op'; de = 'Erstellt am' }
    'Date and time when the record was created.' = @{ nl = 'Datum en tijd waarop het record is gemaakt.'; de = 'Datum und Uhrzeit der Erstellung des Datensatzes.' }
    'Created By (Delegate)' = @{ nl = 'Gemaakt door (gemachtigde)'; de = 'Erstellt von (Delegierter)' }
    'Delegate user who created the record.' = @{ nl = 'Gemachtigde gebruiker die het record heeft gemaakt.'; de = 'Delegierter Benutzer, der den Datensatz erstellt hat.' }
    'Channel' = @{ nl = 'Kanaal'; de = 'Kanal' }
    'How the request reached us.' = @{ nl = 'Hoe het verzoek binnenkwam.'; de = 'Wie die Anfrage bei uns eingegangen ist.' }
    'How a request reached us.' = @{ nl = 'Hoe een verzoek binnenkwam.'; de = 'Wie eine Anfrage bei uns eingegangen ist.' }
    'Title' = @{ nl = 'Titel'; de = 'Titel' }
    'Short title of the request.' = @{ nl = 'Korte titel van het verzoek.'; de = 'Kurzer Titel der Anfrage.' }
    'Received on' = @{ nl = 'Ontvangen op'; de = 'Eingegangen am' }
    'Date the request was received.' = @{ nl = 'Datum waarop het verzoek is ontvangen.'; de = 'Datum, an dem die Anfrage eingegangen ist.' }
    'Request' = @{ nl = 'Verzoek'; de = 'Anfrage' }
    'Requests' = @{ nl = 'Verzoeken'; de = 'Anfragen' }
    'Unique identifier for entity instances' = @{ nl = 'Unieke id van het record'; de = 'Eindeutige ID des Datensatzes' }
    'Requester email' = @{ nl = 'E-mailadres aanvrager'; de = 'E-Mail-Adresse des Antragstellers' }
    'Email address the answer goes to.' = @{ nl = 'E-mailadres waar het antwoord naartoe gaat.'; de = 'E-Mail-Adresse, an die die Antwort geht.' }
    'Import Sequence Number' = @{ nl = 'Importvolgnummer'; de = 'Importsequenznummer' }
    'Sequence number of the import that created this record.' = @{ nl = 'Volgnummer van de import die dit record heeft gemaakt.'; de = 'Sequenznummer des Imports, der diesen Datensatz erstellt hat.' }
    'Modified By' = @{ nl = 'Gewijzigd door'; de = 'Geändert von' }
    'User who last modified the record.' = @{ nl = 'Gebruiker die het record het laatst heeft gewijzigd.'; de = 'Benutzer, der den Datensatz zuletzt geändert hat.' }
    'Modified On' = @{ nl = 'Gewijzigd op'; de = 'Geändert am' }
    'Date and time when the record was modified.' = @{ nl = 'Datum en tijd waarop het record is gewijzigd.'; de = 'Datum und Uhrzeit der letzten Änderung des Datensatzes.' }
    'Modified By (Delegate)' = @{ nl = 'Gewijzigd door (gemachtigde)'; de = 'Geändert von (Delegierter)' }
    'Delegate user who last modified the record.' = @{ nl = 'Gemachtigde gebruiker die het record het laatst heeft gewijzigd.'; de = 'Delegierter Benutzer, der den Datensatz zuletzt geändert hat.' }
    'Record Created On' = @{ nl = 'Record gemaakt op'; de = 'Datensatz erstellt am' }
    'Date and time that the record was migrated.' = @{ nl = 'Datum en tijd waarop het record is gemigreerd.'; de = 'Datum und Uhrzeit der Migration des Datensatzes.' }
    'Owner' = @{ nl = 'Eigenaar'; de = 'Besitzer' }
    'Owner Id' = @{ nl = 'Id van eigenaar'; de = 'Besitzer-ID' }
    'Owning Business Unit' = @{ nl = 'Eigenaar bedrijfseenheid'; de = 'Besitzende Geschäftseinheit' }
    'Business unit that owns the record' = @{ nl = 'Bedrijfseenheid die eigenaar is van het record'; de = 'Geschäftseinheit, die den Datensatz besitzt' }
    'Owning Team' = @{ nl = 'Eigenaar team'; de = 'Besitzendes Team' }
    'Team that owns the record.' = @{ nl = 'Team dat eigenaar is van het record.'; de = 'Team, das den Datensatz besitzt.' }
    'Owning User' = @{ nl = 'Eigenaar gebruiker'; de = 'Besitzender Benutzer' }
    'User that owns the record.' = @{ nl = 'Gebruiker die eigenaar is van het record.'; de = 'Benutzer, der den Datensatz besitzt.' }
    'Status' = @{ nl = 'Status'; de = 'Status' }
    'Status of the request' = @{ nl = 'Status van het verzoek'; de = 'Status der Anfrage' }
    'Status Reason' = @{ nl = 'Statusreden'; de = 'Statusgrund' }
    'Reason for the status of the request' = @{ nl = 'Reden voor de status van het verzoek'; de = 'Grund für den Status der Anfrage' }
    'Active' = @{ nl = 'Actief'; de = 'Aktiv' }
    'Inactive' = @{ nl = 'Inactief'; de = 'Inaktiv' }
    'Time Zone Rule Version Number' = @{ nl = 'Versienummer tijdzoneregel'; de = 'Versionsnummer der Zeitzonenregel' }
    'For internal use only.' = @{ nl = 'Alleen voor intern gebruik.'; de = 'Nur zur internen Verwendung.' }
    'UTC Conversion Time Zone Code' = @{ nl = 'UTC-conversietijdzonecode'; de = 'Zeitzonencode für UTC-Konvertierung' }
    'Time zone code that was in use when the record was created.' = @{ nl = 'Tijdzonecode die gold toen het record werd gemaakt.'; de = 'Zeitzonencode, der bei der Erstellung des Datensatzes galt.' }
    'A request someone sends in; the sample table of the CaseApp scaffold.' = @{ nl = 'Een verzoek dat iemand indient; de voorbeeldtabel van de CaseApp-basis.'; de = 'Eine eingereichte Anfrage; die Beispieltabelle des CaseApp-Gerüsts.' }
    'Web form' = @{ nl = 'Webformulier'; de = 'Webformular' }
    'Email' = @{ nl = 'E-mail'; de = 'E-Mail' }
    'Phone' = @{ nl = 'Telefoon'; de = 'Telefon' }
    'Portal base URL' = @{ nl = 'Basisadres portaal'; de = 'Basis-URL des Portals' }
    'Public address of the portal; links in notifications start with it.' = @{ nl = 'Openbaar adres van het portaal; links in meldingen beginnen ermee.'; de = 'Öffentliche Adresse des Portals; Links in Benachrichtigungen beginnen damit.' }
    'CaseApp Core' = @{ nl = 'CaseApp Kern'; de = 'CaseApp Kern' }
    'Contoso' = @{ nl = 'Contoso'; de = 'Contoso' }
    'Contoso (sample publisher)' = @{ nl = 'Contoso (voorbeelduitgever)'; de = 'Contoso (Beispielherausgeber)' }
    'SAMPLE. The data model of CaseApp: tables, choices and environment variables.' = @{ nl = 'VOORBEELD. Het datamodel van CaseApp: tabellen, keuzes en omgevingsvariabelen.'; de = 'BEISPIEL. Das Datenmodell von CaseApp: Tabellen, Auswahlen und Umgebungsvariablen.' }
}
$untranslated = [System.Collections.Generic.HashSet[string]]::new()
function Get-Translation {
    param([string]$English, $Target)
    if ($Target.Language -eq 'en' -or $English -eq '') { return $English }
    if ($dictionary.ContainsKey($English) -and $dictionary[$English].ContainsKey($Target.Language)) { return $dictionary[$English][$Target.Language] }
    [void]$untranslated.Add("$($Target.Culture): $English")
    return $English
}
function ConvertTo-XmlAttribute { param([string]$Text) return $Text.Replace('&', '&amp;').Replace('"', '&quot;').Replace('<', '&lt;') }
function ConvertFrom-XmlAttribute { param([string]$Text) return $Text.Replace('&quot;', '"').Replace('&lt;', '<').Replace('&gt;', '>').Replace('&amp;', '&') }

# --- copy --------------------------------------------------------------------------------------
$source = Join-Path $PSScriptRoot 'scaffold'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach ($item in Get-ChildItem -Path $source -Force) { Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force }
foreach ($leftover in 'out', 'release', 'node_modules', 'environments.local.json') { $p = Join-Path $Destination $leftover; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
$utf8 = [System.Text.UTF8Encoding]::new($false)

# --- labels in the solution XML (the sample holds 1033 as the source) --------------------------
$labelLine = '^(?<indent>\s*)<(?<tag>\w+) description="(?<text>[^"]*)" languagecode="(?<lcid>\d+)" />\s*$'
foreach ($file in Get-ChildItem -Path (Join-Path $Destination 'solutions') -Recurse -File -Filter *.xml) {
    $lines = [System.IO.File]::ReadAllLines($file.FullName)
    $out = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match $labelLine) {
            if ($Matches.lcid -ne '1033') { continue }
            $indent = $Matches.indent; $tag = $Matches.tag; $english = ConvertFrom-XmlAttribute $Matches.text
            $emit = if ($english -eq '') { @($base) } else { $targets }
            foreach ($t in ($emit | Sort-Object Lcid)) { $out.Add("$indent<$tag description=`"$(ConvertTo-XmlAttribute (Get-Translation $english $t))`" languagecode=`"$($t.Lcid)`" />") }
            continue
        }
        if ($line -match '^(\s*)<Language>\d+</Language>\s*$') {
            $indent = $Matches[1]
            if ($i -gt 0 -and $lines[$i - 1] -match '<Language>\d+</Language>') { continue }
            foreach ($t in ($targets | Sort-Object Lcid)) { $out.Add("$indent<Language>$($t.Lcid)</Language>") }
            continue
        }
        $line = [regex]::Replace($line, '(?<=<(?:description|displayname) default=")([^"]*)(?=")', { param($m) ConvertTo-XmlAttribute (Get-Translation (ConvertFrom-XmlAttribute $m.Value) $base) })
        $line = $line.Replace('languagecode="1033" generatedBy=', "languagecode=`"$($base.Lcid)`" generatedBy=")
        $out.Add($line)
    }
    [System.IO.File]::WriteAllText($file.FullName, ($out -join "`n") + "`n", $utf8)
}

# --- labels in schema.json ---------------------------------------------------------------------
function Convert-Labels {
    param($Node)
    if ($Node -is [System.Collections.IDictionary]) {
        $keys = @($Node.Keys)
        if ($keys.Count -gt 0 -and -not ($keys | Where-Object { $_ -notmatch '^\d{4,5}$' }) -and $Node.Contains('1033') -and $Node['1033'] -is [string]) {
            $labels = [ordered]@{}
            foreach ($t in $targets) { $labels["$($t.Lcid)"] = Get-Translation $Node['1033'] $t }
            return $labels
        }
        foreach ($k in $keys) { $Node[$k] = Convert-Labels $Node[$k] }
        return $Node
    }
    if ($Node -is [System.Collections.IList] -and $Node -isnot [string]) {
        $list = [System.Collections.Generic.List[object]]::new()
        foreach ($item in $Node) { $list.Add((Convert-Labels $item)) }
        return , $list.ToArray()
    }
    return $Node
}
$schemaPath = Join-Path $Destination 'build/contracts/schema.json'
$schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
$languageComment = $schema.languages['$comment']
$schema.languages = $null
$schema = Convert-Labels $schema
$cultures = [ordered]@{}
foreach ($t in $targets) { $cultures["$($t.Lcid)"] = $t.Culture }
$schema.languages = [ordered]@{ '$comment' = $languageComment; base = $base.Lcid; lcids = $lcids; cultures = $cultures }
[System.IO.File]::WriteAllText($schemaPath, ($schema | ConvertTo-Json -Depth 50) + "`n", $utf8)

# --- rename the sample -------------------------------------------------------------------------
# Option value prefix: a stable number from the prefix (FNV-1a), in the 10000-99999 range.
[uint64]$hash = 2166136261
foreach ($b in [System.Text.Encoding]::ASCII.GetBytes($Prefix)) { $hash = (($hash -bxor $b) * 16777619) % 4294967296 }
$optionPrefix = [int](10000 + ($hash % 90000))
# Case-sensitive and in this order (a hashtable would fold CaseApp and caseapp together).
$replacements = @(
    @('contoso-caseapp', "$Prefix-$lower"),
    @('CaseApp', $Name),
    @('caseapp', $lower),
    @('Contoso', $Publisher),
    @('contoso_', "${Prefix}_"),
    @('contoso', $Prefix),
    @('75259', "$optionPrefix")
)
function Convert-Text { param([string]$Text) foreach ($pair in $replacements) { $Text = $Text.Replace($pair[0], $pair[1]) }; return $Text }
foreach ($file in Get-ChildItem -Path $Destination -Recurse -File -Force) {
    $text = [System.IO.File]::ReadAllText($file.FullName)
    $new = Convert-Text $text
    if ($new -cne $text) { [System.IO.File]::WriteAllText($file.FullName, $new, $utf8) }
}
foreach ($item in (Get-ChildItem -Path $Destination -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending)) {
    $newName = Convert-Text $item.Name
    if ($newName -cne $item.Name) { Rename-Item -LiteralPath $item.FullName -NewName $newName }
}

if (Get-Command git -ErrorAction SilentlyContinue) {
    & git -C $Destination init -b main --quiet 2>$null
}

Write-Host ''
Write-Host "Created $Name in $Destination" -ForegroundColor Green
Write-Host "  publisher $Publisher, prefix ${Prefix}_, option values from ${optionPrefix}0000"
Write-Host "  languages $(($targets | ForEach-Object { "$($_.Culture) ($($_.Lcid))" }) -join ', '); base $($base.Culture) ($($base.Lcid)): create every environment with this base language"
if ($untranslated.Count -gt 0) {
    $byCulture = @($untranslated) | Group-Object { $_.Split(':')[0] } | ForEach-Object { "$($_.Name) ($($_.Count) labels)" }
    Write-Host "  English text, to translate first: $($byCulture -join ', '). The checks cannot tell English from a translation." -ForegroundColor Yellow
    if ($VerbosePreference -eq 'Continue') { @($untranslated) | Sort-Object | ForEach-Object { Write-Verbose $_ } }
}
Write-Host ''
Write-Host 'Next, in the new folder: npm test; pwsh ./build/Build-Solution.ps1 -RoundTrip; pwsh ./build/Test-Translations.ps1;' -ForegroundColor Cyan
Write-Host 'then fill environments.local.json with the real tenant, merge CLAUDE.dataverse.md into CLAUDE.md, and replace the sample table with the product.' -ForegroundColor Cyan
