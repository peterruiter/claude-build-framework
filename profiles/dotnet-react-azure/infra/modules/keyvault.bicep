// ===========================================================================
// Key Vault: credentials the product holds for others (an integration's client
// secret, an SMTP password), and the key that wraps the ASP.NET key ring.
//
// RBAC rather than access policies: role assignments show up everywhere Azure
// reports on access. Container app secrets can reference a secret here
// (keyVaultUrl + the app's identity) instead of holding the value: see
// containerapps.bicep and the README on carrying secrets over a redeploy.
// ===========================================================================

@description('Region.')
param location string

@description('Prefix for resource names.')
param namePrefix string

@description('Who may read, write and delete secrets: [{ objectId, principalType }]. principalType avoids PrincipalNotFound for a just-created identity.')
param secretsOfficers array = []

@description('Who may only read secrets: the app\'s identity, for Key Vault references.')
param secretsUsers array = []

@description('Who may wrap and unwrap with the data protection key: the app\'s identity.')
param cryptoKeyUsers array = []

@description('Refuse purging before retention ends. Cannot be switched off again; on for production.')
param purgeProtection bool = false

@description('Days a deleted secret can be recovered.')
@minValue(7)
@maxValue(90)
param retentionDays int = 90

var vaultName = take('${namePrefix}-kv-${uniqueString(resourceGroup().id)}', 24)
var secretsOfficer = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
var secretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var cryptoUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424')

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: retentionDays
    enablePurgeProtection: purgeProtection ? true : null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource officers 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in secretsOfficers: {
  scope: vault
  name: guid(vault.id, principal.objectId, secretsOfficer)
  properties: {
    roleDefinitionId: secretsOfficer
    principalId: principal.objectId
    principalType: principal.principalType
  }
}]

resource users 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in secretsUsers: {
  scope: vault
  name: guid(vault.id, principal.objectId, secretsUser)
  properties: {
    roleDefinitionId: secretsUser
    principalId: principal.objectId
    principalType: principal.principalType
  }
}]

// Wrap and unwrap only: the key never leaves the vault, so the key ring in blob storage is useless to
// anybody who can read the blob but not use this key.
resource dataProtectionKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = {
  parent: vault
  name: 'dataprotection'
  properties: {
    kty: 'RSA'
    keySize: 2048
    keyOps: ['wrapKey', 'unwrapKey']
    attributes: { enabled: true }
  }
}

resource cryptoUsers 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in cryptoKeyUsers: {
  scope: dataProtectionKey
  name: guid(dataProtectionKey.id, principal.objectId, cryptoUser)
  properties: {
    roleDefinitionId: cryptoUser
    principalId: principal.objectId
    principalType: principal.principalType
  }
}]

@description('Vault name.')
output vaultName string = vault.name

@description('Vault URI, for KeyVault__Uri and Key Vault references (<uri>secrets/<name>).')
output vaultUri string = vault.properties.vaultUri

@description('The data protection key, for DataProtection__KeyUri.')
output dataProtectionKeyUri string = dataProtectionKey.properties.keyUriWithVersion
