// ===========================================================================
// Availability tests and alert rules, emailed through one action group.
//
// Availability tests come in tiers, because every run is billed (Azure Monitor
// "Standard web test", about 0.0006 USD a run; 3 tests x 3 locations every 10
// minutes is about 39,000 runs, some 25 USD a month):
//   core      the smallest set that says "the product works": the app and its
//             database answering together, and the main page.
//   extended  core plus the secondary surfaces (a second app, API refusals,
//             well-known metadata).
// Each test in availabilityTests carries its tier; testTier picks how many run.
//
// Alert rules read what the platform measures (no SDK needed in the app): the
// container app's requests and restarts, the container's logs in Log Analytics,
// the database's CPU/workers/storage, and Key Vault throttling. Any rule can be
// switched off by name (disabledRules). What each one means and what to look at
// first belongs in the project's STATE.md runbook ("fires when / first look").
//
// Sovereignty: test runs come from the chosen Azure test locations (European by
// default) and only GET public URLs; results are stored in Application Insights
// in the deployment's region. Alert rules and the action group are global
// resources holding configuration only.
// ===========================================================================

@description('Prefix for resource names.')
param namePrefix string

@description('Region of Application Insights and the workspace; the tests and log alerts live there.')
param location string

@description('Who is emailed when an alert fires.')
param alertEmail string

@description('The address the tests call, without a trailing slash: the public address, or the app\'s own host name before a domain is bound.')
param baseUrl string

@description('''
The availability tests: [{ key, name, path, status, text, tier }]. key: short and unique (it names the
resources). path: what is fetched (GET, redirects not followed). status: the expected status code. text:
a string the answer must contain, or empty. tier: core or extended. A test that proves the app AND its
database answer (an endpoint that reads the database) belongs in core: the health probes do not touch it.
''')
param availabilityTests array

@description('Which tests run: core, or extended (core and extended).')
@allowed(['core', 'extended'])
param testTier string = 'core'

@description('Test locations per test, 3 to 5 (Microsoft recommends at least 3; the alert fires when all but two fail).')
@minValue(3)
@maxValue(5)
param testLocationCount int = 3

@description('Seconds between runs of a test from one location.')
@allowed([300, 600, 900])
param testFrequencySeconds int = 600

@description('''
Test locations in order of use (Application Insights population tags). The default is European:
West Europe, North Europe, France Central, France South, UK South. Use locations near your users.
''')
param testLocations array = [
  'emea-nl-ams-azr'
  'emea-gb-db3-azr'
  'emea-fr-pra-edge'
  'emea-ch-zrh-edge'
  'emea-ru-msa-edge'
]

@description('Application Insights, which runs the tests.')
param appInsightsName string

@description('Log Analytics, which holds the container\'s logs.')
param logAnalyticsName string

@description('The container app.')
param appName string

@description('The SQL server and database.')
param sqlServerName string
param sqlDatabaseName string

@description('The Key Vault.')
param vaultName string

@description('Alert rules to leave out, by name: server-errors, restarts, unhealthy, error-spike, sql-cpu, sql-workers, sql-storage, vault-throttled.')
param disabledRules array = []

@description('5xx answers in five minutes before alerting.')
param serverErrorsPer5Minutes int = 20

@description('Error lines (fail:, crit:, exceptions) in the console log in fifteen minutes before alerting.')
param errorLinesPer15Minutes int = 10

@description('Database CPU, workers and storage percentage before alerting.')
param sqlPercent int = 80

var tests = filter(availabilityTests, t => testTier == 'extended' || (t.?tier ?? 'core') == 'core')
var locations = take(testLocations, testLocationCount)
var failedLocationsToAlert = max(2, testLocationCount - 2)
var on = {
  serverErrors: !contains(disabledRules, 'server-errors')
  restarts: !contains(disabledRules, 'restarts')
  unhealthy: !contains(disabledRules, 'unhealthy')
  errorSpike: !contains(disabledRules, 'error-spike')
  vaultThrottled: !contains(disabledRules, 'vault-throttled')
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource app 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: appName
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' existing = {
  name: sqlServerName
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' existing = {
  parent: sqlServer
  name: sqlDatabaseName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: vaultName
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${namePrefix}-alerts'
  location: 'global'
  properties: {
    groupShortName: take(namePrefix, 12)
    enabled: true
    emailReceivers: [
      {
        name: 'owner'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

// ------------------------------------------------------------ availability --

resource webTests 'Microsoft.Insights/webtests@2022-06-15' = [for test in tests: {
  name: '${namePrefix}-${test.key}'
  location: location
  // Ties the test to its Application Insights resource; without it the portal does not show it there.
  tags: {
    'hidden-link:${appInsights.id}': 'Resource'
  }
  kind: 'standard'
  properties: {
    SyntheticMonitorId: '${namePrefix}-${test.key}'
    Name: test.name
    Description: 'GET ${baseUrl}${test.path}, expecting ${test.status}${empty(test.?text ?? '') ? '' : ' and "${test.text}" in the answer'}.'
    Enabled: true
    Kind: 'standard'
    Frequency: testFrequencySeconds
    Timeout: 30
    RetryEnabled: true
    Locations: [for testLocation in locations: { Id: testLocation }]
    Request: {
      RequestUrl: '${baseUrl}${test.path}'
      HttpVerb: 'GET'
      ParseDependentRequests: false
      FollowRedirects: false
    }
    ValidationRules: union({
      ExpectedHttpStatusCode: test.status
      IgnoreHttpStatusCode: false
      // A managed certificate renews itself; a week left means it did not.
      SSLCheck: startsWith(baseUrl, 'https://')
      SSLCertRemainingLifetimeCheck: startsWith(baseUrl, 'https://') ? 7 : null
    }, empty(test.?text ?? '') ? {} : {
      ContentValidation: {
        ContentMatch: test.text
        IgnoreCase: false
        PassIfTextFound: true
      }
    })
  }
}]

resource availabilityAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for (test, i) in tests: {
  name: '${namePrefix}-unavailable-${test.key}'
  location: 'global'
  properties: {
    description: '${test.name} failed from ${failedLocationsToAlert} or more of ${length(locations)} locations.'
    severity: 1
    enabled: true
    scopes: [
      webTests[i].id
      appInsights.id
    ]
    evaluationFrequency: 'PT1M'
    // At least one run per location falls in each window (metric alerts take 5 or 15 minutes, not 10).
    windowSize: testFrequencySeconds == 300 ? 'PT5M' : 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: webTests[i].id
      componentId: appInsights.id
      failedLocationCount: failedLocationsToAlert
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}]

// ----------------------------------------------------------------- the app --

resource serverErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = if (on.serverErrors) {
  name: '${namePrefix}-server-errors'
  location: 'global'
  properties: {
    description: 'More than ${serverErrorsPer5Minutes} requests answered with a 5xx in five minutes.'
    severity: 2
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'ServerErrors'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: ['5xx']
            }
          ]
          operator: 'GreaterThan'
          threshold: serverErrorsPer5Minutes
          timeAggregation: 'Total'
        }
      ]
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}

// A deployment replaces replicas and does not count; a crash, an out-of-memory kill or a failing
// liveness probe does.
resource restarts 'Microsoft.Insights/metricAlerts@2018-03-01' = if (on.restarts) {
  name: '${namePrefix}-restarts'
  location: 'global'
  properties: {
    description: 'A replica restarted: it crashed, ran out of memory or failed its liveness probe.'
    severity: 2
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'Restarts'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'RestartCount'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Maximum'
        }
      ]
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}

