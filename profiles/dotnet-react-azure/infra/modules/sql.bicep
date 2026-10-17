// ===========================================================================
// Azure SQL: one logical server and one General Purpose serverless database.
//
// Entra-only authentication: no SQL login, no password anywhere. The app's
// managed identity gets db_datareader and db_datawriter (Grant-DatabaseAccess.ps1);
// a person applies the schema (Initialize-Database.ps1).
//
// Backups: Azure takes them regardless; these settings decide how long they are
// kept and where. Point-in-time restore (PITR) to any second of the last
// backupRetentionDays days, long-term retention (LTR) of weekly/monthly/yearly
// full backups, and the backup storage redundancy. Prove them with
// build/Test-RestoreDrill.ps1.
// ===========================================================================

@description('Region. The database, its backups (Local or Zone redundancy) and its long-term backups stay here.')
param location string

@description('Prefix for resource names. The server name (prefix-sql) is globally unique.')
@minLength(3)
@maxLength(20)
param namePrefix string

@description('Object id of the Entra principal that administers the server: a person or, better, a group.')
param administratorObjectId string

@description('Display name of that principal.')
param administratorName string

@allowed(['User', 'Group', 'Application'])
param administratorType string = 'User'

@description('Largest the database may grow, in bytes: a guard rail, not a target.')
param maxSizeBytes int = 34359738368

@description('Minutes idle before the database pauses, or -1 for never. Pausing saves money and makes the first request after a quiet hour wait about a minute.')
param autoPauseDelayMinutes int = -1

@description('Smallest vCores while running.')
param minCapacity string = '0.5'

// What the ceiling buys (GP serverless Gen5): 1 vCore = 75 concurrent workers, 4 = 300, 8 = 600.
// Past 100% workers SQL refuses new requests (error 10928) instead of queueing them, so raise the
// ceiling before a known peak (and the floor, so the first rush does not wait for it to grow).
@description('Largest vCores: GP_S_Gen5_<this>.')
@allowed([1, 2, 4, 6, 8, 10, 12, 14, 16])
param maxCapacity int = 1

@description('A client IP allowed through the firewall, so a person can apply migrations. Empty adds no rule.')
param clientIpAddress string = ''

@description('Name of that firewall rule; Initialize-Database.ps1 moves this one rule rather than adding one per address.')
param clientFirewallRuleName string = 'AllowDeployingMachine'

@description('Days of point-in-time restore, 1 to 35 (Azure\'s default is 7).')
@minValue(1)
@maxValue(35)
param backupRetentionDays int = 14

@description('Hours between differential backups: 12 or 24. 12 replays at most half a day of log on restore.')
@allowed([12, 24])
param differentialBackupHours int = 12

@description('Weekly long-term backups kept, ISO 8601 (P4W); PT0S keeps none.')
param weeklyBackupRetention string = 'P4W'

@description('Monthly long-term backups kept (P6M); PT0S keeps none.')
param monthlyBackupRetention string = 'P6M'

@description('Yearly long-term backups kept (P5Y); PT0S keeps none.')
param yearlyBackupRetention string = 'PT0S'

@description('Which week\'s backup is the yearly one, 1-52.')
@minValue(1)
@maxValue(52)
param yearlyBackupWeek int = 1

@description('''
Where backups are stored. Local and Zone keep every copy in the database's region; Geo replicates to the
paired region (which may be outside the country, though for EU regions it stays in Europe) and allows a
geo-restore after a regional outage. Choose consciously: data residency versus regional disaster recovery.
''')
@allowed(['Local', 'Zone', 'Geo'])
param backupStorageRedundancy string = 'Local'

var serverName = '${namePrefix}-sql'
var databaseName = '${namePrefix}-db'

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: serverName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: administratorName
      sid: administratorObjectId
      principalType: administratorType
      tenantId: subscription().tenantId
    }
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: maxCapacity
  }
  properties: {
    autoPauseDelay: autoPauseDelayMinutes
    minCapacity: json(minCapacity)
    maxSizeBytes: maxSizeBytes
    requestedBackupStorageRedundancy: backupStorageRedundancy
    zoneRedundant: false
  }
}

resource shortTermBackups 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01-preview' = {
  parent: database
  name: 'default'
  properties: {
    retentionDays: backupRetentionDays
    diffBackupIntervalInHours: differentialBackupHours
  }
}

// After the short-term policy: a database takes one change to its backups at a time.
resource longTermBackups 'Microsoft.Sql/servers/databases/backupLongTermRetentionPolicies@2023-08-01-preview' = {
  parent: database
  name: 'default'
  properties: {
    weeklyRetention: weeklyBackupRetention
    monthlyRetention: monthlyBackupRetention
    yearlyRetention: yearlyBackupRetention
    weekOfYear: yearlyBackupWeek
  }
  dependsOn: [shortTermBackups]
}

// Lets the container app reach the database without a virtual network. 0.0.0.0 is Azure's convention
// for "Azure services", not the internet. For a private network instead, add a VNet-integrated
// Container Apps environment and a private endpoint, and set publicNetworkAccess to Disabled.
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource allowClient 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (!empty(clientIpAddress)) {
  parent: sqlServer
  name: clientFirewallRuleName
  properties: {
    startIpAddress: clientIpAddress
    endIpAddress: clientIpAddress
  }
}

@description('Fully qualified server name.')
output serverFullyQualifiedDomainName string = sqlServer.properties.fullyQualifiedDomainName

@description('Server name.')
output serverName string = sqlServer.name

@description('Database name.')
output databaseName string = database.name

@description('Connection string with no secret in it: authentication is Entra.')
output connectionString string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${database.name};Encrypt=True;TrustServerCertificate=False;Connection Timeout=60;'
