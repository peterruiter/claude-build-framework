// Helpers for the Dataverse contract tests. Node's own modules only; the XML is read with small,
// strict regular expressions because the unpacked solution format is regular and no dependency
// is worth adding for it.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const readText = (path) => readFileSync(join(root, path), 'utf8').replace(/^﻿/, '');
export const readJson = (path) => JSON.parse(readText(path));
export const exists = (path) => existsSync(join(root, path));
export const rel = (path) => relative(root, path).replaceAll('\\', '/');

export const schema = readJson('build/contracts/schema.json');
export const roles = readJson('build/contracts/roles.json');
export const privacy = readJson('build/contracts/privacy.json');
export const environments = readJson('environments.json');
export const prefix = `${schema.publisher.prefix}_`;
export const lcids = schema.languages.lcids.map(String);

/** Every file under a folder (absolute paths). */
export function walk(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every table column the contract defines, primary name first, as { table, column }. */
export function contractColumns() {
  return schema.tables.flatMap((table) => [
    { table, column: { ...table.primaryName, type: 'text', primary: true } },
    ...table.columns.map((column) => ({ table, column })),
  ]);
}

/** Text of a solution file, without a byte order mark. */
export function readSolutionFile(solution, path) {
  return readFileSync(join(root, solution.folder, path), 'utf8').replace(/^﻿/, '');
}

/** The value of one element in an XML text (first match). */
export const element = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

/** Attributes of an unpacked Entity.xml: { physicalName, logicalName, type, custom, labels: {lcid: text} }. */
export function entityAttributes(xml) {
  return [...xml.matchAll(/<attribute PhysicalName="([^"]+)">([\s\S]*?)<\/attribute>/g)].map(([, physicalName, body]) => ({
    physicalName,
    logicalName: element(body, 'LogicalName'),
    type: element(body, 'Type'),
    custom: element(body, 'IsCustomField') === '1',
    labels: Object.fromEntries([...(/<displaynames>([\s\S]*?)<\/displaynames>/.exec(body.replace(/<optionset[\s\S]*?<\/optionset>/, ''))?.[1] ?? '')
      .matchAll(/<displayname description="([^"]*)" languagecode="(\d+)"/g)].map(([, text, lcid]) => [lcid, text])),
  }));
}

/** Culture (from locales.json) to Dataverse LCID, for the languages a project is likely to offer. */
export const lcidOfCulture = {
  'en-US': 1033, 'en-GB': 2057, 'nl-NL': 1043, 'nl-BE': 2067, 'de-DE': 1031, 'de-AT': 3079, 'de-CH': 2055, 'fr-FR': 1036,
  'fr-BE': 2060, 'es-ES': 3082, 'it-IT': 1040, 'pt-PT': 2070, 'pt-BR': 1046, 'pl-PL': 1045, 'sv-SE': 1053, 'da-DK': 1030,
  'fi-FI': 1035, 'nb-NO': 1044, 'cs-CZ': 1029, 'sk-SK': 1051, 'hu-HU': 1038, 'ro-RO': 1048, 'el-GR': 1032, 'et-EE': 1061,
  'lv-LV': 1062, 'lt-LT': 1063, 'sl-SI': 1060, 'hr-HR': 1050, 'bg-BG': 1026, 'tr-TR': 1055, 'uk-UA': 1058, 'ar-SA': 1025,
  'he-IL': 1037, 'ja-JP': 1041, 'zh-CN': 2052, 'ko-KR': 1042,
};

/** True when a value in a settings file looks like a secret rather than a setting or a reference. */
export function looksSecret(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.KeyVault\/vaults\/[^/]+\/secrets\/[^/]+$/i.test(value)) return false;
  return /^eyJ[\w-]+\.[\w-]+\./.test(value) // a JWT
    || /(password|pwd|secret|sig|accountkey|sharedaccesskey)=/i.test(value)
    || /^[A-Za-z0-9+/_~.-]{32,}={0,2}$/.test(value) && !/^https?:/.test(value) && /\d/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value);
}
