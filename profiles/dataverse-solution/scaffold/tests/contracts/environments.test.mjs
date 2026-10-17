// environments.json and deployment-settings/: safe shapes, no secrets, settings that match
// what the solutions contain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { schema, environments, readJson, readText, exists, root, looksSecret } from './dataverse-lib.mjs';

const kinds = new Set(['development', 'build', 'test', 'production']);

test('environments: unique ids, Dataverse URLs, accepts what the kind allows, production needs approval', () => {
  const ids = environments.environments.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'environment ids must be unique');
  assert.match(environments.tenantId, /^[0-9a-f-]{36}$/, 'tenantId is a GUID (the placeholder is fine in git; scripts refuse it)');
  for (const e of environments.environments) {
    assert.ok(kinds.has(e.kind), `${e.id}: kind ${e.kind} is not one of ${[...kinds].join(', ')}`);
    assert.match(e.url, /^https:\/\/[a-z0-9-]+\.crm[0-9]*\.dynamics\.com\/?$/, `${e.id}: url must be a Dataverse organisation URL`);
    const expected = ['test', 'production'].includes(e.kind) ? 'managed' : 'unmanaged';
    assert.equal(e.accepts, expected, `${e.id}: a ${e.kind} environment accepts ${expected} solutions`);
    if (e.kind === 'production') {
      assert.equal(e.requireApproval, true, `${e.id}: production imports need the owner's go (requireApproval: true)`);
      assert.equal(e.managedEnvironment, true, `${e.id}: make production a managed environment (pipelines, solution checker enforcement, backups up to 28 days)`);
    }
    if (e.deploymentSettings) assert.ok(exists(e.deploymentSettings), `${e.id}: ${e.deploymentSettings} does not exist`);
    else assert.ok(!['test', 'production'].includes(e.kind), `${e.id}: a ${e.kind} environment needs a deployment settings file`);
  }
  assert.ok(!/"(clientSecret|password|secret|certificatePassword)"\s*:/i.test(readText('environments.json')), 'environments.json holds no credentials; sign-in is az login / pac auth or a federated credential');
});

test('deployment settings: every environment variable and connection reference in the solutions, nothing extra, no secrets', () => {
  const wantedVariables = (schema.environmentVariables ?? []).map((v) => v.schemaName).sort();
  const wantedReferences = (schema.connectionReferences ?? []).map((r) => r.logicalName).sort();
  const folder = join(root, 'deployment-settings');
  const files = readdirSync(folder).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'deployment-settings/ has no files');
  for (const file of files) {
    const settings = readJson(`deployment-settings/${file}`);
    assert.deepEqual(settings.EnvironmentVariables.map((v) => v.SchemaName).sort(), wantedVariables, `${file}: EnvironmentVariables must list exactly the solution's (regenerate with pac solution create-settings and merge)`);
    assert.deepEqual(settings.ConnectionReferences.map((r) => r.LogicalName).sort(), wantedReferences, `${file}: ConnectionReferences must list exactly the solution's`);
    for (const v of settings.EnvironmentVariables) {
      const definition = schema.environmentVariables.find((d) => d.schemaName === v.SchemaName);
      assert.ok(!looksSecret(v.Value), `${file}: ${v.SchemaName} looks like a secret. Secrets go in Key Vault; the settings file holds the reference /subscriptions/.../vaults/<vault>/secrets/<name>`);
      if (definition.secret) assert.match(v.Value, /^\/subscriptions\/.+\/providers\/Microsoft\.KeyVault\/vaults\/.+\/secrets\/.+$/, `${file}: ${v.SchemaName} is a secret variable; its value is a Key Vault reference`);
      if (definition.required) assert.ok(v.Value !== undefined && v.Value !== '', `${file}: ${v.SchemaName} is required; give it a value for this environment`);
    }
    for (const r of settings.ConnectionReferences) {
      const definition = schema.connectionReferences.find((d) => d.logicalName === r.LogicalName);
      assert.equal(r.ConnectorId, definition.connectorId, `${file}: ${r.LogicalName} connector`);
      assert.match(r.ConnectionId, /^([0-9a-f]{32}|[0-9a-f-]{36})?$/i, `${file}: ${r.LogicalName} ConnectionId is a connection id from the target environment (or empty until it exists)`);
    }
  }
});

test('solution source: the environment variables and connection references in schema.json are in the unpacked solutions', () => {
  for (const v of schema.environmentVariables ?? []) {
    const s = schema.solutions.find((x) => x.uniqueName === v.solution);
    assert.ok(exists(`${s.folder}/environmentvariabledefinitions/${v.schemaName}/environmentvariabledefinition.xml`), `${v.schemaName} is not in ${s.folder}: create it in development and export`);
  }
  for (const r of schema.connectionReferences ?? []) {
    const s = schema.solutions.find((x) => x.uniqueName === r.solution);
    assert.ok(readText(`${s.folder}/Other/Customizations.xml`).includes(`connectionreferencelogicalname="${r.logicalName}"`), `${r.logicalName} is not in ${s.folder}/Other/Customizations.xml`);
  }
});
