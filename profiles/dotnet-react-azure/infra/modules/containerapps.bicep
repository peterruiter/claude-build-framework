// ===========================================================================
// The Container Apps environment and the app: one container serving the API
// and both web apps.
//
// Settings: the template writes the ones it knows (plainEnv below, and the
// project's appSettings) and the secrets it is given (appSecrets). Anything set
// on the running app by hand that the template does not know is passed back in
// by Deploy-Infrastructure.ps1 (carriedEnv, carriedSecrets), so a redeploy never
// silently drops it; the names are printed so they can be added here properly.
// ===========================================================================

@description('Prefix for resource names.')
param namePrefix string

@description('Region of the environment and the app: next to the database, because every request makes database round trips.')
param location string

@description('Added to the environment\'s and the app\'s names, for a side-by-side move to another region.')
param nameSuffix string = ''

@description('Resource id of the identity the app runs as.')
param identityId string

@description('Client id of that identity, so DefaultAzureCredential picks it (AZURE_CLIENT_ID).')
param identityClientId string

@description('Workspace id for the environment\'s logs.')
param logAnalyticsCustomerId string

@description('Shared key for that workspace.')
@secure()
param logAnalyticsKey string

@description('The registry\'s login server.')
param registryServer string

@description('The image to run; empty on a first deployment (the platform placeholder runs until Publish-Container.ps1 builds one).')
param image string = ''

@description('Settings every app built on this profile reads (AppSettings.cs): the database, the public address, the vault and storage.')
param sqlConnectionString string

@description('Site__PublicBaseUrl: empty until the custom domain serves, because setting it redirects every other host name there.')
param publicBaseUrl string = ''

@description('Key Vault URI (KeyVault__Uri), and the base of Key Vault secret references.')
param keyVaultUri string

@description('The data protection key (DataProtection__KeyUri).')
param dataProtectionKeyUri string = ''

@description('The data protection key ring blob (DataProtection__BlobUri).')
param dataProtectionBlobUri string = ''

@description('Blob endpoint (Storage__BlobEndpoint).')
param blobEndpoint string = ''

@description('Application Insights connection string, for an app that sends telemetry.')
param appInsightsConnectionString string = ''

@description('Azure OpenAI endpoint (AzureOpenAI__Endpoint) and deployment (AzureOpenAI__Deployment); empty when not deployed.')
param openAiEndpoint string = ''
param openAiDeployment string = ''

@description('The project\'s own plain settings: [{ name, value }] (environment variable names, __ for :).')
param appSettings array = []

@description('''
The project's secrets: { items: [ { name, env, value } | { name, env, keyVaultSecret } | { name, env, keyVaultUrl } ] }.
value: held by the platform as a container app secret. keyVaultSecret: a reference to <vault>/secrets/<name>,
read by the app's identity at revision start; the value never passes through the deployment. env: the
environment variable that receives it (optional for carried secrets, whose variables come in carriedEnv).
''')
@secure()
param appSecrets object = {}

@description('Environment variables on the running app the template does not write ({ name, value } or { name, secretRef }).')
param carriedEnv array = []

@description('Custom domains as the running app has them: an ingress deployed without them removes them.')
param customDomains array = []

@minValue(0)
param minReplicas int = 1

@minValue(1)
param maxReplicas int = 5

@description('Concurrent requests per replica before another is added. Long-lived connections (SSE, WebSockets) count for as long as they are open: size for them.')
param httpConcurrency int = 100

@description('CPU percentage that adds a replica, for work that is few requests but real CPU.')
param cpuUtilization int = 70

@description('vCPU per replica; pairs with memory: 0.25/0.5Gi, 0.5/1Gi, 1.0/2Gi, 2.0/4Gi.')
param cpu string = '0.5'

@description('Memory per replica.')
param memory string = '1Gi'

