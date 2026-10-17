// ===========================================================================
// Blob storage: private containers only, Entra only, soft delete on.
//
// No public blobs and no account keys: the app's identity reads and writes
// through Entra (Storage Blob Data Contributor on this account), and serves
// files itself or hands out short-lived user delegation SAS links. Soft delete
// for blobs and containers means a file or a container deleted or overwritten
// by mistake can be brought back for softDeleteDays (az storage blob undelete,
// az storage container restore; Test-RestoreDrill.ps1 -BlobUndeleteTest proves it).
// ===========================================================================

@description('Region. Locally or zone-redundant storage keeps every copy here.')
param location string

@description('Prefix for resource names.')
param namePrefix string

@description('The identity that reads and writes blobs.')
param identityPrincipalId string

@description('Private containers to create, such as dataprotection (the ASP.NET key ring) and media.')
param containers array = ['dataprotection', 'media']

@description('Days a deleted or overwritten blob, or a deleted container, can be restored.')
@minValue(1)
@maxValue(365)
param softDeleteDays int = 14

@description('Keep previous versions of every blob (more storage, finer recovery).')
param versioning bool = false

@description('LRS and ZRS keep data in the region; GRS/RA-GRS copy it to the paired region.')
@allowed(['Standard_LRS', 'Standard_ZRS', 'Standard_GRS', 'Standard_RAGRS'])
param skuName string = 'Standard_LRS'

// Globally unique, 3-24 lower case letters and digits.
var accountName = take('${toLower(replace(namePrefix, '-', ''))}st${uniqueString(resourceGroup().id)}', 24)

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  sku: { name: skuName }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
    isVersioningEnabled: versioning
  }
}

resource privateContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for name in containers: {
  parent: blobService
  name: name
  properties: {
    publicAccess: 'None'
  }
}]

// Data plane only, scoped to this account: the app reads and writes blobs and does not manage the account.
var blobDataContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource grant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, identityPrincipalId, blobDataContributor)
  properties: {
    roleDefinitionId: blobDataContributor
    principalId: identityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

@description('The account name.')
output accountName string = account.name

@description('The blob endpoint, such as https://<account>.blob.core.windows.net/.')
output blobEndpoint string = account.properties.primaryEndpoints.blob

@description('Where the ASP.NET data protection key ring is kept, when a dataprotection container exists.')
output dataProtectionBlobUri string = contains(containers, 'dataprotection') ? '${account.properties.primaryEndpoints.blob}dataprotection/keys.xml' : ''
