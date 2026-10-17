<#
.SYNOPSIS
    Creates a new product repository from the .NET + React + Azure profile.

.DESCRIPTION
    Copies the profile into -Destination and makes it the product's own:

      scaffold/                   the solution skeleton (API, Data, Domain, tests, web, Dockerfile)
      build/                      the release and operations scripts (merged into build/)
      infra/                      the Bicep templates
      ci/pr.yml                   .github/workflows/pr.yml
      load/                       tests/load (k6 starter)
      profile.config.json.example profile.config.json, with the product's names filled in

    Then it renames: every App.Api / App.Data / App.Domain / App.Tests namespace, folder and file,
    App.slnx, and the product name where "App" stands alone; and it sets up the languages: the ones
    in -Languages are offered (build/contracts/locales.json, picker order), bundles for languages
    not asked for are removed, and every asked-for language gets complete bundles with the plural
    forms its culture needs (src/web/scripts/add-language.mjs). Bundles for a new language start as
    the English text: translate them before that language goes live.

    Requires node (22.18 or newer) for the language step. Runs nothing against Azure; initialises a
    git repository on branch main without committing.

.PARAMETER Name
    The product name in PascalCase: MyProduct. Namespaces become MyProduct.Api and so on.

.PARAMETER Languages
    The languages to offer, as codes or cultures: en,nl,de or en-GB,nl,pt-PT. A bare code takes the
    culture CLDR considers likely (nl -> nl-NL, en -> en-US); give the culture when it matters.

.PARAMETER DefaultLanguage
    The fallback language; the first of -Languages by default.

.PARAMETER Destination
    The new repository's folder: empty or absent.

.PARAMETER NamePrefix
    Azure resource name prefix (3-20 lower case letters and digits). Defaults to the lower-cased name.

.PARAMETER SkipGitInit
    Do not run git init.

.EXAMPLE
    ./scaffold.ps1 -Name MyProduct -Languages en-GB,nl,pl -Destination ../my-product
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [ValidatePattern('^[A-Z][A-Za-z0-9]{1,39}$')] [string] $Name,
    [Parameter(Mandatory)] [string[]] $Languages,
    [string] $DefaultLanguage,
    [Parameter(Mandatory)] [string] $Destination,
    [ValidatePattern('^[a-z0-9]{3,20}$')] [string] $NamePrefix,
    [switch] $SkipGitInit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Name -eq 'App') { throw 'Choose a product name other than App.' }
