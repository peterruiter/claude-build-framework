// ===========================================================================
// Everything the product runs on, in one resource group, in one region.
//
// Run by build/Deploy-Infrastructure.ps1, which reads profile.config.json,
// carries over what is already deployed (settings, secrets, custom domains,
// the running image, the database administrator, backup retention, alert
// address) and passes the rest from the config. Safe to run again: it
// reconciles rather than recreates.
//
// Data residency: every resource that stores data (database and its backups,
// storage, Key Vault, Log Analytics and Application Insights, the registry,
// Azure OpenAI) is created in `location` (or the database's own region when
// set). EU by default. See the profile README, "Data residency".
// ===========================================================================

targetScope = 'resourceGroup'

@description('Prefix for every resource name: 3-20 lower case letters and digits.')
@minLength(3)
@maxLength(20)
param namePrefix string

@description('The region every resource is created in. An EU region by default; Sweden Central and West Europe offer every service used here.')
param location string = 'swedencentral'

@description('The database\'s region, when the main region is not accepting new SQL servers. Keep it in the same geography.')
param sqlLocation string = location

@description('The container app\'s region: next to the database.')
param containerLocation string = sqlLocation

@description('Suffix on the environment\'s and app\'s names, for a side-by-side move to another region.')
param containerNameSuffix string = ''

// ------------------------------------------------------------------- people --

@description('Object id of the Entra principal (person or group) that administers the database and the vault.')
param administratorObjectId string

@description('Its display name or sign-in name.')
param administratorName string

@allowed(['User', 'Group', 'Application'])
param administratorType string = 'User'

@description('A client IP let through the SQL firewall, so a person can apply migrations.')
param clientIpAddress string = ''

// ---------------------------------------------------------------------- app --

@description('The image to run. Empty on a first deployment; Deploy-Infrastructure.ps1 passes the running one after that.')
param containerImage string = ''

@description('The public address once the domain serves (Site__PublicBaseUrl). Empty before.')
param publicBaseUrl string = ''

@description('The project\'s plain settings: [{ name, value }].')
param appSettings array = []

@description('The project\'s secrets: { items: [ { name, env, value | keyVaultSecret | keyVaultUrl } ] }. See containerapps.bicep.')
@secure()
param appSecrets object = {}

@description('Settings on the running app the template does not write, carried over by Deploy-Infrastructure.ps1.')
param carriedEnv array = []

@description('Custom domains as the running app has them.')
param customDomains array = []

@minValue(0)
param minReplicas int = 1

@minValue(1)
param maxReplicas int = 5

param httpConcurrency int = 100
param cpu string = '0.5'
param memory string = '1Gi'

// ----------------------------------------------------------------- database --

@description('Minutes idle before the database pauses, or -1 for never.')
param sqlAutoPauseMinutes int = -1

@description('vCore floor while running.')
param sqlMinVCores string = '0.5'

@description('vCore ceiling (GP_S_Gen5_<n>).')
@allowed([1, 2, 4, 6, 8, 10, 12, 14, 16])
param sqlMaxVCores int = 1

@description('Days of point-in-time restore (1-35). Deploy-Infrastructure.ps1 never passes less than is set.')
@minValue(1)
@maxValue(35)
param sqlBackupRetentionDays int = 14

@description('Long-term retention: weekly, monthly, yearly (ISO 8601; PT0S keeps none).')
param sqlWeeklyRetention string = 'P4W'
param sqlMonthlyRetention string = 'P6M'
param sqlYearlyRetention string = 'PT0S'

@description('Backup storage redundancy: Local or Zone keeps backups in the region; Geo copies them to the paired region.')
@allowed(['Local', 'Zone', 'Geo'])
param sqlBackupRedundancy string = 'Local'

// --------------------------------------------------------- storage, secrets --

@description('Private blob containers.')
param storageContainers array = ['dataprotection', 'media']

@description('Days deleted blobs and containers can be restored.')
param storageSoftDeleteDays int = 14