// KQL as Bicep reads it: no interpolation inside ''' strings, so names go in with replace().
var unhealthyQuery = replace('''
ContainerAppSystemLogs_CL
| where ContainerAppName_s == "{app}"
| where Reason_s in ("ProbeFailed", "ReplicaUnhealthy", "ContainerCrashing", "BackOff", "ContainerBackOff", "RevisionProvisioningError", "RevisionFailed")
''', '{app}', appName)

// A release makes a few probe failures while the new replica starts; one that stays unhealthy fails its
// readiness probe every fifteen seconds, sixty in a quarter of an hour.
resource unhealthy 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (on.unhealthy) {
  name: '${namePrefix}-unhealthy'
  location: location
  properties: {
    displayName: '${namePrefix}-unhealthy'
    description: 'A revision is unhealthy: more than ten failed probes or unhealthy replicas in fifteen minutes.'
    severity: 1
    enabled: true
    scopes: [workspace.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: unhealthyQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 10
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}

// The console writes "fail: Category[0]" (or crit:) on one line; an exception adds a "Type: message" line.
var errorQuery = replace('''
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "{app}"
| where Log_s startswith "fail:" or Log_s startswith "crit:" or Log_s matches regex @"^\s*[A-Za-z_][\w.]*Exception: "
''', '{app}', appName)

resource errorSpike 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (on.errorSpike) {
  name: '${namePrefix}-error-spike'
  location: location
  properties: {
    displayName: '${namePrefix}-error-spike'
    description: 'More than ${errorLinesPer15Minutes} error lines in the console log in fifteen minutes.'
    severity: 3
    enabled: true
    scopes: [workspace.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: errorQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: errorLinesPer15Minutes
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}

// ------------------------------------------------------------ the database --

// Serverless: percentages of the vCore ceiling. Workers matter most: past 100% SQL refuses new requests.
var sqlCriteria = filter([
  { key: 'cpu', metric: 'cpu_percent', aggregation: 'Average', window: 'PT15M', text: 'CPU' }
  { key: 'workers', metric: 'workers_percent', aggregation: 'Maximum', window: 'PT5M', text: 'workers (concurrent requests)' }
  { key: 'storage', metric: 'storage_percent', aggregation: 'Maximum', window: 'PT1H', text: 'storage (of its maximum size)' }
], c => !contains(disabledRules, 'sql-${c.key}'))

resource sqlAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for criterion in sqlCriteria: {
  name: '${namePrefix}-sql-${criterion.key}'
  location: 'global'
  properties: {
    description: 'The database is above ${sqlPercent}% ${criterion.text}. Raise the vCore ceiling (sqlMaxVCores) before a known peak; for storage, the maximum size.'
    severity: 2
    enabled: true
    scopes: [database.id]
    evaluationFrequency: 'PT5M'
    windowSize: criterion.window
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: criterion.metric
          metricNamespace: 'Microsoft.Sql/servers/databases'
          metricName: criterion.metric
          operator: 'GreaterThan'
          threshold: sqlPercent
          timeAggregation: criterion.aggregation
        }
      ]
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}]

// --------------------------------------------------------------- the vault --

resource vaultThrottled 'Microsoft.Insights/metricAlerts@2018-03-01' = if (on.vaultThrottled) {
  name: '${namePrefix}-vault-throttled'
  location: 'global'
  properties: {
    description: 'Key Vault refused requests with 429 (throttled): secret reads and key operations are failing.'
    severity: 2
    enabled: true
    scopes: [vault.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'Throttled'
          metricNamespace: 'Microsoft.KeyVault/vaults'
          metricName: 'ServiceApiResult'
          dimensions: [
            {
              name: 'StatusCode'
              operator: 'Include'
              values: ['429']
            }
          ]
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Count'
        }
      ]
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}

@description('The action group, for adding receivers by hand.')
output actionGroupName string = actionGroup.name

@description('The availability tests deployed.')
output webTestNames array = [for (test, i) in tests: webTests[i].name]
