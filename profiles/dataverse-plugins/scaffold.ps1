<#
.SYNOPSIS
    Adds a Dataverse plug-in solution from the dataverse-plugins profile to a repository.

.DESCRIPTION
    Copies profiles/dataverse-plugins/scaffold into -Destination and makes it the project's own:

      Contoso.Sample.slnx, Directory.Build.props, Directory.Packages.props, global.json, VERSION,
      .editorconfig, .gitignore (merged when one exists), .github/workflows/plugins.yml,
      build/Register-Plugins.ps1, build/Set-Version.ps1, build/contracts/registration.json,
      src/<Name>.Plugins (PluginBase, two sample plug-ins, a custom API, message bundles),
      tests/<Name>.Plugins.Tests (fakes, plug-in tests, manifest contract, code rules).

    Renames: "Contoso.Sample" becomes -Name in namespaces, files and folders; "ContosoSample" the solution
    unique name; the publisher prefix "contoso" becomes -Prefix (custom API names, package unique name);
    any other "Contoso" becomes the first part of -Name.

    Languages: Strings/messages.<code>.json for every language in -Languages, languages.json listing them
    with the source language. Bundles for languages the profile does not ship (it ships en and nl) start
    as a copy of the English text: translate them before that language goes live.

    The destination may already hold a project (for example one /build-framework:new-project set up): no
    existing file is overwritten; the script stops and names the clash instead. Runs nothing against any
    environment.

.PARAMETER Name
    The product name, PascalCase, dots allowed: Northwind or Northwind.Sales. Becomes the namespace root
    (Northwind.Sales.Plugins) and the solution unique name (NorthwindSales).

.PARAMETER Prefix
    The Dataverse publisher's customisation prefix: 2-8 lower-case letters or digits, starting with a letter,
    not "mscrm". Must match the publisher of the solution the plug-ins ship in.

.PARAMETER Languages
    Language codes for user-facing messages: en,nl or en,de,fr or pt-BR. Matched against the user's
    Dataverse UI language (exact culture first, then the language).

.PARAMETER SourceLanguage
    The language strings are written in first and the fallback. Default: en when listed, else the first.

.PARAMETER Destination
    The repository folder. Created when absent.

.PARAMETER SkipGitInit
    Do not run git init when the destination is not a repository yet.

.EXAMPLE
    ./profiles/dataverse-plugins/scaffold.ps1 -Name Northwind.Sales -Prefix nw -Languages en,nl -Destination ../northwind-plugins
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [ValidatePattern('^[A-Z][A-Za-z0-9]{1,39}(\.[A-Z][A-Za-z0-9]{1,39}){0,2}$')] [string] $Name,
    [Parameter(Mandatory)] [ValidatePattern('^[a-z][a-z0-9]{1,7}$')] [string] $Prefix,
    [Parameter(Mandatory)] [string[]] $Languages,
    [string] $SourceLanguage,
    [Parameter(Mandatory)] [string] $Destination,
    [switch] $SkipGitInit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Prefix.StartsWith('mscrm')) { throw 'The prefix mscrm is reserved.' }
