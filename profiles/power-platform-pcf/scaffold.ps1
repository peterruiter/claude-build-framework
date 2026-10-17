<#
.SYNOPSIS
    Creates a new code component (PCF) repository from the power-platform-pcf profile.

.DESCRIPTION
    Copies scaffold/ into -Destination and makes it the project's own:

      controls/            an npm workspace: one pcfproj per control (a field control and a
                           dataset control to start from), shared strings and theme helpers,
                           tests with a mocked context, lint, the gate scripts
      solution/            the Dataverse solution project (cdsproj) that references every control
      scripts/Deploy-Dev.ps1  import into a development environment, with the owner's go
      build/contracts/locales.json  the languages (the framework's contract)
      .github/workflows/ci.yml      the checks (and deploy-dev.yml with -WithDeployWorkflow)

    Then it renames: Contoso (solution unique name, control namespace, publisher) becomes -Name,
    the publisher prefix contoso becomes -Prefix, every project gets a new GUID; and it sets up
    the languages: locales.json from -Languages (codes or cultures, from the framework's
    catalogue), a RESX file per language and control (scripts/sync-languages.mjs), with
    Dataverse language ids (LCIDs). New languages start as the English text marked untranslated:
    translate them before that language goes live (the release gate refuses untranslated strings).

    Requires node (22.18 or newer). Runs nothing against an environment; initialises a git
    repository on branch main without committing.

.PARAMETER Name
    PascalCase: the solution's unique name and the controls' namespace (MyProduct).

.PARAMETER Prefix
    The publisher's customization prefix: 2 to 8 lower-case letters or digits, starting with a
    letter, not mscrm. Use the prefix of the publisher the target environments already have.

.PARAMETER Languages
    The languages to offer, as codes or cultures: en,nl,de or en-GB,nl,pt-PT.

.PARAMETER DefaultLanguage
    The fallback language; the first of -Languages by default. Its strings are also built into
    each bundle, so a reader never sees a raw key.

.PARAMETER Destination
    The new repository's folder: empty or absent.

.PARAMETER PublisherName
    The publisher's display name; -Name by default.

.PARAMETER OptionValuePrefix
    The publisher's option value prefix (10000-99999). Derived from the prefix by default; use the
    existing publisher's value when the environments already have it.

.PARAMETER WithDeployWorkflow
    Also add .github/workflows/deploy-dev.yml (manual, through a protected GitHub environment).

.EXAMPLE
    ./scaffold.ps1 -Name FieldTools -Prefix ftl -Languages en,nl,pl -Destination ../field-tools
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [ValidatePattern('^[A-Z][A-Za-z0-9]{1,39}$')] [string] $Name,
    [Parameter(Mandatory)] [ValidatePattern('^[a-z][a-z0-9]{1,7}$')] [string] $Prefix,
    [Parameter(Mandatory)] [string[]] $Languages,
    [string] $DefaultLanguage,
    [Parameter(Mandatory)] [string] $Destination,
    [string] $PublisherName,
    [ValidateRange(10000, 99999)] [int] $OptionValuePrefix,
    [switch] $WithDeployWorkflow,
    [switch] $SkipGitInit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Name -eq 'Contoso') { throw 'Choose a name other than Contoso.' }
if ($Prefix -eq 'mscrm') { throw 'mscrm is reserved.' }
if (-not $PublisherName) { $PublisherName = $Name }
$profileRoot = $PSScriptRoot
$catalogue = Join-Path $profileRoot '../../templates/languages-catalog.json'
$tokens = @($Languages | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($tokens.Count -eq 0) { throw 'Give at least one language: -Languages en or -Languages en-GB,nl.' }
foreach ($token in $tokens) { if ($token -notmatch '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$') { throw "'$token' is not a language code or culture." } }
$codes = @($tokens | ForEach-Object { ($_ -split '-')[0].ToLowerInvariant() })
if (-not $DefaultLanguage) { $DefaultLanguage = $codes[0] }
$DefaultLanguage = ($DefaultLanguage -split '-')[0].ToLowerInvariant()
if ($codes -notcontains $DefaultLanguage) { throw "-DefaultLanguage $DefaultLanguage is not in -Languages." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is needed (22.18 or newer): https://nodejs.org' }
if (-not $OptionValuePrefix) {
    # A stable number from the prefix (pac derives its own; any value in range is valid).
    $hash = 0
    foreach ($char in $Prefix.ToCharArray()) { $hash = ($hash * 31 + [int]$char) % 90000 }
    $OptionValuePrefix = 10000 + $hash
}

if ((Test-Path $Destination) -and (Get-ChildItem -LiteralPath $Destination -Force | Where-Object { $_.Name -notin '.git', 'CLAUDE.md', 'STATE.md', 'ROADMAP.md', 'build', 'scripts', 'tests', 'src', '.github', '.githooks', 'package.json', '.gitignore', 'README.md' } | Select-Object -First 1)) {
    throw "$Destination has files this scaffold would mix with. Scaffold into a new folder, or into a project that only has the framework's files."
}
if (-not $PSCmdlet.ShouldProcess($Destination, "Scaffold $Name (prefix $Prefix; $($tokens -join ', '))")) { return }

# --------------------------------------------------------------------- copy --
$skip = @('node_modules', 'out', 'bin', 'obj', 'generated', '.vs')
$utf8 = [System.Text.UTF8Encoding]::new($false)
$copied = @()
$base = [System.IO.Path]::GetFullPath((Join-Path $profileRoot 'scaffold'))
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $base -Recurse -Force -File) {
    $relative = [System.IO.Path]::GetRelativePath($base, $item.FullName)
    if (($relative -split '[\\/]') | Where-Object { $skip -contains $_ }) { continue }
    $target = Join-Path $Destination $relative
    if ((Test-Path $target) -and $relative -notmatch '^build[\\/]contracts[\\/]locales\.json$') {
        if ($relative -in '.gitignore', '.gitattributes') {
            # Merge: add the profile's lines the project does not have yet.
            $have = Get-Content $target
            $add = Get-Content $item.FullName | Where-Object { $_ -and $have -notcontains $_ }
            if ($add) { Add-Content -Path $target -Value (@('', '# Code components (power-platform-pcf)') + $add) }
            continue
        }
        Write-Host "  kept the project's $relative" -ForegroundColor DarkGray
        continue
    }
    if ($relative -match '^build[\\/]contracts[\\/]locales\.json$' -and (Test-Path $target)) { continue }
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    $copied += $target
}
if ($WithDeployWorkflow) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Destination '.github/workflows') | Out-Null
    Copy-Item (Join-Path $profileRoot 'ci/deploy-dev.yml') (Join-Path $Destination '.github/workflows/deploy-dev.yml')
}

