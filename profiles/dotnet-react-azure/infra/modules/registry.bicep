// ===========================================================================
// The container registry, and pull rights for the app's identity.
//
// No admin user: the app pulls as its managed identity. Images are built inside
// the registry (az acr build, build/Publish-Container.ps1), so nobody needs
// Docker and nothing pushes with a password.
// ===========================================================================

@description('Prefix for resource names: lower case letters and digits.')
@minLength(3)
@maxLength(20)
param namePrefix string

@description('Region.')
param location string

@description('Object id of the identity that pulls images.')
param pullPrincipalId string

@description('Basic is enough for one app; Standard adds throughput and retention policies.')
@allowed(['Basic', 'Standard', 'Premium'])
param sku string = 'Basic'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  // Registry names are globally unique, alphanumeric, 5-50 characters: prefix (3-20) + acr + 13.
  name: '${namePrefix}acr${uniqueString(resourceGroup().id, namePrefix)}'
  location: location
  sku: { name: sku }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

var acrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, pullPrincipalId, acrPull)
  properties: {
    roleDefinitionId: acrPull
    principalId: pullPrincipalId
    // Named, so a just-created identity does not fail with PrincipalNotFound while Entra replicates.
    principalType: 'ServicePrincipal'
  }
}

@description('Registry name, for Publish-Container.ps1.')
output name string = registry.name

@description('Login server, for the app\'s image reference.')
output loginServer string = registry.properties.loginServer
