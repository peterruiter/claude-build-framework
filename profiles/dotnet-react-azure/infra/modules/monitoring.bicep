// ===========================================================================
// Log Analytics and Application Insights, in the chosen region.
//
// Application Insights is workspace-based, so its data is stored in the Log
// Analytics workspace, in the same region. Logs carry why something failed and
// never who it failed for (Redact.cs), so a short retention is enough.
// ===========================================================================

@description('Prefix for resource names.')
param namePrefix string

@description('Region. The data stays here.')
param location string

@description('Days logs are kept (30 is included in the price; longer is billed per GB).')
@minValue(30)
@maxValue(730)
param retentionDays int = 30

@description('A daily ingestion cap in GB, so a log storm costs a known amount; -1 for none.')
param dailyQuotaGb int = 1

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionDays
    workspaceCapping: { dailyQuotaGb: dailyQuotaGb }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

@description('Workspace id the Container Apps environment sends logs to.')
output logAnalyticsCustomerId string = logAnalytics.properties.customerId

@description('Shared key for that workspace. Container Apps takes it as a secure parameter.')
#disable-next-line outputs-should-not-contain-secrets
output logAnalyticsKey string = logAnalytics.listKeys().primarySharedKey

@description('Application Insights connection string.')
output appInsightsConnectionString string = appInsights.properties.ConnectionString

@description('Application Insights, which runs the availability tests (alerts.bicep).')
output appInsightsName string = appInsights.name

@description('The workspace, which the log alerts and Check-Logs.ps1 query.')
output logAnalyticsName string = logAnalytics.name
