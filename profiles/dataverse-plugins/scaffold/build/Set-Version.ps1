<#
.SYNOPSIS
    Sets the release version in VERSION (major.minor.patch), from which every assembly version is derived.

.DESCRIPTION
    Directory.Build.props turns VERSION into:
      AssemblyVersion       major.minor.0.0
      FileVersion           major.minor.patch.<BUILD_NUMBER or 0>
      InformationalVersion  major.minor.patch (traced at the start of every execution)

    patch   Fixes and small changes. The usual bump.
    minor   New behaviour. For a plug-in PACKAGE the assembly version plays no part in upgrades. For a
            classic assembly in a solution a new major.minor is a different assembly to Dataverse: its steps
            stay on the old one until moved. The script says so before it writes.
    major   Breaking changes; same note.

    The Dataverse solution has its own version (pac solution version, or the solution's properties); keep
    it in step with VERSION at release time.

.EXAMPLE
    ./build/Set-Version.ps1 -Bump patch

.EXAMPLE
    ./build/Set-Version.ps1 -Version 1.4.0
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('major', 'minor', 'patch')] [string] $Bump,
    [ValidatePattern('^\d+\.\d+\.\d+$')] [string] $Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$file = Join-Path (Split-Path $PSScriptRoot -Parent) 'VERSION'
$current = [Version](Get-Content $file -Raw).Trim()
if (-not $Bump -and -not $Version) { Write-Host "VERSION is $current"; return }
if ($Bump -and $Version) { throw 'Give -Bump or -Version, not both.' }

$next = if ($Version) { [Version]$Version } else {
    switch ($Bump)
    {
        'major' { [Version]::new($current.Major + 1, 0, 0) }
        'minor' { [Version]::new($current.Major, $current.Minor + 1, 0) }
        'patch' { [Version]::new($current.Major, $current.Minor, $current.Build + 1) }
    }
}
if ($next -le $current) { throw "$next is not after $current." }
if ($next.Major -ne $current.Major -or $next.Minor -ne $current.Minor)
{
    Write-Warning "AssemblyVersion changes to $($next.Major).$($next.Minor).0.0. Fine for a plug-in package; for a classic assembly in a solution, steps stay on the old assembly until moved."
}
if ($PSCmdlet.ShouldProcess($file, "VERSION $current -> $next"))
{
    [System.IO.File]::WriteAllText($file, $next.ToString(3) + "`n")
    Write-Host "VERSION $current -> $next"
}
