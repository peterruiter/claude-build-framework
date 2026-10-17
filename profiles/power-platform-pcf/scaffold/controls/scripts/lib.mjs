// Shared helpers for the control scripts: controls, manifests, RESX files, languages and plurals.
// Node's own modules only, so the scripts run before `npm ci` too.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const controlsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = 'ControlManifest.Input.xml';
const skip = new Set(['node_modules', 'out', 'obj', 'bin', 'generated', 'tests', 'scripts', '.git']);

/** Every control folder (one with a ControlManifest.Input.xml) under the root, sorted. */
export function findControls(root = controlsRoot) {
  const found = [];
  const walk = (folder) => {
    if (existsSync(join(folder, MANIFEST))) { found.push(folder); return; }
    for (const name of readdirSync(folder)) {
      if (skip.has(name)) continue;
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(root);
  return found.sort();
}

/** The parts of a manifest the scripts need, read with regular expressions (no XML library). */
export function readManifest(folder) {
  const path = join(folder, MANIFEST);
  const xml = readFileSync(path, 'utf8');
  const control = /<control\b([^>]*)>/.exec(xml)?.[1] ?? '';
  const attr = (text, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(text)?.[1];
  const keys = [];
  for (const [, tag] of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?:control|property|data-set|property-set|event)\b([^>]*)>/g)) {
    for (const name of ['display-name-key', 'description-key']) {
      const value = attr(tag, name);
      if (value) keys.push(value);
    }
  }
  const live = xml.replace(/<!--[\s\S]*?-->/g, '');
  return {
    path,
    xml,
    namespace: attr(control, 'namespace'),
    constructor: attr(control, 'constructor'),
    version: attr(control, 'version'),
    controlType: attr(control, 'control-type'),
    keys,
    resx: [...live.matchAll(/<resx\b[^>]*\bpath="([^"]+)"/g)].map((match) => match[1]),
    platformLibraries: Object.fromEntries([...live.matchAll(/<platform-library\b[^>]*\bname="([^"]+)"[^>]*\bversion="([^"]+)"/g)].map((match) => [match[1], match[2]])),
    features: [...live.matchAll(/<uses-feature\b[^>]*\bname="([^"]+)"/g)].map((match) => match[1]),
    externalServices: /<external-service-usage\b[^>]*\benabled="true"/.test(live),
    domains: [...live.matchAll(/<domain>\s*([^<\s]+)\s*<\/domain>/g)].map((match) => match[1]),
  };
}

// ------------------------------------------------------------------ RESX --

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A RESX file as an ordered list of { key, value, comment }. */
export function parseResx(xml) {
  const entries = [];
  for (const [, key, body] of xml.matchAll(/<data\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/data>/g)) {
    const value = /<value>([\s\S]*?)<\/value>/.exec(body)?.[1] ?? '';
    const comment = /<comment>([\s\S]*?)<\/comment>/.exec(body)?.[1];
    entries.push({ key: unescape(key), value: unescape(value), comment: comment === undefined ? undefined : unescape(comment) });
  }
  return entries;
}

export function readResx(path) {
  return parseResx(readFileSync(path, 'utf8'));
}

/** A RESX file with the standard headers, one entry per line (readable diffs). */
export function writeResxText(entries) {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<root>',
    '  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>',
    '  <resheader name="version"><value>2.0</value></resheader>',
    '  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>',
    '  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>',
  ];
  for (const { key, value, comment } of entries) {
    const note = comment ? `<comment>${escape(comment)}</comment>` : '';
    lines.push(`  <data name="${escape(key).replace(/"/g, '&quot;')}" xml:space="preserve"><value>${escape(value)}</value>${note}</data>`);
  }
  lines.push('</root>', '');
  return lines.join('\n');
}