@description('Storage redundancy: LRS/ZRS stay in the region.')
@allowed(['Standard_LRS', 'Standard_ZRS', 'Standard_GRS', 'Standard_RAGRS'])
param storageSku string = 'Standard_LRS'

@description('Key Vault purge protection: cannot be switched off once on. On for production.')
param vaultPurgeProtection bool = false

@description('Days logs are kept.')
param logRetentionDays int = 30

// --------------------------------------------------------------- Azure OpenAI --

@description('Deploy an Azure OpenAI account and one model deployment.')
param deployOpenAi bool = false

param openAiDeploymentName string = 'chat'
param openAiModel string = 'gpt-4o-mini'
param openAiModelVersion string = '2024-07-18'

@description('DataZoneStandard: processed within the EU data zone for an EU region. Standard: this region only.')
@allowed(['DataZoneStandard', 'Standard'])
param openAiDeploymentType string = 'DataZoneStandard'

param openAiCapacity int = 10

// ------------------------------------------------------------------ alerts --

@description('Who is emailed when an alert fires. Empty deploys no tests and no alerts.')
param alertEmail string = ''

@description('Availability tests: [{ key, name, path, status, text, tier }] (alerts.bicep).')
param availabilityTests array = [
  { key: 'app-database', name: 'App and database (/api/items)', path: '/api/items?take=1', status: 200, text: '', tier: 'core' }
  { key: 'app', name: 'Main app (/app/)', path: '/app/', status: 200, text: 'id="root"', tier: 'core' }
  { key: 'portal', name: 'Portal (/portal/)', path: '/portal/', status: 200, text: 'id="root"', tier: 'extended' }
]

@allowed(['core', 'extended'])
param testTier string = 'core'

@minValue(3)
@maxValue(5)
param testLocationCount int = 3

@allowed([300, 600, 900])
param testFrequencySeconds int = 600

@description('Test locations in order of use (Application Insights population tags); empty keeps the European default in alerts.bicep.')
param testLocations array = []

@description('Alert rules to leave out by name (alerts.bicep).')
param disabledAlertRules array = []

param serverErrorsPer5Minutes int = 20
param errorLinesPer15Minutes int = 10
param sqlAlertPercent int = 80

// ------------------------------------------------------------------ resources --

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-identity'
  location: location
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    namePrefix: namePrefix
    location: location
    retentionDays: logRetentionDays
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    namePrefix: namePrefix
    location: location
    pullPrincipalId: identity.properties.principalId
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    location: sqlLocation
    namePrefix: namePrefix
    administratorObjectId: administratorObjectId
    administratorName: administratorName
    administratorType: administratorType
    clientIpAddress: clientIpAddress
    autoPauseDelayMinutes: sqlAutoPauseMinutes
    minCapacity: sqlMinVCores
    maxCapacity: sqlMaxVCores
    backupRetentionDays: sqlBackupRetentionDays
    weeklyBackupRetention: sqlWeeklyRetention
    monthlyBackupRetention: sqlMonthlyRetention
    yearlyBackupRetention: sqlYearlyRetention
    backupStorageRedundancy: sqlBackupRedundancy
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    namePrefix: namePrefix
    secretsOfficers: [
      { objectId: administratorObjectId, principalType: administratorType }
    ]
    secretsUsers: [
      { objectId: identity.properties.principalId, principalType: 'ServicePrincipal' }
    ]
    cryptoKeyUsers: [
      { objectId: identity.properties.principalId, principalType: 'ServicePrincipal' }
    ]
    purgeProtection: vaultPurgeProtection
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    namePrefix: namePrefix
    identityPrincipalId: identity.properties.principalId
    containers: storageContainers
    softDeleteDays: storageSoftDeleteDays
    skuName: storageSku
  }
}

module openAi 'modules/openai.bicep' = if (deployOpenAi) {
  name: 'openai'
  params: {
    namePrefix: namePrefix
    location: location
    identityPrincipalId: identity.properties.principalId
    deploymentName: openAiDeploymentName
    modelName: openAiModel
    modelVersion: openAiModelVersion
    deploymentType: openAiDeploymentType
    capacity: openAiCapacity
  }
}

