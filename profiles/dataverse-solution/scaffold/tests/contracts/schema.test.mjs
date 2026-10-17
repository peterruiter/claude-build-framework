// schema.json against itself, against the project's languages, and against the unpacked
// solutions in source control. A failure says what to change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, prefix, lcids, exists, readJson, readText, readSolutionFile, entityAttributes, contractColumns, lcidOfCulture, element } from './dataverse-lib.mjs';

const columnTypes = new Set(['text', 'email', 'multiline', 'date', 'datetime', 'whole', 'yesno', 'choice', 'lookup']);
const solutionNames = new Set(schema.solutions.map((s) => s.uniqueName));

test('publisher: prefix of 2 to 8 letters and digits, option value prefix in range', () => {
  assert.match(schema.publisher.prefix, /^[a-z][a-z0-9]{1,7}$/, 'prefix: lower case, starts with a letter, 2-8 characters, never "mscrm"');
  assert.ok(!schema.publisher.prefix.startsWith('mscrm'));
  assert.ok(schema.publisher.optionValuePrefix >= 10000 && schema.publisher.optionValuePrefix <= 99999, 'optionValuePrefix is 10000-99999');
});

test('languages: base is listed, every LCID has a culture, every configured locale has its LCID', () => {
  assert.ok(lcids.includes(String(schema.languages.base)), `languages.lcids must include the base language ${schema.languages.base}`);
  for (const lcid of lcids) assert.ok(schema.languages.cultures?.[lcid], `languages.cultures has no culture for ${lcid}`);
  if (exists('build/contracts/locales.json')) {
    const locales = readJson('build/contracts/locales.json');
    for (const locale of locales.locales) {
      const lcid = lcidOfCulture[locale.culture];
      assert.ok(lcid, `locales.json offers ${locale.culture}; add its LCID to lcidOfCulture in dataverse-lib.mjs`);
      assert.ok(lcids.includes(String(lcid)), `locales.json offers ${locale.culture}: add ${lcid} to languages.lcids in schema.json (and enable the language in every environment)`);
    }
  }
});

test('names: every table, column, choice, variable and reference starts with the publisher prefix and is unique', () => {
  const seen = new Set();
  const check = (name, what) => {
    assert.ok(name.toLowerCase().startsWith(prefix), `${what} ${name} must start with ${prefix}`);
    assert.ok(!seen.has(name.toLowerCase()), `${what} ${name} is defined twice`);
    seen.add(name.toLowerCase());
  };
  for (const c of schema.globalChoices ?? []) check(c.name, 'choice');
  for (const t of schema.tables) {
    check(t.schemaName, 'table');
    assert.equal(t.logicalName, t.schemaName.toLowerCase(), `table ${t.schemaName}: logicalName is the schema name in lower case`);
    assert.ok(solutionNames.has(t.solution), `table ${t.schemaName}: solution ${t.solution} is not in solutions[]`);
    const columns = new Set();
    for (const { column } of contractColumns().filter((c) => c.table === t)) {
      assert.ok(column.schemaName.toLowerCase().startsWith(prefix), `column ${t.schemaName}.${column.schemaName} must start with ${prefix}`);
      assert.equal(column.logicalName, column.schemaName.toLowerCase(), `column ${column.schemaName}: logicalName is the schema name in lower case`);
      assert.ok(!columns.has(column.logicalName), `column ${t.schemaName}.${column.schemaName} is defined twice`);
      columns.add(column.logicalName);
    }
  }
  for (const v of schema.environmentVariables ?? []) check(v.schemaName, 'environment variable');
  for (const r of schema.connectionReferences ?? []) check(r.logicalName, 'connection reference');
});

test('columns: known types, choices and lookups point at something that exists', () => {
  const choices = new Set((schema.globalChoices ?? []).map((c) => c.name));
  const tables = new Set(schema.tables.map((t) => t.logicalName));
  for (const t of schema.tables) {
    for (const c of t.columns) {
      assert.ok(columnTypes.has(c.type), `${t.schemaName}.${c.schemaName}: type '${c.type}' is not one of ${[...columnTypes].join(', ')}`);
      if (c.type === 'choice') assert.ok(choices.has(c.globalChoice), `${c.schemaName}: global choice ${c.globalChoice} is not in globalChoices`);
      if (c.type === 'lookup') assert.ok(tables.has(c.target) || !c.target.startsWith(prefix), `${c.schemaName}: lookup target ${c.target} is not a table in schema.json`);
      if (['text', 'email', 'multiline'].includes(c.type)) assert.ok(c.maxLength > 0, `${c.schemaName}: maxLength is required`);
    }
  }
});

