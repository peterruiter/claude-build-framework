#!/usr/bin/env node
// The control checks of the quality gate. For every control (folder with a manifest):
//
//   languages   a RESX file per configured language, listed in the manifest, none extra;
//               the same keys and placeholders as the source; counted strings with exactly the
//               plural categories each language needs; every manifest key present; no empty value;
//               generated files (languages, fallback) current
//   untranslated  strings still marked untranslated: a warning, an error with --strict (releases)
//   manifest    a semantic version; platform libraries matching package.json (the versions the
//               build and the tests use are the versions the manifest asks the platform for)
//   features    context.webAPI, context.utils, context.device.* used only when declared
//   privacy     no network calls (fetch, XMLHttpRequest, WebSocket, sendBeacon, EventSource) and no
//               external domains unless the manifest declares external-service-usage AND
//               external-services.json records the owner's decision for each domain
//
// Usage: node scripts/check-controls.mjs [--strict] [--locales <path>]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  controlsRoot, countedKeys, findControls, localesPath, neededCategories, placeholders, pluralPart,
  readLocales, readManifest, readResx, resxPath, UNTRANSLATED,
} from './lib.mjs';
import { plan } from './sync-languages.mjs';

const NETWORK = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+WebSocket\b/, 'WebSocket'],
  [/\bsendBeacon\b/, 'navigator.sendBeacon'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bimportScripts\b/, 'importScripts'],
];
const FEATURES = [
  [/\bcontext\.webAPI\b|\bwebAPI\./, 'WebAPI'],
  [/\bcontext\.utils\b/, 'Utility'],
];

