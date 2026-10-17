// The string bundles: the same JSON files the server embeds (src/App.Domain/Localization/Resources),
// one per namespace and language, loaded on demand so a visitor downloads only their own language.
// The language list is build/contracts/locales.json, chosen when the project was scaffolded.
import locales from '../../../build/contracts/locales.json';

export interface Locale {
  code: string;
  culture: string;
  englishName: string;
  nativeName: string;
}

export type Bundle = Readonly<Record<string, string>>;

export const offered: readonly Locale[] = locales.locales;
export const defaultLanguage: string = locales.default;
export const namespaces: readonly string[] = locales.namespaces;

// Every bundle file, as a lazy import. Vite turns each into its own small chunk.
const files = import.meta.glob<Bundle>('../../App.Domain/Localization/Resources/*.json', { import: 'default' });

/** One namespace in one language; an empty bundle when the file is missing (the English fallback then shows). */
export async function loadBundle(ns: string, language: string): Promise<Bundle> {
  const load = files[`../../App.Domain/Localization/Resources/${ns}.${language}.json`];
  return load ? await load() : {};
}

/** The offered language for a code or culture, or undefined. */
export function find(code: string | null | undefined): Locale | undefined {
  if (!code) return undefined;
  const wanted = code.toLowerCase();
  return offered.find((l) => l.code.toLowerCase() === wanted || l.culture.toLowerCase() === wanted)
    ?? offered.find((l) => l.code.toLowerCase() === wanted.split('-')[0]);
}

/** The language to start in: the reader's earlier choice, then the browser's languages, then the default. */
export function initialLanguage(stored: string | null, browser: readonly string[]): Locale {
  return find(stored) ?? browser.map(find).find((l) => l !== undefined) ?? find(defaultLanguage) ?? offered[0];
}
