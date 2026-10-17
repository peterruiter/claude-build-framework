// ===========================================================================
// Azure OpenAI, optional (main.bicep deployOpenAi), with a data-zone deployment.
//
// Data residency: the account lives in the chosen region (stored data: files,
// fine-tuning, batch inputs stay there). Where prompts are PROCESSED depends on
// the deployment type:
//   Standard              in the account's region only
//   DataZoneStandard      anywhere in the data zone of the account's region:
//                         for an EU region, EU member states only
//   GlobalStandard        any Azure region worldwide: not allowed here
// So DataZoneStandard in an EU region is the default: EU-only processing with
// better capacity than one region. Check that the model and version are offered
// as DataZoneStandard in your region before deploying.
//
// Abuse monitoring may keep prompts and completions for up to 30 days, in the
// same geography, unless Microsoft approves modified abuse monitoring for the
// subscription: say so in the privacy statement, or apply for the exemption.
//
// No API keys: disableLocalAuth, and the app's identity gets Cognitive Services
// OpenAI User. The app calls it with DefaultAzureCredential.
// ===========================================================================

@description('Prefix for resource names.')
param namePrefix string

@description('Region of the account: an EU region keeps the data zone in the EU.')
param location string

@description('The identity that calls the model.')
param identityPrincipalId string

@description('Deployment name the app asks for (AzureOpenAI__Deployment).')
param deploymentName string = 'chat'

@description('Model name, such as gpt-4o-mini.')
param modelName string = 'gpt-4o-mini'

@description('Model version, such as 2024-07-18.')
param modelVersion string = '2024-07-18'

@description('Where prompts are processed: DataZoneStandard (EU data zone for an EU region) or Standard (this region only).')
@allowed(['DataZoneStandard', 'Standard'])
param deploymentType string = 'DataZoneStandard'

@description('Capacity in thousands of tokens per minute.')
@minValue(1)
param capacity int = 10

var accountName = '${namePrefix}-openai-${take(uniqueString(resourceGroup().id), 6)}'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: accountName
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: deploymentType
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

var openAiUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')

resource grant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, identityPrincipalId, openAiUser)
  properties: {
    roleDefinitionId: openAiUser
    principalId: identityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

@description('The endpoint (AzureOpenAI__Endpoint).')
output endpoint string = account.properties.endpoint

@description('The deployment name (AzureOpenAI__Deployment).')
output deploymentName string = deployment.name

@description('The account name.')
output accountName string = account.name
