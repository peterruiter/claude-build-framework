#!/usr/bin/env node
// Used by scaffold.ps1: writes build/contracts/locales.json for the languages asked for, from the
// framework's languages catalogue, in picker order (own name, accents ignored).
// Usage: node scaffold-locales.mjs <locales.json> <catalogue.json> <source> <default> <code-or-culture>...
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [target, cataloguePath, source, fallback, ...tokens] = process.argv.slice(2);
const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8')).languages;
const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};

const locales = tokens.map((token) => {
  const code = token.split('-')[0].toLowerCase();
  const known = catalogue.find((one) => one.code === code);
  const culture = token.includes('-') ? token : known?.culture;
  if (!culture) throw new Error(`'${token}' is not in the languages catalogue: give its culture, for example ${code}-XX`);
  const display = (locale, language) => new Intl.DisplayNames([locale], { type: 'language' }).of(language) ?? language;
  return {
    code,
    englishName: known?.englishName ?? display('en', code),
    nativeName: known?.nativeName ?? display(culture, code),
    culture,
  };
});
locales.sort((a, b) => new Intl.Collator('en', { sensitivity: 'base' }).compare(a.nativeName, b.nativeName));

const contract = {
  contract: 'locales',
  version: '1.0.0',
  description: existing.description ?? 'The languages this product offers.',
  source,
  default: fallback,
  locales,
  namespaces: existing.namespaces ?? [{ id: 'ui', description: 'Every string in the controls, including accessible names.' }],
};
writeFileSync(target, JSON.stringify(contract, null, 2) + '\n');
console.log(`  locales.json: ${locales.map((one) => `${one.code} (${one.culture})`).join(', ')}; source ${source}, default ${fallback}`);
