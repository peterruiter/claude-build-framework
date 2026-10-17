#!/usr/bin/env node
// ===========================================================================
// Vocabulary and translation checker. Checks what a compiler cannot: every
// string in every configured language, the same placeholders and markup, the
// plural forms each language needs (CLDR, data-driven), one vocabulary per
// language (glossary), and optionally that every key the code asks for exists.
//
//   node scripts/check-vocabulary.mjs [--config build/framework.json]
//
// Configuration: build/framework.json (found by walking up from the current
// folder). Languages: build/contracts/locales.json. Node's own modules only.
// Exit code 0 = no problems, 1 = problems (listed), 2 = cannot run.
// ===========================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const argv = process.argv.slice(2);
const option = (name) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : undefined; };

function findConfig(start) {
  let folder = resolve(start);
  for (;;) {
    const candidate = join(folder, 'build', 'framework.json');
    if (existsSync(candidate)) return candidate;
    const up = dirname(folder);
    if (up === folder) return null;
    folder = up;
  }
}

const configPath = option('config') ? resolve(option('config')) : findConfig(process.cwd());
if (!configPath || !existsSync(configPath)) {
  console.error('check-vocabulary: no build/framework.json found here or above. Run from the repository, or pass --config.');
  process.exit(2);
}

const readJson = (path, what) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { console.error(`check-vocabulary: cannot read ${what} at ${path}: ${error.message}`); process.exit(2); }
};

const config = readJson(configPath, 'the configuration');
const root = resolve(dirname(configPath), config.root ?? '..');
const at = (path) => resolve(root, path);
const show = (path) => relative(root, path).replaceAll('\\', '/');

const problems = [];
const locales = readJson(at(config.locales ?? 'build/contracts/locales.json'), 'the languages (locales.json)');
const list = Array.isArray(locales.locales) ? locales.locales : [];
const sourceCode = locales.source ?? locales.default ?? list[0]?.code;
const source = list.find((locale) => locale.code === sourceCode);

