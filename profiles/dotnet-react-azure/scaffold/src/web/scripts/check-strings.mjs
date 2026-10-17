// ===========================================================================
// The string bundles, checked before every web build (npm run check):
//
//   * every offered language (build/contracts/locales.json) has a bundle per
//     namespace, valid JSON, with every key of the source language's bundle;
//   * the same {0} placeholders as the source;
//   * every counted key (one with a .one form in the source) in every plural
//     form its culture needs (Intl.PluralRules over 0..200);
//   * no key the source does not have (a typo, or a removed string);
//   * the language list is in picker order (by native name, accents ignored)
//     and the default language is offered.
//
// The server holds the same rules in LocalizationTests; this runs without .NET.
// Exit code 1 with one line per problem.
// ===========================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const contract = JSON.parse(readFileSync(resolve(root, 'build/contracts/locales.json'), 'utf8'));
const resources = resolve(root, 'src', domainFolder(), 'Localization/Resources');
const categories = ['zero', 'one', 'two', 'few', 'many'];
const problems = [];

function domainFolder() {
  // The Domain project's folder, whatever the product is called (scaffold.ps1 renames App.Domain).
  const name = readdirSync(resolve(root, 'src')).find((entry) => entry.endsWith('.Domain'));
  if (!name) throw new Error('No *.Domain project under src/.');
  return name;
}

function load(file) {
  if (!existsSync(file)) { problems.push(`missing ${file.slice(root.length + 1)}`); return null; }
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { problems.push(`${file.slice(root.length + 1)} is not valid JSON: ${error.message}`); return null; }
}

const placeholders = (text) => [...new Set(String(text).match(/\{\d+\}/g) ?? [])].sort().join(',');
const isForm = (key) => categories.some((c) => key.endsWith(`.${c}`));
function needed(culture) {
  const rules = new Intl.PluralRules(culture);
  const found = new Set(Array.from({ length: 201 }, (_, n) => rules.select(n)));
  return categories.filter((c) => found.has(c));
}

const source = contract.source ?? 'en';
if (!contract.locales.some((l) => l.code === contract.default)) problems.push(`the default language '${contract.default}' is not offered`);
const codes = contract.locales.map((l) => l.code);
if (new Set(codes).size !== codes.length) problems.push('a language is listed twice');
const collator = new Intl.Collator('en', { sensitivity: 'base' });
const sorted = [...contract.locales].sort((a, b) => collator.compare(a.nativeName, b.nativeName));
if (sorted.some((l, i) => l.code !== contract.locales[i].code)) problems.push(`locales.json is not in picker order (by native name): ${sorted.map((l) => l.code).join(', ')}`);

for (const ns of contract.namespaces) {
  const english = load(resolve(resources, `${ns}.${source}.json`));
  if (!english) continue;
  const counted = Object.keys(english).filter((k) => k.endsWith('.one')).map((k) => k.slice(0, -4));
  const keys = Object.keys(english).filter((k) => !isForm(k));

  for (const locale of contract.locales) {
    const name = `${ns}.${locale.code}.json`;
    const bundle = load(resolve(resources, name));
    if (!bundle) continue;
    for (const key of keys) {
      if (!(key in bundle)) problems.push(`${name}: missing '${key}'`);
      else if (placeholders(bundle[key]) !== placeholders(english[key])) problems.push(`${name}: '${key}' has placeholders ${placeholders(bundle[key]) || 'none'}, the source has ${placeholders(english[key]) || 'none'}`);
    }
    for (const key of counted) {
      for (const category of needed(locale.culture)) {
        if (!(`${key}.${category}` in bundle)) problems.push(`${name}: '${key}' needs a '${key}.${category}' form in ${locale.culture}`);
      }
    }
    for (const key of Object.keys(bundle)) {
      if (!isForm(key) && !(key in english)) problems.push(`${name}: '${key}' is not in the source bundle`);
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`${problems.length} string problem(s).`);
  process.exit(1);
}
console.log(`Strings: ${contract.locales.length} language(s) x ${contract.namespaces.length} namespace(s) complete.`);
