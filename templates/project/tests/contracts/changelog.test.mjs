// What's new (build/contracts/changelog.json): every entry in every configured language and no
// other, numbered once, under a known area, dated, released or not yet (null), one sentence each.
// Run: node --test "tests/contracts/*.test.mjs"   (Node's own modules only)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import test from 'node:test';

function findConfig(start) {
  let folder = resolve(start);
  for (;;) {
    const candidate = join(folder, 'build', 'framework.json');
    if (existsSync(candidate)) return candidate;
    const up = dirname(folder);
    if (up === folder) throw new Error('No build/framework.json here or above; run the tests from the repository.');
    folder = up;
  }
}

const configPath = findConfig(process.env.FRAMEWORK_ROOT ?? process.cwd());
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const root = resolve(dirname(configPath), config.root ?? '..');
const locales = JSON.parse(readFileSync(resolve(root, config.locales ?? 'build/contracts/locales.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(resolve(root, config.changelog ?? 'build/contracts/changelog.json'), 'utf8'));
const languages = locales.locales.map((locale) => locale.code);
const releasePattern = new RegExp(config.releasePattern ?? '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$');

test('the contract has its name, its areas and a list of entries', () => {
  assert.equal(changelog.contract, 'changelog');
  assert.ok(Array.isArray(changelog.areas) && changelog.areas.length > 0, 'areas is a non-empty list');
  assert.equal(new Set(changelog.areas).size, changelog.areas.length, 'every area is listed once');
  for (const area of changelog.areas) assert.match(area, /^[a-z][a-z0-9-]*$/, `area '${area}' is a lower-case word`);
  assert.ok(Array.isArray(changelog.entries), 'entries is a list');
});

test('every entry speaks every configured language, and no other', () => {
  assert.ok(languages.length > 0, 'locales.json lists languages');
  for (const entry of changelog.entries) {
    for (const code of languages) {
      const text = entry.text?.[code];
      assert.ok(typeof text === 'string' && text.trim().length > 0, `entry ${entry.id} needs a sentence in ${code}`);
    }
    for (const code of Object.keys(entry.text ?? {})) assert.ok(languages.includes(code), `entry ${entry.id} has '${code}', which is not configured`);
  }
});

test('entries are numbered once, newest first', () => {
  const ids = changelog.entries.map((entry) => entry.id);
  for (const id of ids) assert.ok(Number.isInteger(id) && id > 0, `id ${id} is a positive whole number`);
  assert.equal(new Set(ids).size, ids.length, `an id is used twice: ${ids.filter((id, index) => ids.indexOf(id) !== index).join(', ')}`);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'entries are kept newest first (highest id first)');
});

test('every entry is under a known area', () => {
  for (const entry of changelog.entries) assert.ok(changelog.areas.includes(entry.area), `entry ${entry.id} is under '${entry.area}', which is not an area`);
});

test('every entry is dated and either released (a version) or not yet (null)', () => {
  for (const entry of changelog.entries) {
    assert.match(entry.date ?? '', /^\d{4}-\d{2}-\d{2}$/, `entry ${entry.id} has a yyyy-MM-dd date`);
    assert.ok(!Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`)), `entry ${entry.id}'s date is a real day`);
    assert.ok('release' in entry, `entry ${entry.id} has a release field (null until released)`);
    if (entry.release !== null) assert.match(entry.release, releasePattern, `entry ${entry.id}'s release '${entry.release}' is a version`);
  }
});

test('each text is one sentence', () => {
  for (const entry of changelog.entries) {
    for (const [code, text] of Object.entries(entry.text ?? {})) {
      assert.ok(!/\n/.test(text), `entry ${entry.id} in ${code} is one line`);
      assert.match(text.trim(), /[.!?。！？؟।]["'”»’)]?$/u, `entry ${entry.id} in ${code} ends like a sentence`);
    }
  }
});
