<#
.SYNOPSIS
    The design system steps every profile's scaffold.ps1 shares: check that a design system exists,
    generate its files into the new project with scripts/design-system.mjs, and record the choice in
    the project's build/framework.json.

.DESCRIPTION
    A profile's scaffold imports this module from the framework it runs from:

        Import-Module (Join-Path $PSScriptRoot '../../scripts/DesignSystem.psm1') -Force

    Assert-DesignSystem     before anything is copied, so an unknown id writes nothing
    Invoke-DesignSystemBuild  node scripts/design-system.mjs build <id> --out <dir> --targets <list>,
                            into an emptied folder (a switch leaves no old fonts or logos behind)
    Set-ProjectDesignSystem build/framework.json: designSystem (id, out, targets) and, for a web UI,
                            theme (css, tokens, pairs); creates the file, or adds to the one a
                            framework project already has, and refuses a different design system
#>

Set-StrictMode -Version Latest

$frameworkRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$generator = Join-Path $PSScriptRoot 'design-system.mjs'

function Get-DesignSystemManifest {
    param([Parameter(Mandatory)] [string] $Id)
    $path = Join-Path $frameworkRoot "design-systems/$Id/design-system.json"
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Assert-DesignSystem {
    <#
    Throws, naming the known design systems, when design-systems/<Id> does not exist; with
    -Destination, also when the project there already records another design system (before
    anything is copied). Returns the manifest.
    #>
    param([Parameter(Mandatory)] [string] $Id, [string] $Destination)
    if ($Id -notmatch '^[a-z0-9][a-z0-9-]*$') { throw "'$Id' is not a design system id (lower-case letters, digits and hyphens)." }
    $manifest = Get-DesignSystemManifest -Id $Id
    if (-not $manifest) {
        $known = @(Get-ChildItem -LiteralPath (Join-Path $frameworkRoot 'design-systems') -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName 'design-system.json') } | ForEach-Object Name) -join ', '
        throw "There is no design system '$Id' in the framework (known: $known). List them with: node `"$generator`" list"
    }
    if ($Destination) {
        $config = Join-Path $Destination 'build/framework.json'
        if (Test-Path -LiteralPath $config) {
            $have = (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json -AsHashtable)['designSystem']
            if ($have -and $have['id'] -and $have['id'] -ne $Id) {
                throw "build/framework.json in $Destination says the project uses the design system '$($have['id'])', not '$Id'. Scaffold with -DesignSystem $($have['id']), or switch the project first (design-system skill). Nothing was copied."
            }
        }
    }
    return $manifest
}

function Invoke-DesignSystemBuild {
    <# Generates the design system's targets into Out, after emptying it. Needs node 22.18 or newer. #>
    param(
        [Parameter(Mandatory)] [string] $Id,
        [Parameter(Mandatory)] [string] $Out,
        [Parameter(Mandatory)] [string[]] $Targets
    )
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is needed to generate the design system (22.18 or newer): https://nodejs.org' }
    if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
    $output = & node $generator build $Id --out $Out --targets ($Targets -join ',') 2>&1
    if ($LASTEXITCODE -ne 0) { throw "The design system '$Id' did not generate:`n$($output -join "`n")" }
    Write-Host "    $($output -join ' ')" -ForegroundColor DarkGray
}

function Set-ProjectDesignSystem {
    <#
    Records the design system in <Destination>/build/framework.json. Out and the theme paths are
    relative to the repository root, with forward slashes; the profile's out and targets replace
    the template's (the profile's generated folder is the one the project regenerates). -Theme also
    points theme.css and theme.tokens at the generated tokens.css and tokens.json (the framework's
    theme contract test reads them). An existing designSystem with another id stops the script:
    one project, one design system.
    #>
    param(
        [Parameter(Mandatory)] [string] $Destination,
        [Parameter(Mandatory)] [string] $Id,
        [AllowNull()] [string] $Out,
        [string[]] $Targets = @(),
        [switch] $Theme
    )
    $path = Join-Path $Destination 'build/framework.json'
    $entry = [ordered]@{ id = $Id; out = if ($Out) { $Out } else { $null }; targets = @($Targets) }
    if (Test-Path -LiteralPath $path) {
        $config = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable
        $have = $config['designSystem']
        if ($have -and $have['id'] -and $have['id'] -ne $Id) {
            throw "build/framework.json says the project uses the design system '$($have['id'])', not '$Id'. Scaffold with -DesignSystem $($have['id']), or switch the project first (design-system skill)."
        }
        if ($have -and $have['id'] -eq $Id -and -not $Out) {
            # A profile without generated files (plug-ins) keeps what the project generates.
            $entry.out = $have['out']
            $entry.targets = @($have['targets'])
        }
    }
    else {
        New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
        $config = [ordered]@{
            description = 'The design system this project uses (designSystem: id, where its generated files go and which targets; regenerate with the build framework''s scripts/design-system.mjs build <id> --out <out> --targets <targets>) and, for a web UI, the generated files the theme contract test reads (theme.pairs: pairs the project adds, { fg, bg, min } with CSS custom property names). new-project merges this file with the framework''s project template.'
        }
    }
    $config['designSystem'] = $entry
    if ($Theme) {
        $existing = if ($config.Contains('theme') -and $config['theme']) { $config['theme'] } else { @{} }
        $pairs = @()
        if ($existing.Contains('pairs') -and $existing['pairs']) { $pairs = @($existing['pairs']) }
        $config['theme'] = [ordered]@{ css = "$($entry.out)/tokens.css"; tokens = "$($entry.out)/tokens.json"; pairs = $pairs }
    }
    [System.IO.File]::WriteAllText($path, ($config | ConvertTo-Json -Depth 20) + "`n", [System.Text.UTF8Encoding]::new($false))
}

Export-ModuleMember -Function Assert-DesignSystem, Get-DesignSystemManifest, Invoke-DesignSystemBuild, Set-ProjectDesignSystem