function sources(folder) {
  const files = [];
  for (const name of readdirSync(folder)) {
    if (['node_modules', 'generated', 'out'].includes(name)) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) files.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export function checkProject(root = controlsRoot, { strict = false, locales = readLocales(localesPath()) } = {}) {
  const errors = [];
  const warnings = [];
  const rel = (path) => relative(root, path).replaceAll('\\', '/');

  const synced = plan(root, locales);
  errors.push(...synced.problems);
  if (synced.problems.length) return { errors, warnings, controls: 0 };

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const decisionsPath = join(root, 'external-services.json');
  const decisions = existsSync(decisionsPath) ? JSON.parse(readFileSync(decisionsPath, 'utf8')).services ?? [] : [];
  const sharedSources = existsSync(join(root, 'shared')) ? sources(join(root, 'shared')) : [];
  const controls = findControls(root);

  for (const folder of controls) {
    const manifest = readManifest(folder);
    const name = manifest.constructor;
    const where = rel(folder);

    // ---- manifest
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) errors.push(`${where}: version '${manifest.version}' is not MAJOR.MINOR.PATCH`);
    const react = manifest.platformLibraries.React;
    const fluent = manifest.platformLibraries.Fluent;
    if (manifest.controlType === 'virtual' && !react) errors.push(`${where}: a virtual control declares <platform-library name="React">`);
    if (react && react !== pkg.dependencies?.react) errors.push(`${where}: the manifest asks the platform for React ${react}, package.json builds and tests with ${pkg.dependencies?.react}`);
    if (fluent && fluent !== pkg.dependencies?.['@fluentui/react-components']) errors.push(`${where}: the manifest asks the platform for Fluent ${fluent}, package.json builds and tests with ${pkg.dependencies?.['@fluentui/react-components']}`);

    // ---- languages
    const sourcePath = resxPath(folder, name, locales.source.lcid);
    const source = readResx(sourcePath);
    const sourceKeys = new Set(source.map((entry) => entry.key));
    const counted = countedKeys(source);
    for (const key of manifest.keys) if (!sourceKeys.has(key)) errors.push(`${where}: the manifest key '${key}' is not in ${rel(sourcePath)}`);

    const listed = new Set(manifest.resx.map((path) => path.replace(/^strings\//, '')));
    const wanted = new Set(locales.locales.map((locale) => `${name}.${locale.lcid}.resx`));
    for (const file of wanted) if (!listed.has(file)) errors.push(`${where}: ${file} is not listed in the manifest's <resx> lines (run npm run languages)`);
    for (const file of listed) if (!wanted.has(file)) errors.push(`${where}: the manifest lists ${file}, a language that is not configured`);
    const present = existsSync(join(folder, 'strings')) ? readdirSync(join(folder, 'strings')).filter((file) => file.endsWith('.resx')) : [];
    for (const file of present) if (!wanted.has(file)) errors.push(`${where}: strings/${file} is for a language that is not configured (npm run languages -- --prune)`);

    for (const locale of locales.locales) {
      const path = resxPath(folder, name, locale.lcid);
      const label = `${where}/strings/${name}.${locale.lcid}.resx (${locale.englishName ?? locale.code})`;
      if (!existsSync(path)) { errors.push(`${label} is missing (run npm run languages)`); continue; }
      const entries = readResx(path);
      const keys = new Map(entries.map((entry) => [entry.key, entry]));
      const needed = neededCategories(locale.culture);
      let untranslated = 0;
      for (const entry of entries) {
        if (!entry.value.trim()) errors.push(`${label}: '${entry.key}' is empty`);
        if (entry.comment === UNTRANSLATED) untranslated++;
        const part = pluralPart(entry.key);
        if (part && counted.has(part.base)) {
          if (!needed.includes(part.category)) errors.push(`${label}: '${entry.key}' is a plural form ${locale.code} does not use (it needs ${needed.join(', ') || 'only the key itself'})`);
          continue;
        }
        if (!sourceKeys.has(entry.key)) errors.push(`${label}: '${entry.key}' is not in the source language`);
      }
      for (const entry of source) {
        const part = pluralPart(entry.key);
        if (part && counted.has(part.base)) continue;
        const own = keys.get(entry.key);
        if (!own) { errors.push(`${label}: '${entry.key}' is missing`); continue; }
        if (placeholders(own.value) !== placeholders(entry.value)) errors.push(`${label}: '${entry.key}' does not carry the same placeholders as the source`);
        if (!counted.has(entry.key)) continue;
        for (const category of needed) {
          const form = keys.get(`${entry.key}.${category}`);
          if (!form) errors.push(`${label}: '${entry.key}' is counted and needs .${category} in ${locale.englishName ?? locale.code}`);
          else if (placeholders(form.value) !== placeholders(entry.value)) errors.push(`${label}: '${entry.key}.${category}' does not carry the same placeholders as the source`);
        }
      }
      if (untranslated) (strict ? errors : warnings).push(`${label}: ${untranslated} string(s) still marked untranslated`);
    }

    // ---- features and privacy
    const files = [...sources(folder), ...sharedSources];
    for (const file of files) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      for (const [pattern, what] of NETWORK) {
        if (pattern.test(code) && !manifest.externalServices) errors.push(`${rel(file)}: uses ${what}, and ${name} declares no external-service-usage (privacy: no calls outside Dataverse without an owner decision)`);
      }
      if (file.startsWith(folder)) {
        for (const [pattern, feature] of FEATURES) {
          if (pattern.test(code) && !manifest.features.includes(feature)) errors.push(`${rel(file)}: uses ${feature} and ${name}'s manifest has no <uses-feature name="${feature}">`);
        }
        for (const [, device] of code.matchAll(/\bcontext\.device\.(\w+)/g)) {
          if (!manifest.features.includes(`Device.${device}`)) errors.push(`${rel(file)}: uses Device.${device} and ${name}'s manifest does not declare it`);
        }
      }
    }
    if (manifest.externalServices) {
      if (manifest.domains.length === 0) errors.push(`${where}: external-service-usage is enabled without a <domain>`);
      for (const domain of manifest.domains) {
        const decision = decisions.find((one) => one.domain === domain);
        if (!decision) errors.push(`${where}: ${domain} has no entry in external-services.json (who approved it, when, where it processes data)`);
        else for (const field of ['approvedBy', 'date', 'purpose', 'dataResidency']) if (!decision[field]) errors.push(`external-services.json: ${domain} needs '${field}'`);
      }
    }
  }

  // ---- generated files current
  for (const [path, text] of Object.entries(synced.files)) {
    if (!existsSync(path)) errors.push(`${rel(path)} is missing (run npm run languages)`);
    else if (readFileSync(path, 'utf8') !== text && /generated|ControlManifest/.test(path)) errors.push(`${rel(path)} is not current (run npm run languages)`);
  }
  if (controls.length === 0) errors.push('no control found (a folder with ControlManifest.Input.xml)');
  return { errors, warnings, controls: controls.length };
}

function main() {
  const strict = process.argv.includes('--strict');
  const locales = readLocales(localesPath());
  const { errors, warnings, controls } = checkProject(controlsRoot, { strict, locales });
  for (const warning of warnings) console.log(`  ! ${warning}`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  const languages = locales.locales.map((locale) => locale.code).join(', ');
  if (errors.length) {
    console.error(`Controls: ${errors.length} problem(s) in ${controls} control(s), ${locales.locales.length} languages (${languages}).`);
    process.exit(1);
  }
  console.log(`Controls: ${controls} control(s), ${locales.locales.length} languages (${languages}), ${warnings.length} warning(s). OK`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
