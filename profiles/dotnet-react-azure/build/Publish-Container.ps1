<#
.SYNOPSIS
    Builds the image in Azure Container Registry, points the container app at it, and waits until
    the new revision is healthy.

.DESCRIPTION
    "az acr build" builds the Dockerfile inside the registry: no Docker needed here, and a slow
    connection uploads source rather than layers. The tag is VERSION plus a UTC timestamp, so two
    builds of one version can be told apart and the release record can name the exact image.

    A non-zero exit code from az acr build does not mean the build failed: the client can die while
    printing the streamed log as the build carries on and pushes. So on failure the registry is asked
    whether the tag arrived, and only a run that started after this one and failed counts as failed.

    After the update the script reads back what the app is configured to run (an update can report
    success and keep the previous revision), then polls the newest revision until it is Healthy and
    Running, or fails with the revision's state.

    The first image of a new environment goes through Deploy-Infrastructure.ps1 instead: until then
    the app runs the platform placeholder on port 80 without probes, and only the template puts port
    8080 and the probes back.

.PARAMETER ImageTag
    The tag. Defaults to <VERSION>-<yyyyMMddHHmmss> (UTC).

.PARAMETER SkipBuild
    Deploy a tag already in the registry: to promote an earlier build, or finish after a client crash.

.PARAMETER SkipDeploy
    Build and push only.

.PARAMETER WaitMinutes
    How long to wait for the revision to become healthy. 10 by default.

.EXAMPLE
    ./build/Publish-Container.ps1 -WhatIf

.EXAMPLE
    ./build/Publish-Container.ps1 -SkipBuild -ImageTag 0.1.0-20261017120000
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$')] [string] $ImageTag,
    [switch] $SkipBuild,
    [switch] $SkipDeploy,
    [ValidateRange(1, 60)] [int] $WaitMinutes = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'Profile.psm1') -Force
Initialize-AzCli

$root = Get-RepositoryRoot
$config = Get-ProfileConfig
$sub = Get-ConfigValue $config 'azure.subscriptionId' -Required
$group = Get-ConfigValue $config 'azure.resourceGroup' -Required
$repository = Get-ConfigValue $config 'product.imageRepository' -Required
$dockerfile = Get-ConfigValue $config 'product.dockerfile' -Default 'Dockerfile'
$app = Get-AppName $config

Write-Host "Subscription : $(Assert-AzSubscription -SubscriptionId $sub)"

$registry = az acr list --resource-group $group --subscription $sub --query '[0].name' --output tsv
if (-not $registry) { throw "No container registry in $group. Run Deploy-Infrastructure.ps1 first." }
if (-not $ImageTag) { $ImageTag = "$(Get-RepositoryVersion)-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))" }

Write-Host "Registry     : $registry"
Write-Host "Image        : ${repository}:$ImageTag"
Write-Host "App          : $app"
Write-Host ''

function Test-Tag([string] $tag)
{
    $found = az acr repository show-tags --name $registry --subscription $sub --repository $repository --query "[?@=='$tag'] | [0]" --output tsv 2>$null
    return [bool] $found
}

