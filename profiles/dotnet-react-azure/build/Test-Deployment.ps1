<#
.SYNOPSIS
    Smoke-tests a deployment from the outside: the checks in profile.config.json (smokeChecks).

.DESCRIPTION
    Read-only: registers nobody, changes nothing, needs no sign-in, so it is safe against production
    after every release. Each check prints ok or the reason; the exit code is 1 when one failed.

    Redirects are not followed: once Site__PublicBaseUrl is set, the platform's own host name answers
    with a redirect to the public address, and a test that followed it would report the public address
    as the one it tested. A redirect is reported as what it is.

    Behind a TLS-inspecting corporate proxy (Zscaler and the like) checks can fail with certificate
    errors or reach a cached or blocked page. Run from a network without the proxy, or check by hand
    with curl --resolve <host>:443:<ip> to pin the address and see the real certificate.

.PARAMETER BaseUrl
    The deployment, such as https://www.example.com or http://127.0.0.1:5080. Defaults to
    app.publicBaseUrl in the config.

.EXAMPLE
    ./build/Test-Deployment.ps1 -BaseUrl http://127.0.0.1:5080
#>
[CmdletBinding()]
param(
    [string] $BaseUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
$config = Get-ProfileConfig

if (-not $BaseUrl) { $BaseUrl = Get-ConfigValue $config 'app.publicBaseUrl' }
if (-not $BaseUrl) { throw 'No -BaseUrl and no app.publicBaseUrl in profile.config.json.' }
$base = $BaseUrl.TrimEnd('/')
$checks = @(Get-ConfigValue $config 'smokeChecks.checks' -Required)

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$client = [System.Net.Http.HttpClient]::new($handler)
# Generous: the first request after a deployment can meet a replica still warming up.
$client.Timeout = [TimeSpan]::FromSeconds(60)
$failures = 0

Write-Host "Checking $base"
foreach ($check in $checks)
{
    $name = $check.name
    try
    {
        $response = $client.GetAsync("$base$($check.path)").GetAwaiter().GetResult()
        $status = [int] $response.StatusCode
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $type = "$($response.Content.Headers.ContentType)"
        $problem = $null

        if ($status -ne [int] $check.status)
        {
            $problem = if ($status -in 301, 302, 307, 308) { "redirected to $($response.Headers.Location); test that address instead" } else { "status $status, expected $($check.status)" }
        }
        elseif ($check.PSObject.Properties['contains'] -and $check.contains -and -not $body.Contains([string] $check.contains))
        {
            $problem = "the answer does not contain '$($check.contains)'"
        }
        elseif ($check.PSObject.Properties['contentType'] -and $check.contentType -and -not $type.StartsWith([string] $check.contentType, [StringComparison]::OrdinalIgnoreCase))
        {
            $problem = "served as '$type', expected $($check.contentType)"
        }

        if ($problem) { Write-Host "  FAIL $name : $problem" -ForegroundColor Red; $failures++ }
        else { Write-Host "  ok   $name" -ForegroundColor Green }
    }
    catch
    {
        Write-Host "  FAIL $name : $($_.Exception.GetBaseException().Message)" -ForegroundColor Red
        $failures++
    }
}

Write-Host ''
if ($failures -gt 0)
{
    Write-Host "$failures check(s) failed." -ForegroundColor Red
    exit 1
}

Write-Host 'Every check passed.' -ForegroundColor Green
