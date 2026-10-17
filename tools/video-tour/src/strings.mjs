// The product's own words, so a script can point at "the button that says {@projects.new}" and the
// recorder finds it in whichever language the video is recorded in, and a reworded button does not
// break the script. Bundles come from config paths.uiStrings: { "ui": "src/locales/{lang}.json" }
// (the first kind is the default; {@kind:key} picks another), else from the adapter's words().
import { readFileSync, existsSync } from 'node:fs';
import { config } from './config.mjs';

const cache = new Map();
let adapterWords = null;
export function useAdapterWords(fn) { adapterWords = fn ?? null; }

function bundle(kind, lang) {
  const key = `${kind}.${lang}`;
  if (!cache.has(key)) {
    const pattern = config().dirs.uiStrings[kind];
    if (!pattern) { cache.set(key, null); return null; }
    const read = (l) => { const f = pattern.replace('{lang}', l); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; };
    cache.set(key, { ...read(config().narration.language), ...read(lang) });
  }
  return cache.get(key);
}

function lookup(obj, key) {
  if (!obj) return undefined;
  if (key in obj) return obj[key];
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/** Replaces {@key} and {@kind:key} with the product's text, cut at its first placeholder ("Save {0}" finds "Save"). */
export function words(text, lang, defaultKind) {
  const kinds = Object.keys(config().dirs.uiStrings);
  return String(text).replace(/\{@(?:([\w-]+):)?([\w.-]+)\}/g, (all, kind, key) => {
    const which = kind ?? defaultKind ?? kinds[0] ?? 'ui';
    let value = lookup(bundle(which, lang), key);
    if (value === undefined && adapterWords) value = adapterWords(key, lang, which);
    if (value === undefined) throw new Error(`No "${key}" in the ${which} strings for ${lang}`);
    return String(value).split('{')[0].trim();
  });
}
