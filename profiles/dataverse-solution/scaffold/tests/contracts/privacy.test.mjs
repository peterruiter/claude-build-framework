// privacy.json against schema.json: every table and column has a purpose and a category.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, privacy, contractColumns } from './dataverse-lib.mjs';

const purposes = new Map(privacy.purposes.map((p) => [p.id, p]));
const categories = new Set(Object.keys(privacy.categories));
const iso8601 = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?$/;

test('purposes: legal basis, data subjects, retention as an ISO 8601 duration', () => {
  for (const p of privacy.purposes) {
    assert.ok(privacy.legalBases.includes(p.legalBasis), `purpose ${p.id}: legal basis ${p.legalBasis} is not one of ${privacy.legalBases.join(', ')}`);
    assert.ok(p.dataSubjects?.length > 0, `purpose ${p.id}: name the data subjects`);
    assert.match(p.retention, iso8601, `purpose ${p.id}: retention '${p.retention}' must be an ISO 8601 duration such as P7Y or P90D`);
    assert.ok(p.retentionTrigger, `purpose ${p.id}: say when the retention period starts`);
    assert.ok(p.transfersOutsideRegion, `purpose ${p.id}: transfersOutsideRegion ("none" or where and why)`);
  }
});

test('every table in schema.json is in the register, and nothing else', () => {
  const tables = new Set(schema.tables.map((t) => t.logicalName));
  for (const t of tables) assert.ok(privacy.tables[t], `table ${t} is not in privacy.json: add it with its purposes and every column`);
  for (const t of Object.keys(privacy.tables)) assert.ok(tables.has(t), `privacy.json has ${t}, which is not in schema.json`);
});

test('every column has a category; personal data has a purpose and an erasure rule', () => {
  for (const { table, column } of contractColumns()) {
    const entry = privacy.tables[table.logicalName];
    const info = entry?.columns?.[column.logicalName];
    assert.ok(info, `column ${table.logicalName}.${column.logicalName} is not in privacy.json: give it a category ("none" if it holds no personal data)`);
    assert.ok(categories.has(info.category), `${table.logicalName}.${column.logicalName}: category ${info.category} is not one of ${[...categories].join(', ')}`);
    if (info.category === 'special') assert.ok(info.article9Condition, `${table.logicalName}.${column.logicalName}: special category data needs article9Condition`);
    if (info.category === 'criminal') assert.ok(info.nationalLawBasis, `${table.logicalName}.${column.logicalName}: criminal data needs nationalLawBasis`);
  }
  for (const [name, entry] of Object.entries(privacy.tables)) {
    const personal = Object.values(entry.columns ?? {}).some((c) => c.category !== 'none');
    assert.equal(entry.personalData, personal, `${name}: personalData must be ${personal} (it follows from the column categories)`);
    if (personal) {
      assert.ok(entry.purposes?.length > 0, `${name}: holds personal data, so name its purposes`);
      for (const id of entry.purposes) assert.ok(purposes.has(id), `${name}: purpose ${id} is not defined`);
      assert.ok(['delete', 'anonymise', 'retain-legal-hold'].includes(entry.erasure), `${name}: erasure must be delete, anonymise or retain-legal-hold`);
    } else {
      assert.ok(entry.reason || entry.purposes?.length, `${name}: no personal data; give the reason the table exists`);
    }
  }
});

test('audited personal data: the register says what audit history keeps', () => {
  for (const table of schema.tables) {
    const entry = privacy.tables[table.logicalName];
    if (table.audit && entry.personalData) assert.ok(entry.audit, `${table.logicalName} is audited and holds personal data: audit history keeps old values. Say so in "audit" and keep the audit retention within the purpose's retention`);
  }
});