$profileRoot = $PSScriptRoot
$languageTokens = @($Languages | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($languageTokens.Count -eq 0) { throw 'Give at least one language: -Languages en or -Languages en-GB,nl.' }
foreach ($token in $languageTokens) { if ($token -notmatch '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$') { throw "'$token' is not a language code or culture." } }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is needed for the language set-up (22.18 or newer): https://nodejs.org' }

if (-not $NamePrefix)
{
    $NamePrefix = ($Name.ToLowerInvariant() -replace '[^a-z0-9]', '')
    if ($NamePrefix.Length -gt 20) { $NamePrefix = $NamePrefix.Substring(0, 20) }
    if ($NamePrefix.Length -lt 3) { $NamePrefix = $NamePrefix.PadRight(3, '0') }
}

$Destination = [System.IO.Path]::GetFullPath($Destination)
if ((Test-Path $Destination) -and (Get-ChildItem -LiteralPath $Destination -Force | Select-Object -First 1))
{
    throw "$Destination is not empty. Scaffold into a new folder."
}

if (-not $PSCmdlet.ShouldProcess($Destination, "Scaffold $Name ($($languageTokens -join ', '))")) { return }

# --------------------------------------------------------------------- copy --
$skip = @('bin', 'obj', 'node_modules', 'out', 'TestResults', '.vs')
# Build output of the web apps inside the API's wwwroot, never copied.
$skipPaths = @('wwwroot[\\/]app([\\/]|$)', 'wwwroot[\\/]portal([\\/]|$)')

function Copy-Tree([string] $from, [string] $to)
{
    $copied = @()
    $base = [System.IO.Path]::GetFullPath($from)
    foreach ($item in Get-ChildItem -LiteralPath $from -Recurse -Force -File)
    {
        $relative = [System.IO.Path]::GetRelativePath($base, $item.FullName)
        $parts = $relative -split '[\\/]'
        if ($parts | Where-Object { $skip -contains $_ }) { continue }
        if ($skipPaths | Where-Object { $relative -match $_ }) { continue }
        $target = Join-Path $to $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        Copy-Item -LiteralPath $item.FullName -Destination $target -Force
        $copied += $target
    }
    return $copied
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$fromScaffold = Copy-Tree (Join-Path $profileRoot 'scaffold') $Destination
Copy-Tree (Join-Path $profileRoot 'build') (Join-Path $Destination 'build') | Out-Null
Copy-Tree (Join-Path $profileRoot 'infra') (Join-Path $Destination 'infra') | Out-Null
Copy-Tree (Join-Path $profileRoot 'load') (Join-Path $Destination 'tests/load') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination '.github/workflows') | Out-Null
Copy-Item (Join-Path $profileRoot 'ci/pr.yml') (Join-Path $Destination '.github/workflows/pr.yml')

# ------------------------------------------------------------------- rename --
$textExtensions = '.cs', '.csproj', '.props', '.slnx', '.json', '.sql', '.ts', '.tsx', '.mjs', '.js', '.css', '.html', '.md', '.ps1', '.psm1', '.yml', '.yaml', '.txt', '.editorconfig', '.gitignore', '.dockerignore', '.gitattributes', ''
$utf8 = [System.Text.UTF8Encoding]::new($false)
foreach ($file in $fromScaffold)
{
    $extension = [System.IO.Path]::GetExtension($file)
    if ($textExtensions -notcontains $extension -and (Split-Path $file -Leaf) -ne 'Dockerfile') { continue }
    $text = [System.IO.File]::ReadAllText($file)
    # "App" as a whole word is the product name everywhere in scaffold/ (App.Api, App.slnx, <title>App</title> ...);
    # App_Tests_, AppContext, WebApplication and the lower-case app are not whole-word matches.
    $renamed = [regex]::Replace($text, '\bApp\b', $Name)
    if ($renamed -ne $text) { [System.IO.File]::WriteAllText($file, $renamed, $utf8) }
}

# Folders and files named App.* (deepest first, so a parent's rename does not move a child from under us).
Get-ChildItem -LiteralPath $Destination -Recurse -Force |
    Where-Object { $_.Name -like 'App.*' } |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object { Rename-Item -LiteralPath $_.FullName -NewName ($Name + $_.Name.Substring(3)) }

# ----------------------------------------------------------------- languages --
$locales = Join-Path $Destination 'build/contracts/locales.json'
$contract = Get-Content $locales -Raw | ConvertFrom-Json
$source = if ($contract.PSObject.Properties['source']) { $contract.source } else { 'en' }
$codes = @($languageTokens | ForEach-Object { ($_ -split '-')[0].ToLowerInvariant() })
if (-not $DefaultLanguage) { $DefaultLanguage = $codes[0] }
$DefaultLanguage = ($DefaultLanguage -split '-')[0].ToLowerInvariant()
if ($codes -notcontains $DefaultLanguage) { throw "-DefaultLanguage $DefaultLanguage is not in -Languages." }

$resources = Join-Path $Destination "src/$Name.Domain/Localization/Resources"
foreach ($bundle in Get-ChildItem $resources -Filter '*.json')
{
    $language = $bundle.BaseName.Split('.')[-1]
    if ($language -ne $source -and $codes -notcontains $language) { Remove-Item $bundle.FullName }
}
$contract.locales = @()
$contract.default = $DefaultLanguage
$contract | ConvertTo-Json -Depth 10 | Set-Content -Path $locales -Encoding utf8

$addLanguage = Join-Path $Destination 'src/web/scripts/add-language.mjs'
foreach ($token in $languageTokens)
{
    $code = ($token -split '-')[0].ToLowerInvariant()
    if ($token.Contains('-')) { & node $addLanguage $code $token } else { & node $addLanguage $code }
    if ($LASTEXITCODE -ne 0) { throw "Could not add the language $token." }
}
& node $addLanguage --default $DefaultLanguage | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not make $DefaultLanguage the default." }

# -------------------------------------------------------------------- config --
$config = Get-Content (Join-Path $profileRoot 'profile.config.json.example') -Raw | ConvertFrom-Json
$lower = $Name.ToLowerInvariant()
$config.product.name = $Name
$config.product.solution = "$Name.slnx"
$config.product.apiProject = "src/$Name.Api"
$config.product.testProject = "tests/$Name.Tests"
$config.product.imageRepository = $lower
$config.azure.namePrefix = $NamePrefix
$config.azure.resourceGroup = "rg-$NamePrefix"
$config | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Destination 'profile.config.json') -Encoding utf8

if (-not $SkipGitInit -and (Get-Command git -ErrorAction SilentlyContinue))
{
    git -C $Destination init -b main --quiet
}

Write-Host ''
Write-Host "$Name is at $Destination" -ForegroundColor Green
Write-Host "    Languages: $($languageTokens -join ', ') (default $DefaultLanguage). New bundles hold English: translate them."
Write-Host '    Next:'
Write-Host '      dotnet build -c Release; dotnet test'
Write-Host '      cd src/web; npm ci; npm run build; npm test'
Write-Host '      ./build/Start-Local.ps1            (LocalDB; http://127.0.0.1:5080/app/)'
Write-Host '      Fill in profile.config.json (azure.tenantId, azure.subscriptionId) before any build/*.ps1 that touches Azure.'