export const UNTRANSLATED = 'untranslated';
export const resxPath = (folder, constructor, lcid) => join(folder, 'strings', `${constructor}.${lcid}.resx`);
export const placeholders = (text) => [...text.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort().join(',');

// ------------------------------------------------------------- languages --

const CATEGORIES = ['zero', 'one', 'two', 'few', 'many'];

/** The CLDR categories besides 'other' that whole numbers 0-200 need in a culture (data-driven). */
export function neededCategories(culture) {
  const rules = new Intl.PluralRules(culture);
  const needed = new Set();
  for (let count = 0; count <= 200; count++) {
    const category = rules.select(count);
    if (category !== 'other') needed.add(category);
  }
  return CATEGORIES.filter((category) => needed.has(category));
}

/** Splits 'grid.count.one' into { base: 'grid.count', category: 'one' }; null for a plain key. */
export function pluralPart(key) {
  const match = /^(.*)\.(zero|one|two|few|many)$/.exec(key);
  return match ? { base: match[1], category: match[2] } : null;
}

/** The base keys of counted strings: those with at least one category key in the source. */
export function countedKeys(entries) {
  const keys = new Set(entries.map((entry) => entry.key));
  return new Set(entries.map((entry) => pluralPart(entry.key)).filter((part) => part && keys.has(part.base)).map((part) => part.base));
}

const dataverseLanguages = JSON.parse(readFileSync(join(controlsRoot, 'scripts', 'dataverse-languages.json'), 'utf8')).languages;

/** The Dataverse language id for a configured language: by culture, then script, then code. */
export function lcidFor(locale) {
  const culture = locale.culture ?? locale.code;
  const parts = culture.split('-');
  const tries = [culture, parts.length > 2 ? `${parts[0]}-${parts[1]}` : null, locale.code].filter(Boolean).map((tag) => tag.toLowerCase());
  for (const tag of tries) {
    const found = dataverseLanguages.find((language) => language.tags.some((one) => one.toLowerCase() === tag));
    if (found) return found.lcid;
  }
  return null;
}

/** build/contracts/locales.json (the framework's language contract), resolved to LCIDs. */
export function readLocales(path) {
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  const locales = contract.locales.map((locale) => ({ ...locale, lcid: lcidFor(locale) }));
  const byCode = (code) => locales.find((locale) => locale.code === code);
  return { path, contract, locales, source: byCode(contract.source), fallback: byCode(contract.default ?? contract.source) };
}

export function localesPath(argv = process.argv) {
  const index = argv.indexOf('--locales');
  if (index > 0 && argv[index + 1]) return resolve(argv[index + 1]);
  return resolve(controlsRoot, '..', 'build', 'contracts', 'locales.json');
}

// ------------------------------------------------------------- generated --

/** shared/languages.generated.ts: LCID to culture for the configured languages. */
export function languagesModule(locales) {
  const lines = [
    '// Generated by scripts/sync-languages.mjs from build/contracts/locales.json. Do not edit by hand:',
    '// change locales.json and run `npm run languages`.',
    '',
    '/** Dataverse language id (LCID) to the culture its strings, plurals and numbers follow. */',
    'export const CULTURES: Readonly<Record<number, string>> = {',
    ...[...locales.locales].sort((a, b) => a.lcid - b.lcid).map((locale) => `  ${locale.lcid}: ${JSON.stringify(locale.culture)},`),
    '};',
    '',
    '/** The default language (locales.json "default"): its strings are the fallback. */',
    `export const DEFAULT_LCID = ${locales.fallback.lcid};`,
    `export const DEFAULT_CULTURE = ${JSON.stringify(locales.fallback.culture)};`,
    '',
    'export function cultureFor(languageId: number): string {',
    '  return CULTURES[languageId] ?? DEFAULT_CULTURE;',
    '}',
    '',
  ];
  return lines.join('\n');
}

/** <Control>/strings/fallback.generated.ts: the default language's strings, built into the bundle. */
export function fallbackModule(constructor, lcid, entries) {
  const lines = [
    `// Generated by scripts/sync-languages.mjs from strings/${constructor}.${lcid}.resx (the default language).`,
    '// Do not edit by hand: change the RESX file and run `npm run languages`.',
    '',
    'export const FALLBACK: Readonly<Record<string, string>> = {',
    ...entries.map((entry) => `  ${JSON.stringify(entry.key)}: ${JSON.stringify(entry.value)},`),
    '};',
    '',
  ];
  return lines.join('\n');
}

/** The manifest with its <resx> lines between the languages markers replaced. */
export function manifestWithLanguages(xml, constructor, lcids) {
  const start = xml.indexOf('<!-- languages');
  const end = xml.indexOf('<!-- /languages -->');
  if (start < 0 || end < 0) throw new Error('the manifest has no <!-- languages ... --> and <!-- /languages --> markers around its <resx> lines');
  const indent = /\n([ \t]*)<!-- languages/.exec(xml)?.[1] ?? '      ';
  const startLineEnd = xml.indexOf('\n', start) + 1;
  const lines = [...lcids].sort((a, b) => a - b).map((lcid) => `${indent}<resx path="strings/${constructor}.${lcid}.resx" version="1.0.0" />\n`);
  return xml.slice(0, startLineEnd) + lines.join('') + indent + xml.slice(end);
}