test('choices: values in the publisher range, unique, never reused', () => {
  const low = schema.publisher.optionValuePrefix * 10000;
  for (const c of schema.globalChoices ?? []) {
    const values = c.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length, `${c.name}: duplicate option values`);
    for (const v of values) assert.ok(v >= low && v < low + 10000, `${c.name}: option ${v} is outside ${low}-${low + 9999}`);
  }
});

test('labels: every display name, description and option label in every language, at most 500 characters', () => {
  const missing = [];
  const check = (text, where) => {
    for (const lcid of lcids) {
      const value = text?.[lcid];
      if (!value || !String(value).trim()) missing.push(`${where} (${lcid})`);
      else if (String(value).length > 500) missing.push(`${where} (${lcid}) is longer than 500 characters`);
    }
  };
  for (const c of schema.globalChoices ?? []) { check(c.displayName, `choice ${c.name}`); for (const o of c.options) check(o.label, `choice ${c.name} option ${o.value}`); }
  for (const t of schema.tables) {
    for (const field of ['displayName', 'pluralName', 'description']) check(t[field], `table ${t.schemaName} ${field}`);
    for (const { column } of contractColumns().filter((c) => c.table === t)) check(column.displayName, `column ${column.schemaName}`);
  }
  for (const v of schema.environmentVariables ?? []) check(v.displayName, `environment variable ${v.schemaName}`);
  assert.deepEqual(missing, [], 'add the missing translations to schema.json (and import them into development)');
});

test('solutions: the source in git holds what the contract says, with the publisher and VERSION', () => {
  const version = exists('VERSION') ? readText('VERSION').trim() : null;
  for (const solution of schema.solutions) {
    assert.ok(exists(`${solution.folder}/Other/Solution.xml`), `${solution.folder}/Other/Solution.xml is missing: run build/Export-Solution.ps1`);
    const manifest = readSolutionFile(solution, 'Other/Solution.xml');
    assert.equal(element(manifest, 'UniqueName'), solution.uniqueName, `${solution.folder}: UniqueName`);
    assert.equal(element(manifest, 'CustomizationPrefix'), schema.publisher.prefix, `${solution.folder}: publisher prefix`);
    assert.equal(element(manifest, 'Managed'), '0', `${solution.folder}: source control holds the unmanaged solution`);
    const solutionVersion = element(manifest, 'Version');
    if (version) assert.ok(solutionVersion.startsWith(`${version}.`), `${solution.uniqueName} is ${solutionVersion} and VERSION is ${version}: bump the solution in development (Export-Solution.ps1 -SetVersion) or VERSION`);
  }
});

test('tables: every table and column in the contract is in its unpacked solution, with every label', () => {
  for (const table of schema.tables) {
    const solution = schema.solutions.find((s) => s.uniqueName === table.solution);
    const path = `Entities/${table.schemaName}/Entity.xml`;
    assert.ok(exists(`${solution.folder}/${path}`), `${table.schemaName} is not in ${solution.folder}: run New-Schema.ps1 -Apply on development, then Export-Solution.ps1`);
    const attributes = entityAttributes(readSolutionFile(solution, path));
    for (const { column } of contractColumns().filter((c) => c.table === table)) {
      const found = attributes.find((a) => a.logicalName === column.logicalName);
      assert.ok(found, `${table.schemaName}.${column.schemaName} is in schema.json but not in the solution`);
      for (const lcid of lcids) assert.ok(found.labels[lcid], `${table.schemaName}.${column.schemaName} has no ${lcid} label in the solution: import translations in development and export again`);
    }
    for (const custom of attributes.filter((a) => a.custom)) {
      assert.ok(contractColumns().some((c) => c.table === table && c.column.logicalName === custom.logicalName), `${table.schemaName}.${custom.physicalName} is in the solution but not in schema.json: add it to the contract (and privacy.json)`);
    }
  }
});
