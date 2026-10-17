// The project template, scaffolded into a scratch folder the way new-project does: its own checks
// pass as shipped and with sample data, and they fail, with a useful message, on the mistakes they
// exist to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, scaffold, node, readJson } from './helpers.mjs';

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

/** The sample project (three languages, Polish plurals, a glossary, three changelog entries). */
function sample() {
  const project = scaffold('sample-project');
  const configPath = join(project.folder, 'build', 'framework.json');
  const config = readJson(configPath);
  config.neverOne = { 'ui:booking.min-guests': 'The minimum is two guests, so the count is never 1.' };
  writeJson(configPath, config);
  return project;
}

test('the template as shipped: checker, contract tests and stand-in tests pass', (t) => {
  const project = scaffold();
  t.after(project.remove);
  const vocabulary = node(project.folder, 'scripts/check-vocabulary.mjs');
  assert.equal(vocabulary.status, 0, vocabulary.out);
  const contracts = node(project.folder, '--test', 'tests/contracts/*.test.mjs');
  assert.equal(contracts.status, 0, contracts.out);
  const standins = node(project.folder, '--test', 'tests/standins/*.test.mjs');
  assert.equal(standins.status, 0, standins.out);
});

test('the sample project passes the checker and the contract tests', (t) => {
  const project = sample();
  t.after(project.remove);
  const vocabulary = node(project.folder, 'scripts/check-vocabulary.mjs');
  assert.equal(vocabulary.status, 0, vocabulary.out);
  assert.match(vocabulary.out, /3 languages/);
  const contracts = node(project.folder, '--test', 'tests/contracts/*.test.mjs');
  assert.equal(contracts.status, 0, contracts.out);
});

test('the checker catches a missing plural form, a placeholder, an avoided term and "1 guests"', (t) => {
  const project = sample();
  t.after(project.remove);
  const polishPath = join(project.folder, 'src', 'strings', 'ui.pl.json');
  const polish = readJson(polishPath);
  delete polish['booking.count.few'];
  polish['booking.greeting'] = 'Witaj <b>{imie}</b>';
  writeJson(polishPath, polish);
  const dutchPath = join(project.folder, 'src', 'strings', 'ui.nl.json');
  writeJson(dutchPath, { ...readJson(dutchPath), 'booking.new': 'Nieuwe reservering' });
  const configPath = join(project.folder, 'build', 'framework.json');
  writeJson(configPath, { ...readJson(configPath), neverOne: {} });

  const result = node(project.folder, 'scripts/check-vocabulary.mjs');
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /'booking\.count' is counted and needs \.few in Polish/);
  assert.match(result.out, /'booking\.greeting' does not carry the same placeholders/);
  assert.match(result.out, /uses "reservering"; the glossary says "boeking"/);
  assert.match(result.out, /'booking\.new' does not use "boeking"/);
  assert.match(result.out, /'booking\.min-guests' .* add 'booking\.min-guests\.one'/);
});

test('the checker and the locales test refuse languages out of picker order, and a missing bundle', (t) => {
  const project = sample();
  t.after(project.remove);
  const localesPath = join(project.folder, 'build', 'contracts', 'locales.json');
  const locales = readJson(localesPath);
  locales.locales.reverse();
  locales.locales.push({ code: 'de', englishName: 'German', nativeName: 'Deutsch', culture: 'de-DE' });
  writeJson(localesPath, locales);
  const result = node(project.folder, 'scripts/check-vocabulary.mjs');
  assert.equal(result.status, 1);
  assert.match(result.out, /not in the order pickers show/);
  assert.match(result.out, /ui\.de\.json is missing, and German is configured/);
  const contracts = node(project.folder, '--test', 'tests/contracts/*.test.mjs');
  assert.notEqual(contracts.status, 0);
  assert.match(contracts.out, /listed by their own names/);
  assert.match(contracts.out, /needs a sentence in de/);
});

test('the changelog test refuses a missing language, a reused id, an unknown area and a bad release', (t) => {
  const project = sample();
  t.after(project.remove);
  const path = join(project.folder, 'build', 'contracts', 'changelog.json');
  const changelog = readJson(path);
  delete changelog.entries[0].text.pl;
  changelog.entries[1].id = 1;
  changelog.entries[1].area = 'nowhere';
  changelog.entries[2].release = 'last tuesday';
  writeJson(path, changelog);
  const result = node(project.folder, '--test', 'tests/contracts/changelog.test.mjs');
  assert.notEqual(result.status, 0);
  for (const expected of [/entry 3 needs a sentence in pl/, /an id is used twice/, /'nowhere', which is not an area/, /release 'last tuesday' is a version/]) assert.match(result.out, expected);
});