// ---------------------------------------------------------------------------
// 1. The languages themselves.
// ---------------------------------------------------------------------------
if (list.length === 0) problems.push('locales.json: no languages configured');
const codes = list.map((locale) => locale.code);
for (const code of new Set(codes.filter((code, index) => codes.indexOf(code) !== index))) problems.push(`locales.json: '${code}' is listed twice`);
for (const locale of list) {
  for (const field of ['code', 'englishName', 'nativeName', 'culture']) if (typeof locale[field] !== 'string' || !locale[field].trim()) problems.push(`locales.json: '${locale.code ?? '?'}' has no ${field}`);
  try {
    Intl.getCanonicalLocales(locale.culture);
    if (Intl.PluralRules.supportedLocalesOf(locale.culture).length === 0) problems.push(`locales.json: '${locale.code}' culture ${locale.culture} is not known to this Node's ICU`);
  } catch { problems.push(`locales.json: '${locale.code}' culture '${locale.culture}' is not a valid language tag`); }
}
if (!source) problems.push(`locales.json: the source language '${sourceCode}' is not in the list`);
if (locales.default && !codes.includes(locales.default)) problems.push(`locales.json: the default '${locales.default}' is not in the list`);
{
  const names = list.map((locale) => locale.nativeName ?? '');
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const sorted = [...names].sort(collator.compare);
  if (names.join('|') !== sorted.join('|')) problems.push(`locales.json: not in the order pickers show (by own name, accents ignored): expected ${sorted.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Plural categories, from CLDR via Intl: the categories whole numbers 0..200
// fall into besides "other". Data-driven: no language is hard-coded.
// ---------------------------------------------------------------------------
const categoryCache = new Map();
function neededCategories(culture) {
  if (!categoryCache.has(culture)) {
    let rules;
    try { rules = new Intl.PluralRules(culture); } catch { rules = new Intl.PluralRules('en'); }
    const seen = new Set();
    for (let count = 0; count <= 200; count++) seen.add(rules.select(count));
    seen.delete('other');
    categoryCache.set(culture, [...seen]);
  }
  return categoryCache.get(culture);
}
const pluralSuffix = /\.(zero|one|two|few|many)$/;
const placeholders = (text) => [...String(text).matchAll(/\{+[A-Za-z0-9_:]+\}+/g)].map((match) => match[0]).sort().join('');
const markup = (text) => [...String(text).matchAll(/<\/?[A-Za-z][^>]*>/g)].map((match) => match[0]).sort().join('');

// ---------------------------------------------------------------------------
// 2. The string bundles.
// ---------------------------------------------------------------------------
const sets = Array.isArray(config.strings) ? config.strings : [];
const sourceBundles = new Map(); // namespace -> source bundle (for key usage)
const allBundles = []; // { label, code, bundle } for the glossary
let stringCount = 0;
const identicalAllowed = new Set(config.identicalAllowed ?? []);
const neverOne = config.neverOne ?? {};
const identicalLimit = (record) => Math.ceil(Object.values(record).filter((value) => typeof value === 'string' && /\p{L}/u.test(value)).length * (config.identicalLimit ?? 0.1));
const countsIn = (record, key) => typeof record[key] === 'string' && (/\{0\}/.test(record[key]) || `${key}.one` in record);
const isOptions = (record, key) => `${key}.none` in record;

function bundleFiles(set) {
  const folder = at(set.folder);
  if (!existsSync(folder)) { problems.push(`strings '${set.name ?? set.folder}': folder ${set.folder} does not exist`); return []; }
  const pattern = set.file ?? '{ns}.{code}.json';
  if (!pattern.includes('{ns}')) return [set.name ?? 'strings'];
  if (Array.isArray(set.namespaces)) return set.namespaces;
  if (Array.isArray(locales.namespaces) && set.useContractNamespaces !== false && locales.namespaces.length) return locales.namespaces.map((namespace) => namespace.id);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp('^' + escape(pattern).replace(escape('{ns}'), '(.+)').replace(escape('{code}'), escape(sourceCode)) + '$');
  return readdirSync(folder).map((name) => matcher.exec(name)?.[1]).filter(Boolean);
}

for (const set of sets) {
  const pattern = set.file ?? '{ns}.{code}.json';
  for (const ns of bundleFiles(set)) {
    const fileOf = (code) => join(at(set.folder), pattern.replace('{ns}', ns).replace('{code}', code));
    const label = (code) => show(fileOf(code));
    if (!source) break;
    if (!existsSync(fileOf(sourceCode))) { problems.push(`${label(sourceCode)} is missing (the source language's ${ns} bundle)`); continue; }
    const reference = readJson(fileOf(sourceCode), label(sourceCode));
    sourceBundles.set(ns, reference);
    allBundles.push({ ns, label: label(sourceCode), code: sourceCode, bundle: reference });
    stringCount += Object.keys(reference).length;

    // The source language holds its own counted keys to its own categories.
    const counted = new Set(Object.keys(reference).filter((key) => `${key}.one` in reference && !isOptions(reference, key)));
    for (const key of counted) {
      const absent = neededCategories(source.culture).filter((category) => !(`${key}.${category}` in reference));
      if (absent.length) problems.push(`${label(sourceCode)}: '${key}' is counted and needs ${absent.map((category) => `.${category}`).join(', ')} in ${source.englishName}`);
    }

    // "{0} orders" without .one reads "1 orders" (English source only; neverOne lists the exceptions, with reasons).
    if (config.pluralNounCheck !== false && /^en\b/.test(source.culture ?? sourceCode)) {
      const verbs = new Set('is has was does goes takes gets holds wants needs sees keeps asks starts ends says allows expects offers shares reports runs as this yes ms'.split(' '));
      const noun = /\{0\}(?:\s+(?:more|new|other|free|unread|selected))?\s+(people|[a-z-]+s)\b/g;
      for (const [key, value] of Object.entries(reference)) {
        if (typeof value !== 'string' || pluralSuffix.test(key) || `${key}.one` in reference) continue;
        const counts = [...value.matchAll(noun)].some((match) => !verbs.has(match[1]));
        const listed = `${ns}:${key}`;
        if (listed in neverOne) continue;
        if (counts) problems.push(`${label(sourceCode)}: '${key}' ("${value}") reads "1 ${value.match(noun)?.[0]?.split(/\s+/).pop()}" for one; add '${key}.one' (and every language its forms), or list "${listed}" in neverOne in build/framework.json with the reason`);
      }
    }

    for (const locale of list.filter((one) => one.code !== sourceCode)) {
      if (!existsSync(fileOf(locale.code))) { problems.push(`${label(locale.code)} is missing, and ${locale.englishName} is configured`); continue; }
      const bundle = readJson(fileOf(locale.code), label(locale.code));
      allBundles.push({ ns, label: label(locale.code), code: locale.code, bundle });
      const categories = neededCategories(locale.culture);

      // A plural form the source does not have is not extra when it is a category this language needs.
      const formOf = (key) => {
        const match = key.match(pluralSuffix);
        const base = match ? key.slice(0, -match[0].length) : null;
        return match && base in reference && countsIn(reference, base) && categories.includes(match[1]) ? base : null;
      };
      const missing = Object.keys(reference).filter((key) => !(key in bundle) && !(pluralSuffix.test(key) && !categories.includes(key.match(pluralSuffix)[1]) && counted.has(key.replace(pluralSuffix, ''))));
      const extra = Object.keys(bundle).filter((key) => !(key in reference) && !formOf(key));
      if (missing.length) problems.push(`${label(locale.code)} is missing ${missing.length} string${missing.length === 1 ? '' : 's'} (first: ${missing.slice(0, 3).join(', ')})`);
      if (extra.length) problems.push(`${label(locale.code)} has ${extra.length} key${extra.length === 1 ? '' : 's'} that ${sourceCode} does not have (first: ${extra.slice(0, 3).join(', ')})`);

      const countedHere = new Set(counted);
      for (const key of Object.keys(bundle)) if (!(key in reference) && formOf(key)) countedHere.add(formOf(key));
      for (const key of countedHere) {
        const absent = categories.filter((category) => !(`${key}.${category}` in bundle));
        if (absent.length) problems.push(`${label(locale.code)}: '${key}' is counted and needs ${absent.map((category) => `.${category}`).join(', ')} in ${locale.englishName}`);
        for (const category of categories) {
          const form = bundle[`${key}.${category}`];
          if (form === undefined || `${key}.${category}` in reference) continue;
          if (placeholders(reference[key]) !== placeholders(form)) problems.push(`${label(locale.code)}: '${key}.${category}' does not carry the same placeholders as ${sourceCode}`);
          else if (markup(reference[key]) !== markup(form)) problems.push(`${label(locale.code)}: '${key}.${category}' does not keep the markup of ${sourceCode}`);
        }
      }

      for (const key of Object.keys(reference)) {
        if (!(key in bundle)) continue;
        if (typeof reference[key] !== typeof bundle[key]) problems.push(`${label(locale.code)}: '${key}' is not the same type of value as in ${sourceCode}`);
        else if (placeholders(reference[key]) !== placeholders(bundle[key])) problems.push(`${label(locale.code)}: '${key}' does not carry the same placeholders as ${sourceCode}`);
        else if (markup(reference[key]) !== markup(bundle[key])) problems.push(`${label(locale.code)}: '${key}' does not keep the markup of ${sourceCode}`);
      }

      const identical = Object.keys(reference).filter((key) =>
        typeof reference[key] === 'string' && /\p{L}/u.test(reference[key]) && reference[key] === bundle[key] && !identicalAllowed.has(`${ns}:${key}`));
      if (identical.length > identicalLimit(reference)) problems.push(`${label(locale.code)} has ${identical.length} strings identical to ${sourceCode} (first: ${identical.slice(0, 3).join(', ')}); translate them or list them in identicalAllowed`);
    }
  }
}

// neverOne stays honest: a listed key that now has .one, or is gone, comes off.
for (const listed of Object.keys(neverOne)) {
  const [ns, ...rest] = listed.split(':');
  const key = rest.join(':');
  const reference = sourceBundles.get(ns);
  if (!reference) { problems.push(`framework.json neverOne: '${listed}' names no known namespace`); continue; }
  if (!(key in reference)) problems.push(`framework.json neverOne: '${listed}' is not in the ${sourceCode} bundle; take it off the list`);
  else if (`${key}.one` in reference) problems.push(`framework.json neverOne: '${listed}' has a .one now; take it off the list`);
  if (!String(neverOne[listed] ?? '').trim()) problems.push(`framework.json neverOne: '${listed}' has no reason`);
}

// ---------------------------------------------------------------------------
// 3. What's new: area names, and the glossary below also reads its sentences.
// ---------------------------------------------------------------------------
const changelogPath = config.changelog ? at(config.changelog) : null;
const changelog = changelogPath && existsSync(changelogPath) ? readJson(changelogPath, 'the changelog') : null;
if (changelog && config.changelogAreaKey) {
  const [ns, pattern] = config.changelogAreaKey.includes(':') ? config.changelogAreaKey.split(':') : [null, config.changelogAreaKey];
  const reference = ns ? sourceBundles.get(ns) : Object.assign({}, ...sourceBundles.values());
  for (const area of changelog.areas ?? []) if (!reference || !(pattern.replace('{area}', area) in reference)) problems.push(`changelog: the area '${area}' has no '${pattern.replace('{area}', area)}' string`);
}
if (changelog) {
  for (const entry of changelog.entries ?? []) for (const [code, text] of Object.entries(entry.text ?? {})) allBundles.push({ label: `changelog entry ${entry.id}`, code, bundle: { text } });
}

// ---------------------------------------------------------------------------
// 4. One vocabulary per language.
// ---------------------------------------------------------------------------
const glossaryPath = config.glossary ? at(config.glossary) : null;
const glossary = glossaryPath && existsSync(glossaryPath) ? readJson(glossaryPath, 'the glossary') : { terms: [] };
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (text, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(text)}(?![\\p{L}\\p{N}])`, flags);
const starts = (text) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(text)}`, 'iu');
for (const term of glossary.terms ?? []) {
  for (const [code, variants] of Object.entries(term.avoid ?? {})) {
    for (const variant of variants) {
      const pattern = word(variant);
      for (const { label, code: bundleCode, bundle } of allBundles) {
        if (bundleCode !== code) continue;
        for (const [key, value] of Object.entries(bundle)) {
          if (typeof value === 'string' && pattern.test(value)) problems.push(`${label}: '${key}' uses "${variant}"; the glossary says "${term.text?.[code] ?? '?'}" (${term.id})`);
        }
      }
    }
  }
  if (term.expect && term.text?.[sourceCode]) {
    const inSource = starts(term.text[sourceCode]);
    for (const { ns, label, code, bundle } of allBundles) {
      if (!ns || code === sourceCode) continue;
      const reference = sourceBundles.get(ns);
      const expected = term.stem?.[code] ?? term.text?.[code];
      if (!reference || !expected) continue;
      for (const [key, value] of Object.entries(reference)) {
        if (typeof value !== 'string' || !inSource.test(value) || typeof bundle[key] !== 'string') continue;
        if (!bundle[key].toLowerCase().includes(expected.toLowerCase())) problems.push(`${label}: '${key}' does not use "${expected}" for "${term.text[sourceCode]}" (${term.id})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Optional: every key the code asks for exists in the source language.
// ---------------------------------------------------------------------------
const skip = new Set(['node_modules', 'dist', 'build', 'bin', 'obj', '.git', 'coverage']);
const walk = (folder) => readdirSync(folder).flatMap((name) => {
  if (skip.has(name)) return [];
  const path = join(folder, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
for (const usage of config.keyUsage ?? []) {
  const reference = sourceBundles.get(usage.namespace);
  if (!reference) { problems.push(`framework.json keyUsage: no ${sourceCode} bundle for namespace '${usage.namespace}'`); continue; }
  if (!existsSync(at(usage.folder))) { problems.push(`framework.json keyUsage: folder ${usage.folder} does not exist`); continue; }
  const pattern = new RegExp(usage.pattern ?? "\\bt\\(\\s*'([^'\\s]+)'", 'g');
  const extensions = usage.extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
  for (const file of walk(at(usage.folder)).filter((path) => extensions.some((extension) => path.endsWith(extension)))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 3);
      if (/^\s*\+/.test(after) || key.endsWith('.') || key.endsWith('-')) continue; // built at run time
      if (!(key in reference)) problems.push(`${show(file)}: asks for '${key}', which the ${sourceCode} ${usage.namespace} bundle does not have`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(`vocabulary: ${list.length} language${list.length === 1 ? '' : 's'}, ${sourceBundles.size} namespace${sourceBundles.size === 1 ? '' : 's'}, ${stringCount} source strings, ${(glossary.terms ?? []).length} glossary terms, no problems`);