module containers 'modules/containerapps.bicep' = {
  name: 'containerapps'
  params: {
    namePrefix: namePrefix
    location: containerLocation
    nameSuffix: containerNameSuffix
    identityId: identity.id
    identityClientId: identity.properties.clientId
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsKey: monitoring.outputs.logAnalyticsKey
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    registryServer: registry.outputs.loginServer
    image: containerImage
    sqlConnectionString: '${sql.outputs.connectionString}Authentication=Active Directory Default;'
    publicBaseUrl: publicBaseUrl
    keyVaultUri: keyVault.outputs.vaultUri
    dataProtectionKeyUri: keyVault.outputs.dataProtectionKeyUri
    dataProtectionBlobUri: storage.outputs.dataProtectionBlobUri
    blobEndpoint: storage.outputs.blobEndpoint
    openAiEndpoint: deployOpenAi ? openAi!.outputs.endpoint : ''
    openAiDeployment: deployOpenAi ? openAi!.outputs.deploymentName : ''
    appSettings: appSettings
    appSecrets: appSecrets
    carriedEnv: carriedEnv
    customDomains: customDomains
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    httpConcurrency: httpConcurrency
    cpu: cpu
    memory: memory
  }
}

module alerts 'modules/alerts.bicep' = if (!empty(alertEmail)) {
  name: 'alerts'
  params: {
    namePrefix: namePrefix
    location: location
    alertEmail: alertEmail
    baseUrl: empty(publicBaseUrl) ? containers.outputs.url : (endsWith(publicBaseUrl, '/') ? take(publicBaseUrl, max(0, length(publicBaseUrl) - 1)) : publicBaseUrl)
    availabilityTests: availabilityTests
    testTier: testTier
    testLocationCount: testLocationCount
    testFrequencySeconds: testFrequencySeconds
    testLocations: empty(testLocations) ? [
      'emea-nl-ams-azr'
      'emea-gb-db3-azr'
      'emea-fr-pra-edge'
      'emea-ch-zrh-edge'
      'emea-ru-msa-edge'
    ] : testLocations
    appInsightsName: monitoring.outputs.appInsightsName
    logAnalyticsName: monitoring.outputs.logAnalyticsName
    appName: containers.outputs.appName
    sqlServerName: sql.outputs.serverName
    sqlDatabaseName: sql.outputs.databaseName
    vaultName: keyVault.outputs.vaultName
    disabledRules: disabledAlertRules
    serverErrorsPer5Minutes: serverErrorsPer5Minutes
    errorLinesPer15Minutes: errorLinesPer15Minutes
    sqlPercent: sqlAlertPercent
  }
}

@description('Fully qualified SQL server name.')
output sqlServer string = sql.outputs.serverFullyQualifiedDomainName

@description('Database name.')
output sqlDatabase string = sql.outputs.databaseName

@description('Connection string for a person (Initialize-Database.ps1): no secret, Entra authentication.')
output sqlConnectionString string = '${sql.outputs.connectionString}Authentication=Active Directory Default;'

@description('Where the app is, on the platform host name.')
output appUrl string = containers.outputs.url

@description('The container app.')
output appName string = containers.outputs.appName

@description('The Container Apps environment.')
output environmentName string = containers.outputs.environmentName

@description('The registry, for Publish-Container.ps1.')
output registryName string = registry.outputs.name

@description('The identity the app runs as; Grant-DatabaseAccess.ps1 creates its database user.')
output identityName string = identity.name

@description('The Key Vault.')
output keyVaultName string = keyVault.outputs.vaultName

@description('The storage account.')
output storageAccount string = storage.outputs.accountName

@description('The Log Analytics workspace, for Check-Logs.ps1.')
output logAnalyticsName string = monitoring.outputs.logAnalyticsName

@description('The address an apex A record points at.')
output staticIp string = containers.outputs.staticIp

@description('Settings carried over from the running app that the template does not write.')
output carriedSettings array = containers.outputs.carriedSettings