test('release-tag sets the release on a range, leaves the rest of the file as it was, and refuses a retag', (t) => {
  const project = sample();
  t.after(project.remove);
  const path = join(project.folder, 'build', 'contracts', 'changelog.json');
  const before = readFileSync(path, 'utf8');
  const tagged = node(project.folder, 'scripts/release-tag.mjs', '--release', '0.2.0', '--from', '2', '--to', '3', '--date', '2026-10-18');
  assert.equal(tagged.status, 0, tagged.out);
  const after = readFileSync(path, 'utf8');
  const changed = after.split('\n').filter((line, index) => line !== before.split('\n')[index]);
  assert.deepEqual(changed.map((line) => line.trim()).sort(), ['"date": "2026-10-18",', '"date": "2026-10-18",', '"release": "0.2.0",', '"release": "0.2.0",']);
  const entries = readJson(path).entries;
  assert.deepEqual(entries.map((entry) => entry.release), ['0.2.0', '0.2.0', '0.1.0']);

  const retag = node(project.folder, 'scripts/release-tag.mjs', '--release', '0.3.0', '--ids', '1');
  assert.equal(retag.status, 1);
  assert.match(retag.out, /already tagged with another release: 1 \(0\.1\.0\)/);
  const none = node(project.folder, 'scripts/release-tag.mjs', '--release', '0.3.0', '--untagged');
  assert.match(none.out, /nothing to tag/);
  const bad = node(project.folder, 'scripts/release-tag.mjs', '--release', 'soon', '--untagged');
  assert.equal(bad.status, 1);
});

test('plural.ts picks the CLDR form per culture, data-driven', async () => {
  const plural = await import(pathToFileURL(join(root, 'templates', 'project', 'src', 'i18n', 'plural.ts')).href);
  assert.deepEqual(plural.neededCategories('pl-PL').sort(), ['few', 'many', 'one']);
  assert.deepEqual(plural.neededCategories('en-GB'), ['one']);
  assert.deepEqual(plural.neededCategories('ar-SA').sort(), ['few', 'many', 'one', 'two', 'zero']);
  const polish = { x: '{0} biletów', 'x.one': '{0} bilet', 'x.few': '{0} bilety', 'x.many': '{0} biletów' };
  const rules = new Intl.PluralRules('pl-PL');
  assert.deepEqual([1, 2, 5, 12, 22, 25, 102].map((count) => plural.translate(polish, {}, 'x', [count], rules)),
    ['1 bilet', '2 bilety', '5 biletów', '12 biletów', '22 bilety', '25 biletów', '102 bilety']);
  assert.equal(plural.countedText({ y: '{0} seats', 'y.one': '{0} seat' }, 'y', [0], new Intl.PluralRules('fr-FR')), '{0} seat', 'French reads 0 as one');
  assert.equal(plural.translate({}, { z: 'Hi {0}' }, 'z', ['Ann'], rules), 'Hi Ann', 'falls back to the fallback bundle');
  assert.equal(plural.translate({}, {}, 'missing.key', [], rules), 'missing.key', 'a missing string shows its key');
});

test('the browser and load scripts are valid JavaScript', () => {
  for (const file of ['tests/a11y/axe-pages.mjs', 'tests/a11y/sign-in.example.mjs', 'tests/load/generate.mjs', 'tests/load/journeys.k6.js']) {
    const result = node(join(root, 'templates', 'project'), '--check', file);
    assert.equal(result.status, 0, `${file}: ${result.out}`);
  }
  for (const file of ['tests/a11y/pages.json', 'tests/a11y/known.json', 'tests/load/journeys.json']) {
    assert.doesNotThrow(() => readJson(join(root, 'templates', 'project', file)), file);
  }
});

test('the languages catalogue is in picker order and every culture has plural rules', () => {
  const catalogue = readJson(join(root, 'templates', 'languages-catalog.json'));
  const names = catalogue.languages.map((language) => language.nativeName);
  assert.deepEqual(names, [...names].sort(new Intl.Collator('en', { sensitivity: 'base' }).compare));
  for (const language of catalogue.languages) assert.ok(Intl.PluralRules.supportedLocalesOf(language.culture).length, language.culture);
});
