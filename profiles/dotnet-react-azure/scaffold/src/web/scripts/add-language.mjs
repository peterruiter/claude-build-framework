// ===========================================================================
// Offers a language: adds it to build/contracts/locales.json (in picker order)
// and creates its bundles from the source language's, with every counted key
// in the plural forms its culture needs. scaffold.ps1 calls this for each
// language in -Languages.
//
//   node src/web/scripts/add-language.mjs <code> [culture]
//   node src/web/scripts/add-language.mjs nl
//   node src/web/scripts/add-language.mjs pt pt-PT
//   node src/web/scripts/add-language.mjs --reset nl      offer only nl, and make it the default
//   node src/web/scripts/add-language.mjs --default nl    make nl the default
//
// New bundles hold the SOURCE text, marked nowhere: translate every value
// before the language goes live (an agent or a translator, key by key,
// re-reading the file before each write). Existing bundles are completed, not
// overwritten: missing keys and plural forms are added, nothing is removed.
// The culture's plural rules must be in build/contracts/plurals.json (76
// languages are); check-plurals.mjs verifies them against Intl.
// ===========================================================================
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const contractPath = resolve(root, 'build/contracts/locales.json');
const pluralsPath = resolve(root, 'build/contracts/plurals.json');
const domain = readdirSync(resolve(root, 'src')).find((entry) => entry.endsWith('.Domain'));
if (!domain) throw new Error('No *.Domain project under src/.');
const resources = resolve(root, 'src', domain, 'Localization/Resources');
const categories = ['zero', 'one', 'two', 'few', 'many'];

const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const source = contract.source ?? 'en';
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
const sortLocales = () => {
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  contract.locales.sort((a, b) => collator.compare(a.nativeName, b.nativeName));
};

const args = process.argv.slice(2);
let reset = false;
if (args[0] === '--reset') {
  // Scaffolding: forget every offered language and every bundle but the source's, then add the one given.
  for (const file of readdirSync(resources)) {
    if (file.split('.').at(-2) !== source) unlinkSync(resolve(resources, file));
  }
  contract.locales = [];
  args.shift();
  reset = true;
}

if (args[0] === '--default') {
  if (!contract.locales.some((l) => l.code === args[1])) { console.error(`${args[1]} is not offered; add it first.`); process.exit(1); }
  contract.default = args[1];
  write(contractPath, contract);
  console.log(`The default language is ${args[1]}.`);
  process.exit(0);
}

const [rawCode, rawCulture] = args;
if (!rawCode || !/^[a-z]{2,3}$/.test(rawCode)) { console.error('Usage: add-language.mjs <code> [culture], such as: nl, or pt pt-PT'); process.exit(1); }
const code = rawCode;
const culture = rawCulture ?? new Intl.Locale(code).maximize().baseName.replace(/-[A-Z][a-z]{3}-/, '-');
let canonical;
try { canonical = Intl.getCanonicalLocales(culture)[0]; } catch { console.error(`'${culture}' is not a valid culture.`); process.exit(1); }

const plurals = JSON.parse(readFileSync(pluralsPath, 'utf8')).rules;
if (!plurals[canonical] && !plurals[code]) {
  console.error(`build/contracts/plurals.json has no rules for ${canonical} or ${code}. Add CLDR's cardinal rules for it (unicode.org plurals), then run check-plurals.mjs ${canonical}.`);
  process.exit(1);
}

const englishName = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
const native = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? englishName;
const nativeName = native.charAt(0).toLocaleUpperCase(code) + native.slice(1);

const existing = contract.locales.find((l) => l.code === code);
if (existing) Object.assign(existing, { culture: canonical });
else contract.locales.push({ code, culture: canonical, englishName, nativeName });
sortLocales();
if (reset) contract.default = code;
write(contractPath, contract);

const rules = new Intl.PluralRules(canonical);
const found = new Set(Array.from({ length: 201 }, (_, n) => rules.select(n)));
const needed = categories.filter((c) => found.has(c));

let createdNew = false;
for (const ns of contract.namespaces) {
  const sourceBundle = JSON.parse(readFileSync(resolve(resources, `${ns}.${source}.json`), 'utf8'));
  const target = resolve(resources, `${ns}.${code}.json`);
  if (!existsSync(target) && code !== source) createdNew = true;
  const bundle = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  const result = {};
  for (const [key, value] of Object.entries(sourceBundle)) {
    if (categories.some((c) => key.endsWith(`.${c}`))) continue;
    result[key] = bundle[key] ?? value;
    if (`${key}.one` in sourceBundle) {
      for (const category of needed) {
        // A new form starts as the source's singular for "one" and its plural for the rest.
        result[`${key}.${category}`] = bundle[`${key}.${category}`] ?? (category === 'one' ? sourceBundle[`${key}.one`] : value);
      }
    }
  }
  write(target, result);
}

console.log(`${nativeName} (${code}, ${canonical}) is offered; plural forms ${needed.join(', ') || 'none'} besides other.`);
if (createdNew) console.log(`New bundles hold the ${source} text: translate src/${domain}/Localization/Resources/*.${code}.json before it goes live.`);