// The placeholder listens on 80 and has no health endpoints: probes on 8080 would restart it in a loop.
var placeholder = empty(image)
var startingImage = placeholder ? 'mcr.microsoft.com/k8se/quickstart:latest' : image
var targetPort = placeholder ? 80 : 8080

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env${nameSuffix}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsKey
      }
    }
  }
}

// The names AppSettings.cs (and anything else the app reads) expects. Keep both files in step.
var plainEnv = concat([
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'ConnectionStrings__Database', value: sqlConnectionString }
  { name: 'Site__PublicBaseUrl', value: publicBaseUrl }
  { name: 'KeyVault__Uri', value: keyVaultUri }
  { name: 'DataProtection__KeyUri', value: dataProtectionKeyUri }
  { name: 'DataProtection__BlobUri', value: dataProtectionBlobUri }
  { name: 'Storage__BlobEndpoint', value: blobEndpoint }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
  { name: 'AzureOpenAI__Endpoint', value: openAiEndpoint }
  { name: 'AzureOpenAI__Deployment', value: openAiDeployment }
], appSettings)

var secretItems = appSecrets.?items ?? []
var secrets = map(secretItems, s => !empty(s.?keyVaultSecret ?? '')
  ? { name: s.name, keyVaultUrl: '${keyVaultUri}secrets/${s.keyVaultSecret}', identity: identityId }
  : !empty(s.?keyVaultUrl ?? '')
      ? { name: s.name, keyVaultUrl: s.keyVaultUrl, identity: identityId }
      : { name: s.name, value: s.?value ?? '' })
var secretNames = map(secretItems, s => s.name)
var secretEnv = map(filter(secretItems, s => !empty(s.?env ?? '')), s => { name: s.env, secretRef: s.name })

// Carried variables: the template's own names win, and one pointing at a secret that is not deployed is
// left out rather than failing the revision.
var ownEnvNames = concat(map(plainEnv, e => e.name), map(secretEnv, e => e.name))
var extraEnv = map(
  filter(carriedEnv, e => !contains(ownEnvNames, e.name) && (empty(e.?secretRef ?? '') || contains(secretNames, e.?secretRef ?? ''))),
  e => empty(e.?secretRef ?? '') ? { name: e.name, value: e.?value ?? '' } : { name: e.name, secretRef: e.secretRef })

// Neither probe touches the database: a slow database is not a reason to restart a healthy container.
var probes = placeholder ? [] : [
  {
    type: 'Liveness'
    httpGet: { path: '/health/live', port: 8080 }
    initialDelaySeconds: 10
    periodSeconds: 30
  }
  {
    type: 'Readiness'
    httpGet: { path: '/health/ready', port: 8080 }
    initialDelaySeconds: 5
    periodSeconds: 15
  }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api${nameSuffix}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: secrets
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        customDomains: customDomains
      }
      registries: [
        {
          server: registryServer
          identity: identityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: startingImage
          resources: { cpu: json(cpu), memory: memory }
          env: concat(plainEnv, secretEnv, extraEnv)
          probes: probes
        }
      ]
      scale: {
        // At least one replica: a cold start is a visitor waiting. Every request must work on any
        // replica (no sticky sessions): keys in blob storage, state in the database.
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: string(httpConcurrency) } }
          }
          {
            name: 'cpu'
            custom: {
              type: 'cpu'
              metadata: { type: 'Utilization', value: string(cpuUtilization) }
            }
          }
        ]
      }
    }
  }
}

@description('Where the app is, on the platform\'s host name.')
output url string = 'https://${app.properties.configuration.ingress.fqdn}'

@description('That host name, which a www CNAME points at.')
output fqdn string = app.properties.configuration.ingress.fqdn

@description('The app\'s name.')
output appName string = app.name

@description('The environment\'s name (it holds managed certificates).')
output environmentName string = environment.name

@description('The address an apex A record points at.')
output staticIp string = environment.properties.staticIp

@description('Settings carried over from the running app that the template does not write: add each to the template.')
output carriedSettings array = map(extraEnv, e => e.name)
