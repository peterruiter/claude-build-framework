// roles.json against schema.json: every table has a row, every row names something real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, roles } from './dataverse-lib.mjs';

const tables = new Set(schema.tables.map((t) => t.logicalName));
const solutions = new Set(schema.solutions.map((s) => s.uniqueName));
const privileges = new Set(roles.privileges);
const depths = new Set(roles.depths);

test('roles: unique names, a description, a solution from schema.json', () => {
  const names = roles.roles.map((r) => r.name);
  assert.equal(new Set(names).size, names.length, 'role names must be unique');
  for (const role of roles.roles) {
    assert.ok(role.description?.length > 10, `${role.name}: say in a sentence what the role is for`);
    assert.ok(solutions.has(role.solution), `${role.name}: solution ${role.solution} is not in schema.json`);
    assert.ok(!/system administrator|system customizer|basic user/i.test(role.name), `${role.name}: do not copy or rename platform roles; build a least-privilege role`);
  }
});

test('matrix: only known tables, privileges and depths', () => {
  for (const role of roles.roles) {
    for (const [table, cells] of Object.entries(role.tables)) {
      assert.ok(tables.has(table), `${role.name}: table ${table} is not in schema.json (platform tables go under "platform" as prvXxx names)`);
      for (const [privilege, depth] of Object.entries(cells)) {
        assert.ok(privileges.has(privilege), `${role.name}/${table}: unknown privilege ${privilege}`);
        assert.ok(depths.has(depth), `${role.name}/${table}/${privilege}: depth ${depth} is not one of ${[...depths].join(', ')}`);
      }
      if (Object.keys(cells).some((p) => p !== 'Read')) assert.ok(cells.Read, `${role.name}/${table}: a role that writes must also read`);
    }
    for (const [privilege, depth] of Object.entries(role.platform ?? {})) {
      assert.match(privilege, /^prv[A-Z][A-Za-z]+$/, `${role.name}: platform privilege ${privilege} must be a prv name`);
      assert.ok(depths.has(depth), `${role.name}: ${privilege} depth ${depth}`);
    }
  }
});

test('coverage: every table in schema.json has privileges in at least one role, or a reason in noRole', () => {
  const covered = new Set(roles.roles.flatMap((r) => Object.keys(r.tables)));
  const reasons = Object.keys(roles.noRole ?? {}).filter((k) => !k.startsWith('$'));
  for (const table of tables) {
    assert.ok(covered.has(table) || reasons.includes(table), `table ${table} has no privileges in any role: only administrators would see it. Add it to roles.json (or to noRole with the reason)`);
  }
});

test('delete is rare: no role deletes across the whole organisation', () => {
  for (const role of roles.roles) {
    for (const [table, cells] of Object.entries(role.tables)) {
      assert.notEqual(cells.Delete, 'Global', `${role.name}/${table}: Delete at Global depth; if that is truly needed, record the owner's decision and change this test`);
    }
  }
});
