<#
.SYNOPSIS
    Parses every PowerShell file in the repository and fails on a syntax error. Offline.

.DESCRIPTION
    A script that does not parse fails at the worst moment: during a release, against an
    environment. The quality gate and CI run this first.

.EXAMPLE
    ./build/Test-Scripts.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$files = @(Get-ChildItem -Path $root -Recurse -File -Include *.ps1, *.psm1 | Where-Object { $_.FullName -notmatch '[\\/](node_modules|out|\.git)[\\/]' })
$failed = 0
foreach ($file in $files) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    foreach ($e in @($errors)) {
        Write-Host "    [FAIL] $([System.IO.Path]::GetRelativePath($root, $file.FullName)):$($e.Extent.StartLineNumber) $($e.Message)" -ForegroundColor Red
        $failed++
    }
}
if ($failed -gt 0) { Write-Host "$failed parse error(s) in $($files.Count) file(s)." -ForegroundColor Red; exit 1 }
Write-Host "$($files.Count) PowerShell file(s) parse." -ForegroundColor Green