if ($Name -eq 'Contoso.Sample') { throw 'Choose your own product name.' }
$codes = @($Languages | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($codes.Count -eq 0) { throw 'Give at least one language: -Languages en or -Languages en,nl.' }
foreach ($code in $codes) { if ($code -notmatch '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$') { throw "'$code' is not a language code (en, nl, pt-BR)." } }
if (@($codes | Select-Object -Unique).Count -ne $codes.Count) { throw 'A language is listed twice.' }
if (-not $SourceLanguage) { $SourceLanguage = if ($codes -contains 'en') { 'en' } else { $codes[0] } }
if ($codes -notcontains $SourceLanguage) { throw "-SourceLanguage $SourceLanguage is not in -Languages." }

$profileRoot = $PSScriptRoot
$from = Join-Path $profileRoot 'scaffold'
$Destination = [System.IO.Path]::GetFullPath($Destination)
$solutionName = $Name -replace '\.', ''
$company = $Name.Split('.')[0]

function Rename-Text([string] $text)
{
    $text = $text.Replace('Contoso.Sample', $Name).Replace('ContosoSample', $solutionName)
    $text = [regex]::Replace($text, '\bcontoso_', "$($Prefix)_")
    $text = [regex]::Replace($text, '\bcontoso\b', $Prefix)
    return [regex]::Replace($text, '\bContoso\b', $company)
}

# ------------------------------------------------------------------- plan --
$skip = @('bin', 'obj', 'out', 'TestResults', '.vs')
$base = [System.IO.Path]::GetFullPath($from)
$files = foreach ($item in Get-ChildItem -LiteralPath $from -Recurse -Force -File)
{
    $relative = [System.IO.Path]::GetRelativePath($base, $item.FullName)
    if ($relative -split '[\\/]' | Where-Object { $skip -contains $_ }) { continue }
    if ($relative -match '^src[\\/][^\\/]+[\\/]Strings[\\/]messages\.') { continue } # languages below
    [pscustomobject]@{ Source = $item.FullName; Target = Join-Path $Destination (Rename-Text $relative) }
}
$clashes = @($files | Where-Object { (Test-Path $_.Target) -and (Split-Path $_.Target -Leaf) -ne '.gitignore' })
if ($clashes.Count -gt 0) { throw "These files exist already; nothing was copied:`n  $(($clashes.Target) -join "`n  ")" }

if (-not $PSCmdlet.ShouldProcess($Destination, "Scaffold $Name plug-ins (prefix $Prefix; languages $($codes -join ', '), source $SourceLanguage)")) { return }

# ------------------------------------------------------------------- copy --
$utf8 = [System.Text.UTF8Encoding]::new($false)
foreach ($file in $files)
{
    New-Item -ItemType Directory -Force -Path (Split-Path $file.Target -Parent) | Out-Null
    $text = Rename-Text ([System.IO.File]::ReadAllText($file.Source))
    if ((Split-Path $file.Target -Leaf) -eq '.gitignore' -and (Test-Path $file.Target))
    {
        $have = Get-Content $file.Target
        $add = @($text -split "`r?`n" | Where-Object { $_ -and -not $_.StartsWith('#') -and $have -notcontains $_ })
        if ($add.Count -gt 0) { Add-Content -Path $file.Target -Value (@('', '# Dataverse plug-ins') + $add) }
        continue
    }
    [System.IO.File]::WriteAllText($file.Target, $text, $utf8)
}

# -------------------------------------------------------------- languages --
$stringsFrom = Join-Path $from 'src/Contoso.Sample.Plugins/Strings'
$stringsTo = Join-Path $Destination "src/$Name.Plugins/Strings"
$english = [System.IO.File]::ReadAllText((Join-Path $stringsFrom 'messages.en.json'))
$untranslated = @()
foreach ($code in $codes)
{
    $shipped = Join-Path $stringsFrom "messages.$code.json"
    if (Test-Path $shipped) { $text = [System.IO.File]::ReadAllText($shipped) }
    else { $text = $english; $untranslated += $code }
    [System.IO.File]::WriteAllText((Join-Path $stringsTo "messages.$code.json"), (Rename-Text $text), $utf8)
}
$quoted = ($codes | ForEach-Object { '"' + $_ + '"' }) -join ', '
$languagesJson = "{`n  `"source`": `"$SourceLanguage`",`n  `"languages`": [$quoted]`n}`n"
[System.IO.File]::WriteAllText((Join-Path $stringsTo 'languages.json'), $languagesJson, $utf8)

# ------------------------------------------------------------------ check --
$left = @(Get-ChildItem -LiteralPath $Destination -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' } |
    Where-Object { $files.Target -contains $_.FullName -or $_.FullName.StartsWith($stringsTo) } |
    Where-Object { (Select-String -LiteralPath $_.FullName -Pattern 'contoso' -SimpleMatch -Quiet) -and -not ($Name + $Prefix).ToLowerInvariant().Contains('contoso') })
if ($left.Count -gt 0) { throw "The sample name is still in: $(($left.FullName) -join ', ')" }

if (-not $SkipGitInit -and -not (Test-Path (Join-Path $Destination '.git')) -and (Get-Command git -ErrorAction SilentlyContinue))
{
    git -C $Destination init -b main --quiet
}

Write-Host ''
Write-Host "$Name plug-ins are at $Destination" -ForegroundColor Green
Write-Host "    Prefix $Prefix, solution $solutionName, languages $($codes -join ', ') (source $SourceLanguage)."
if ($untranslated.Count -gt 0) { Write-Host "    messages.{$($untranslated -join ',')}.json hold the English text: translate them." -ForegroundColor Yellow }
Write-Host '    Next:'
Write-Host '      dotnet build -c Release; dotnet test -c Release'
Write-Host "      dotnet pack src/$Name.Plugins -c Release --no-build -o out/package"
Write-Host '      ./build/Register-Plugins.ps1 -Offline'
Write-Host '    Rename or replace the sample plug-ins, steps and custom API before the first registration.'
