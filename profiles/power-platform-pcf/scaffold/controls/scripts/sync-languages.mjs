#!/usr/bin/env node
// Makes every control's RESX files match the configured languages (build/contracts/locales.json):
//
//   - a RESX file per configured language (<Control>.<lcid>.resx), created from the source
//     language's file when missing; new strings are marked <comment>untranslated</comment>
//     until a translator replaces them (the check counts them; a release refuses them);
//   - every key of the source file in every language, in the source's order;
//   - counted strings with exactly the plural categories each language needs (CLDR, through
//     Intl.PluralRules on the culture): Polish gets .one/.few/.many, Japanese none;
//   - the manifest's <resx> lines (between the languages markers);
//   - shared/languages.generated.ts (LCID to culture) and each control's
//     strings/fallback.generated.ts (the default language, built into the bundle).
//
// Files for languages no longer configured are listed; pass --prune to delete them.
// Usage: node scripts/sync-languages.mjs [--locales <path>] [--prune] [--dry-run]
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  controlsRoot, countedKeys, fallbackModule, findControls, languagesModule, localesPath, manifestWithLanguages,
  neededCategories, parseResx, pluralPart, readLocales, readManifest, readResx, resxPath, UNTRANSLATED, writeResxText,
} from './lib.mjs';

/** What the files should be, as { path: text }, plus problems that stop the sync. */
export function plan(root = controlsRoot, locales = readLocales(localesPath())) {
  const files = {};
  const problems = [];
  const stale = [];
  const unknown = locales.locales.filter((locale) => !locale.lcid);
  for (const locale of unknown) problems.push(`${locale.code} (${locale.culture}) is not a language Dataverse offers; see scripts/dataverse-languages.json`);
  const seen = new Map();
  for (const locale of locales.locales.filter((one) => one.lcid)) {
    if (seen.has(locale.lcid)) problems.push(`${seen.get(locale.lcid)} and ${locale.code} both map to Dataverse language ${locale.lcid}; offer one of them`);
    seen.set(locale.lcid, locale.code);
  }
  if (!locales.source?.lcid) problems.push(`the source language '${locales.contract.source}' is not configured with a Dataverse language`);
  if (!locales.fallback?.lcid) problems.push(`the default language '${locales.contract.default}' is not configured with a Dataverse language`);
  if (problems.length) return { files, problems, stale };

  files[join(root, 'shared', 'languages.generated.ts')] = languagesModule(locales);

  for (const folder of findControls(root)) {
    const manifest = readManifest(folder);
    const name = manifest.constructor;
    const sourcePath = resxPath(folder, name, locales.source.lcid);
    if (!existsSync(sourcePath)) {
      problems.push(`${relative(root, sourcePath)} is missing: the source language's strings are written first, by hand`);
      continue;
    }
    const source = readResx(sourcePath);
    const counted = countedKeys(source);
    const plain = source.filter((entry) => !pluralPart(entry.key) || !counted.has(pluralPart(entry.key).base));

    for (const locale of locales.locales) {
      const path = resxPath(folder, name, locale.lcid);
      if (locale === locales.source) { files[path] = readFileSync(path, 'utf8'); continue; }
      const existing = new Map((existsSync(path) ? readResx(path) : []).map((entry) => [entry.key, entry]));
      const needed = neededCategories(locale.culture);
      const entries = [];
      for (const entry of plain) {
        const have = existing.get(entry.key);
        entries.push(have ?? { key: entry.key, value: entry.value, comment: UNTRANSLATED });
        if (!counted.has(entry.key)) continue;
        for (const category of needed) {
          const key = `${entry.key}.${category}`;
          const sourceForm = source.find((one) => one.key === key);
          entries.push(existing.get(key) ?? { key, value: (sourceForm ?? entry).value, comment: UNTRANSLATED });
        }
      }
      files[path] = writeResxText(entries);
    }

    const fallbackPath = resxPath(folder, name, locales.fallback.lcid);
    const fallbackEntries = locales.fallback === locales.source ? source : parseResx(files[fallbackPath]);
    files[join(folder, 'strings', 'fallback.generated.ts')] = fallbackModule(name, locales.fallback.lcid, fallbackEntries);
    files[manifest.path] = manifestWithLanguages(manifest.xml, name, locales.locales.map((locale) => locale.lcid));

    const wanted = new Set(locales.locales.map((locale) => `${name}.${locale.lcid}.resx`));
    for (const file of readdirSync(join(folder, 'strings'))) {
      if (file.endsWith('.resx') && !wanted.has(file)) stale.push(join(folder, 'strings', file));
    }
  }
  return { files, problems, stale };
}

function main() {
  const argv = process.argv;
  const dryRun = argv.includes('--dry-run');
  const locales = readLocales(localesPath(argv));
  const { files, problems, stale } = plan(controlsRoot, locales);
  if (problems.length) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }
  let written = 0;
  for (const [path, text] of Object.entries(files)) {
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (before === text) continue;
    written++;
    console.log(`  ${before === null ? 'created' : 'updated'} ${relative(controlsRoot, path)}`);
    if (!dryRun) writeFileSync(path, text);
  }
  for (const path of stale) {
    if (argv.includes('--prune') && !dryRun) { unlinkSync(path); console.log(`  deleted ${relative(controlsRoot, path)}`); }
    else console.log(`  not configured: ${relative(controlsRoot, path)} (run with --prune to delete)`);
  }
  const names = locales.locales.map((locale) => `${locale.code} ${locale.lcid}`).join(', ');
  console.log(`Languages ${names}: ${written} file(s) ${dryRun ? 'would change' : 'changed'}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