if (-not $SkipBuild)
{
    if ($PSCmdlet.ShouldProcess("$registry/${repository}:$ImageTag", 'Build the image in the registry'))
    {
        # Noted before the build, so the fallback never mistakes an earlier run's failure for this one's.
        $startedAt = (Get-Date).ToUniversalTime()
        Push-Location $root
        try
        {
            az acr build --registry $registry --subscription $sub --image "${repository}:$ImageTag" --file $dockerfile .
            if ($LASTEXITCODE -ne 0)
            {
                Write-Host ''
                Write-Host 'The build client exited with an error. The registry may still be building; asking it.' -ForegroundColor Yellow
                $deadline = (Get-Date).AddMinutes(30)
                while (-not (Test-Tag $ImageTag) -and (Get-Date) -lt $deadline)
                {
                    $recent = az acr task list-runs --registry $registry --subscription $sub --top 5 `
                        --query "[?startTime >= '$($startedAt.ToString('o'))'] | [0].status" --output tsv
                    if ($recent -and @('Failed', 'Canceled', 'Error', 'Timeout') -contains $recent)
                    {
                        throw "The build failed in the registry ($recent). See: az acr task logs --registry $registry --subscription $sub"
                    }
                    Start-Sleep -Seconds 15
                }
                if (-not (Test-Tag $ImageTag)) { throw 'The image did not reach the registry within thirty minutes.' }
                Write-Host 'The image reached the registry. Continuing.' -ForegroundColor Green
            }
        }
        finally
        {
            Pop-Location
        }
    }
}
elseif (-not (Test-Tag $ImageTag))
{
    throw "There is no image tagged '$ImageTag' in $registry. Run without -SkipBuild."
}

if ($SkipDeploy)
{
    Write-Host "Built. Deploy it with: ./build/Publish-Container.ps1 -SkipBuild -ImageTag $ImageTag"
    return
}

$loginServer = az acr show --name $registry --subscription $sub --query loginServer --output tsv
$image = "$loginServer/${repository}:$ImageTag"

if (-not $PSCmdlet.ShouldProcess($app, "Run $image")) { return }

$current = az containerapp show --name $app --resource-group $group --subscription $sub --query 'properties.template.containers[0].image' --output tsv
if ($LASTEXITCODE -ne 0) { throw "Could not read $app. Run Deploy-Infrastructure.ps1 first." }

if ($current -like 'mcr.microsoft.com/k8se/*')
{
    Write-Host "$app runs the placeholder, so its first image goes through Deploy-Infrastructure.ps1 (port 8080 and the probes)."
    & (Join-Path $PSScriptRoot 'Deploy-Infrastructure.ps1') -ContainerImage $image
}
else
{
    az containerapp update --name $app --resource-group $group --subscription $sub --image $image --output none
    if ($LASTEXITCODE -ne 0)
    {
        # Once more: the first refusal is usually Azure being busy.
        Write-Host 'Refused; trying once more.' -ForegroundColor Yellow
        Start-Sleep -Seconds 10
        az containerapp update --name $app --resource-group $group --subscription $sub --image $image --output none
        if ($LASTEXITCODE -ne 0) { throw "Could not point $app at $image." }
    }
}

# Read back rather than trust the exit code.
$running = az containerapp show --name $app --resource-group $group --subscription $sub --query 'properties.template.containers[0].image' --output tsv
if ($running -ne $image) { throw "$app is configured with $running, not $image. Rerun with -SkipBuild -ImageTag $ImageTag." }

$revision = az containerapp show --name $app --resource-group $group --subscription $sub --query 'properties.latestRevisionName' --output tsv
Write-Host "Waiting for revision $revision to be healthy."
$deadline = (Get-Date).AddMinutes($WaitMinutes)
while ($true)
{
    $state = az containerapp revision show --name $app --resource-group $group --subscription $sub --revision $revision `
        --query '{health:properties.healthState, running:properties.runningState, provisioning:properties.provisioningState}' --output json | ConvertFrom-Json
    Write-Host ("    {0:HH:mm:ss}  health {1}, running {2}, provisioning {3}" -f (Get-Date), $state.health, $state.running, $state.provisioning)
    if ($state.health -eq 'Healthy' -and $state.running -in 'Running', 'RunningAtMaxScale') { break }
    if ($state.provisioning -eq 'Failed' -or $state.running -eq 'Failed') { throw "Revision $revision failed. Look first: ./build/Check-Logs.ps1 -Revision $revision" }
    if ((Get-Date) -gt $deadline) { throw "Revision $revision was not healthy after $WaitMinutes minutes. Look first: ./build/Check-Logs.ps1 -Revision $revision" }
    Start-Sleep -Seconds 15
}

$fqdn = az containerapp show --name $app --resource-group $group --subscription $sub --query 'properties.configuration.ingress.fqdn' --output tsv
Write-Host ''
Write-Host "Deployed $ImageTag as $revision." -ForegroundColor Green
Write-Host '    Next:'
Write-Host "      ./build/Test-Deployment.ps1$(if (-not (Get-ConfigValue $config 'app.publicBaseUrl')) { " -BaseUrl https://$fqdn" })"
Write-Host "      ./build/Check-Logs.ps1 -Revision $revision"
Write-Host "    Record the live image: $ImageTag"
