// The languages (build/contracts/locales.json): one order for every picker (by each language's own
// name, accents ignored), a known source and fallback, valid cultures, and plural forms picked per
// CLDR category for every configured language (src/i18n/plural.ts, data-driven).
// Run: node --test "tests/contracts/*.test.mjs"   (Node 22.18+ imports plural.ts directly)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const contract = JSON.parse(readFileSync(resolve(root, config.locales ?? 'build/contracts/locales.json'), 'utf8'));
const codes = contract.locales.map((locale) => locale.code);

test('the languages are listed by their own names, accents ignored', () => {
  const names = contract.locales.map((locale) => locale.nativeName);
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  assert.deepEqual(names, [...names].sort(collator.compare), 'locales.json is the one source of the order; nobody re-sorts');
});

test('codes are unique; the source language and the fallback are configured', () => {
  assert.ok(codes.length > 0);
  assert.equal(new Set(codes).size, codes.length, 'every code once');
  assert.ok(codes.includes(contract.source ?? contract.default), `source '${contract.source}' is configured`);
  assert.ok(codes.includes(contract.default), `default '${contract.default}' is configured`);
});

test('every culture is a valid tag that Intl knows', () => {
  for (const locale of contract.locales) {
    assert.doesNotThrow(() => Intl.getCanonicalLocales(locale.culture), `${locale.code}: ${locale.culture}`);
    assert.ok(Intl.PluralRules.supportedLocalesOf(locale.culture).length > 0, `${locale.code}: ${locale.culture} has plural rules`);
    for (const field of ['englishName', 'nativeName']) assert.ok(locale[field]?.trim(), `${locale.code} has ${field}`);
  }
});

const pluralPath = config.pluralModule ? resolve(root, config.pluralModule) : null;
test('a count picks the form its language needs, for every configured language', { skip: !pluralPath || !existsSync(pluralPath) ? 'no pluralModule configured' : false }, async () => {
  const plural = await import(pathToFileURL(pluralPath).href);
  for (const locale of contract.locales) {
    const rules = new Intl.PluralRules(locale.culture);
    const needed = plural.neededCategories(locale.culture);
    const bundle = { k: 'other' };
    for (const category of needed) bundle[`k.${category}`] = category;
    for (let count = 0; count <= 200; count++) {
      const category = rules.select(count);
      const expected = category === 'other' ? undefined : category;
      assert.equal(plural.countedText(bundle, 'k', [count], rules), expected, `${locale.code}: ${count} is '${category}'`);
    }
  }
  // A count already formatted for the reader is still a count; other text is not.
  assert.equal(plural.countIn('1 234'), 1234);
  assert.equal(plural.countIn('12.000'), 12000);
  assert.equal(plural.countIn(3), 3);
  for (const text of ['Anna', '12:30', '1,5', '', undefined]) assert.equal(plural.countIn(text), null, String(text));
  assert.equal(plural.format('{0} of {1}', [2, 5]), '2 of 5');
});