# ------------------------------------------------------------------- rename --
$textExtensions = '.ts', '.tsx', '.mjs', '.mts', '.json', '.xml', '.cdsproj', '.pcfproj', '.resx', '.md', '.ps1', '.yml', '.yaml', '.gitignore', '.gitattributes'
$lower = $Name.ToLowerInvariant()
foreach ($file in $copied) {
    if ($textExtensions -notcontains [System.IO.Path]::GetExtension($file)) { continue }
    $text = [System.IO.File]::ReadAllText($file)
    $renamed = [regex]::Replace($text, '\bContoso\b', $Name)
    $renamed = $renamed.Replace('"contoso-controls"', "`"$lower-controls`"")
    $renamed = $renamed.Replace('<CustomizationPrefix>contoso</CustomizationPrefix>', "<CustomizationPrefix>$Prefix</CustomizationPrefix>")
    $renamed = [regex]::Replace($renamed, '<CustomizationOptionValuePrefix>\d+</CustomizationOptionValuePrefix>', "<CustomizationOptionValuePrefix>$OptionValuePrefix</CustomizationOptionValuePrefix>")
    if ($file -like '*Solution.xml') {
        $renamed = [regex]::Replace($renamed, '(<Publisher>[\s\S]*?<LocalizedName description=")[^"]*(")', "`${1}$PublisherName`${2}")
        $renamed = [regex]::Replace($renamed, '(<Descriptions>\s*<!--[^>]*-->\s*<Description description=")[^"]*(")', "`${1}$PublisherName`${2}")
    }
    # A new GUID per project: two repositories built from this scaffold never share one.
    $renamed = [regex]::Replace($renamed, '<ProjectGuid>[^<]+</ProjectGuid>', { "<ProjectGuid>$([guid]::NewGuid())</ProjectGuid>" })
    if ($renamed -ne $text) { [System.IO.File]::WriteAllText($file, $renamed, $utf8) }
}
Get-ChildItem -LiteralPath (Join-Path $Destination 'solution') -Filter 'Contoso.cdsproj' | Rename-Item -NewName "$Name.cdsproj"

# ----------------------------------------------------------------- languages --
# The sample strings are English (source) and Dutch. English stays the source while new
# languages are created from it; when English is not offered, the default language becomes the
# source and the English files go.
$locales = Join-Path $Destination 'build/contracts/locales.json'
$withEnglish = @($tokens)
if ($codes -notcontains 'en') { $withEnglish = @('en') + $tokens }
& node (Join-Path $profileRoot 'scaffold-locales.mjs') $locales $catalogue 'en' $DefaultLanguage @withEnglish
if ($LASTEXITCODE -ne 0) { throw 'Could not write locales.json.' }
$sync = Join-Path $Destination 'controls/scripts/sync-languages.mjs'
& node $sync --locales $locales --prune
if ($LASTEXITCODE -ne 0) { throw 'Could not create the language files.' }
if ($codes -notcontains 'en') {
    & node (Join-Path $profileRoot 'scaffold-locales.mjs') $locales $catalogue $DefaultLanguage $DefaultLanguage @tokens
    & node $sync --locales $locales --prune
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove English.' }
}

if (-not $SkipGitInit -and (Get-Command git -ErrorAction SilentlyContinue) -and -not (Test-Path (Join-Path $Destination '.git'))) {
    git -C $Destination init -b main --quiet
}

Write-Host ''
Write-Host "$Name is at $Destination (publisher prefix $Prefix, option value prefix $OptionValuePrefix)" -ForegroundColor Green
Write-Host "    Languages: $($tokens -join ', ') (default $DefaultLanguage). Strings marked untranslated need a translator."
Write-Host '    Next:'
Write-Host '      cd controls; npm ci; npm run gate'
Write-Host "      dotnet build ../solution/$Name.cdsproj -c Release"
Write-Host '      npm start -w SampleControl                    (the test harness)'
