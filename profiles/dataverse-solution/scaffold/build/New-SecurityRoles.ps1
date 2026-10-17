<#
.SYNOPSIS
    Applies the role matrix in build/contracts/roles.json to a DEVELOPMENT environment: creates
    missing roles in the root business unit, inside their solution, and adds missing privileges
    at the contract's depth.

.DESCRIPTION
    Same three modes as New-Schema.ps1: offline matrix (default), read-only comparison
    (-Environment), changes (-Environment -Apply, host name typed back, development only).

    - Privilege ids differ per environment: they are read at run time and matched by name
      (prvCreate<SchemaName> for a table, or the platform names in the contract). Every page of
      the privilege list is read; one page silently drops the rest.
    - A privilege the contract names at another depth is raised or lowered to the contract.
    - A privilege on the role that the contract does not name is reported as extra and left
      alone, unless -Prune (then it is removed: someone added it by hand, the contract is the
      truth).
    - Run it after every New-Schema.ps1 that added a table: a new table has no privileges in
      any role until this runs, and then nobody but an administrator sees it.

.PARAMETER Environment
    Id in environments.json. Without it, the offline matrix.

.PARAMETER Apply
    Create and change. Without it, nothing is written.

.PARAMETER Prune
    With -Apply: remove privileges the contract does not name.

.EXAMPLE
    ./build/New-SecurityRoles.ps1

.EXAMPLE
    ./build/New-SecurityRoles.ps1 -Environment dev -Apply
#>
[CmdletBinding()]
param(
    [string]$Environment,
    [switch]$Apply,
    [switch]$Prune,
    [string]$ConfirmUrl
)

Import-Module "$PSScriptRoot/Common.psm1" -Force
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$schema = Get-Contract 'schema'
$roles = Get-Contract 'roles'
$api = '/api/data/v9.2'
$schemaNameOf = @{}
foreach ($t in $schema.tables) { $schemaNameOf[$t.logicalName] = $t.schemaName }

function Get-WantedPrivileges {
    # role -> @{ privilegeName = depth }
    param($Role)
    $wanted = [ordered]@{}
    foreach ($table in $Role.tables.PSObject.Properties) {
        $schemaName = if ($schemaNameOf.ContainsKey($table.Name)) { $schemaNameOf[$table.Name] } else { $table.Name }
        foreach ($p in $table.Value.PSObject.Properties) { $wanted["prv$($p.Name)$schemaName"] = $p.Value }
    }
    if ($Role.PSObject.Properties['platform']) { foreach ($p in $Role.platform.PSObject.Properties) { $wanted[$p.Name] = $p.Value } }
    return $wanted
}

