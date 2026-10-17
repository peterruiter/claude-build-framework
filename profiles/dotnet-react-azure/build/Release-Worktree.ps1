<#
.SYNOPSIS
    The release gate in a clean copy: a git worktree of a commit, a Release build with the image's
    SDK, every test, and the web checks, while work carries on in the main tree.

.DESCRIPTION
    Agents and people keep editing the main working tree; a release must be built from exactly the
    commit being released. So:

      1. git worktree add --detach <repo><suffix> <Ref>      (beside the repository)
      2. SDK pin: when the worktree has no global.json and dotnet.releaseSdkVersion is set (or
         -SdkVersion is passed), a TEMPORARY global.json pins the image's SDK. A newer local SDK has
         newer analyzers and compiler warnings; the image treats warnings as errors and fails on
         what the laptop never saw (CS1998, CA1859 ...). The pin is removed afterwards.
      3. dotnet build -c Release with a scratch --artifacts-path (no bin/obj left in the worktree).
      4. dotnet test -c Release WITHOUT --artifacts-path: some tests find the repository by walking
         up from their build output, which an artifacts path moves outside the repository.
      5. Web: node_modules is a junction (Windows) or symlink to the main tree's, so nothing is
         downloaded; then npm run check, typecheck, test and build. The link is removed with a
         non-recursive delete (a recursive delete of a junction empties the TARGET, the main tree's
         node_modules). TypeScript's build info lands in the main tree's node_modules/.tmp through
         the link, which is harmless.
      6. Without -Keep the worktree is removed. With -Keep it stays for the release steps
         (Initialize-Database.ps1, Publish-Container.ps1 run from the worktree), and the command to
         remove it is printed.

    Nothing here touches Azure, commits or pushes.

.PARAMETER Ref
    The commit to release. HEAD by default: commit (and push) first.

.PARAMETER SdkVersion
    Pin this exact SDK for the build, overriding global.json for this run only.

.PARAMETER Keep
    Leaves the worktree for the release steps.

.PARAMETER SkipWeb
    Skips the web checks (only when the web did not change and the owner agreed).

.EXAMPLE
    ./build/Release-Worktree.ps1 -Keep
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $Ref = 'HEAD',
    [string] $SdkVersion,
    [switch] $Keep,
    [switch] $SkipWeb
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Assert-Command -Name git | Out-Null
Assert-Command -Name dotnet -InstallHint 'Install the .NET SDK from https://dot.net' | Out-Null

$root = Get-RepositoryRoot
$config = Get-ProfileConfig
$suffix = Get-ConfigValue $config 'release.worktreeSuffix' -Default '-release'
$webFolder = Get-ConfigValue $config 'product.webFolder' -Default 'src/web'
if (-not $SdkVersion) { $SdkVersion = Get-ConfigValue $config 'dotnet.releaseSdkVersion' -Default '' }

$worktree = Join-Path (Split-Path $root -Parent) ((Split-Path $root -Leaf) + $suffix)
$commit = git -C $root rev-parse --verify "$Ref^{commit}"
if ($LASTEXITCODE -ne 0) { throw "'$Ref' is not a commit." }

$dirty = git -C $root status --porcelain
if ($dirty) { Write-Host 'The main tree has uncommitted changes; they are NOT in this release (only the commit is).' -ForegroundColor Yellow }
if (Test-Path $worktree) { throw "$worktree exists. Remove it first: git -C `"$root`" worktree remove --force `"$worktree`"" }

if (-not $PSCmdlet.ShouldProcess($worktree, "Release gate for $($commit.Substring(0, 12))")) { return }

git -C $root worktree add --detach $worktree $commit
if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed.' }

$globalJson = Join-Path $worktree 'global.json'
$savedGlobalJson = $null
$link = $null
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "release-artifacts-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$failed = $true

try
{
    if ($SdkVersion)
    {
        if (Test-Path $globalJson) { $savedGlobalJson = Get-Content $globalJson -Raw }
        @{ sdk = @{ version = $SdkVersion; rollForward = 'disable' } } | ConvertTo-Json | Set-Content -Path $globalJson -Encoding utf8
        Write-Host "Temporary SDK pin: $SdkVersion" -ForegroundColor Cyan
    }
    elseif (-not (Test-Path $globalJson))
    {
        Write-Host 'No global.json and no dotnet.releaseSdkVersion: building with whatever SDK is newest here, which may not be the image''s.' -ForegroundColor Yellow
    }

    Push-Location $worktree
    try
    {
        Write-Host "SDK: $(dotnet --version)"
        if ($LASTEXITCODE -ne 0) { throw "The pinned SDK is not installed. Install it, or pass -SdkVersion with one that is (dotnet --list-sdks)." }

        Write-Host '== Release build' -ForegroundColor Cyan
        dotnet build --configuration Release --artifacts-path $scratch
        if ($LASTEXITCODE -ne 0) { throw 'The Release build failed (warnings are errors in Release).' }

        Write-Host '== Tests (no artifacts path)' -ForegroundColor Cyan
        dotnet test --configuration Release
        if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    }
    finally
    {
        Pop-Location
    }

    if (-not $SkipWeb)
    {
        $web = Join-Path $worktree $webFolder
        $mainModules = Join-Path (Join-Path $root $webFolder) 'node_modules'
        $link = Join-Path $web 'node_modules'
        if (Test-Path $mainModules)
        {
            $type = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'Junction' } else { 'SymbolicLink' }
            New-Item -ItemType $type -Path $link -Target $mainModules | Out-Null
        }
        else
        {
            $link = $null
            Write-Host 'The main tree has no node_modules; installing in the worktree (npm ci).' -ForegroundColor Yellow
            npm ci --prefix $web --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        }

        foreach ($script in 'check', 'typecheck', 'test', 'build')
        {
            Write-Host "== npm run $script" -ForegroundColor Cyan
            npm run $script --prefix $web
            if ($LASTEXITCODE -ne 0) { throw "npm run $script failed." }
        }
    }

    $failed = $false
}
finally
{
    if ($link -and (Test-Path $link))
    {
        # NOT Remove-Item -Recurse: that follows the junction and empties the main tree's node_modules.
        [System.IO.Directory]::Delete($link, $false)
    }
    if ($SdkVersion)
    {
        if ($null -ne $savedGlobalJson) { Set-Content -Path $globalJson -Value $savedGlobalJson -NoNewline -Encoding utf8 }
        else { Remove-Item $globalJson -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue

    if (-not $Keep -or $failed)
    {
        git -C $root worktree remove --force $worktree
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove the worktree: git -C `"$root`" worktree remove --force `"$worktree`"" }
    }
}

Write-Host ''
Write-Host "The release gate passed for $($commit.Substring(0, 12))." -ForegroundColor Green
if ($Keep)
{
    Write-Host "The worktree is at $worktree. From there, as the release calls for:"
    Write-Host '    ./build/Deploy-Infrastructure.ps1   (infrastructure changes only)'
    Write-Host '    ./build/Initialize-Database.ps1     (new migrations; asks before switching accounts)'
    Write-Host '    ./build/Publish-Container.ps1'
    Write-Host '    ./build/Test-Deployment.ps1 ; ./build/Check-Logs.ps1'
    Write-Host "Then remove it: git -C `"$root`" worktree remove --force `"$worktree`""
}