Write-Step 'Role matrix from build/contracts/roles.json'
foreach ($role in $roles.roles) {
    Write-Host "    $($role.name)"
    foreach ($table in $role.tables.PSObject.Properties) {
        $cells = ($table.Value.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" }) -join ', '
        Write-Host "      $($table.Name): $cells"
    }
}
if (-not $Environment) { Write-Host ''; Write-Host 'Offline matrix only. Next: -Environment dev, then -Environment dev -Apply.' -ForegroundColor Cyan; return }

$target = Get-EnvironmentConfig -Id $Environment
if ($target.kind -ne 'development') { throw "New-SecurityRoles writes to development only; '$Environment' is $($target.kind). Roles travel in the solution." }
$account = Get-AzAccount -Environment $target
Confirm-Environment -Environment $target -Account $account -Action $(if ($Apply) { 'CHANGE security roles in' } else { 'compare security roles with' }) -Write:$Apply -ConfirmUrl $ConfirmUrl
Connect-Dataverse -Environment $target

$rootBu = (Invoke-Dataverse -Path "$api/businessunits?`$select=businessunitid&`$filter=_parentbusinessunitid_value eq null").value[0].businessunitid
$privilegeId = @{}
foreach ($p in (Get-DataverseAll -Path "$api/privileges?`$select=name,privilegeid")) { $privilegeId[$p.name] = $p.privilegeid }
Write-Host "    $($privilegeId.Count) privileges in this environment" -ForegroundColor DarkGray
$depthOf = @{ '0' = 'Basic'; '1' = 'Local'; '2' = 'Deep'; '3' = 'Global'; 'Basic' = 'Basic'; 'Local' = 'Local'; 'Deep' = 'Deep'; 'Global' = 'Global' }

$changes = 0
foreach ($role in $roles.roles) {
    Write-Step $role.name
    $found = @((Invoke-Dataverse -Path "$api/roles?`$select=roleid,name&`$filter=name eq '$($role.name.Replace("'", "''"))' and _businessunitid_value eq $rootBu").value)
    $roleId = $null
    if ($found.Count -gt 0) { $roleId = $found[0].roleid; Write-Skip 'role exists' }
    elseif ($Apply) {
        $r = Invoke-Dataverse -Method POST -Path "$api/roles" -SolutionName $role.solution -Representation -Body @{ name = $role.name; description = $role.description; 'businessunitid@odata.bind' = "/businessunits($rootBu)" }
        $roleId = $r.roleid
        Write-Ok 'created role'
        $changes++
    }
    else { Write-Host '    [new]  role (not created: no -Apply)' -ForegroundColor Yellow; $changes++ }

    $wanted = Get-WantedPrivileges $role
    $unknown = @($wanted.Keys | Where-Object { -not $privilegeId.ContainsKey($_) })
    if ($unknown.Count -gt 0) { throw "Privileges not in this environment: $($unknown -join ', '). Run New-Schema.ps1 -Apply first, or fix the name in roles.json." }

    $have = @{}
    if ($roleId) {
        $current = Invoke-Dataverse -Path "$api/RetrieveRolePrivilegesRole(RoleId=$roleId)"
        foreach ($rp in @($current.RolePrivileges)) {
            $name = $rp.PrivilegeName
            if (-not $name) { $name = ($privilegeId.GetEnumerator() | Where-Object { $_.Value -eq $rp.PrivilegeId } | Select-Object -First 1).Key }
            if ($name) { $have[$name] = $depthOf["$($rp.Depth)"] }
        }
    }
    $add = @()
    foreach ($name in $wanted.Keys) {
        if ($have[$name] -eq $wanted[$name]) { continue }
        $from = if ($have.ContainsKey($name)) { $have[$name] } else { 'none' }
        Write-Host "    $(if ($Apply) { '[set] ' } else { '[diff]' }) $name $from -> $($wanted[$name])" -ForegroundColor Yellow
        $add += @{ PrivilegeId = $privilegeId[$name]; Depth = $wanted[$name]; BusinessUnitId = $rootBu }
    }
    $extra = @($have.Keys | Where-Object { -not $wanted.Contains($_) })
    foreach ($name in $extra) { Write-Warn "extra privilege on the role, not in the contract: $name ($($have[$name]))$(if ($Prune -and $Apply) { ' - removing' })" }
    $changes += $add.Count
    if ($Apply -and $add.Count -gt 0) {
        # AddPrivilegesRole adds new privileges and replaces the depth of existing ones.
        Invoke-Dataverse -Method POST -Path "$api/roles($roleId)/Microsoft.Dynamics.CRM.AddPrivilegesRole" -Body @{ Privileges = $add } | Out-Null
        Write-Ok "$($add.Count) privilege(s) set"
    }
    if ($Apply -and $Prune) {
        foreach ($name in $extra) { Invoke-Dataverse -Method POST -Path "$api/roles($roleId)/Microsoft.Dynamics.CRM.RemovePrivilegeRole" -Body @{ PrivilegeId = $privilegeId[$name] } | Out-Null; $changes++ }
    }
}

Write-Host ''
if ($Apply) { Write-Host "Applied $changes change(s). Next: ./build/Export-Solution.ps1 (the roles travel in the solution)." -ForegroundColor Cyan }
else { Write-Host "$changes difference(s). Run again with -Apply to make them." -ForegroundColor Cyan }
