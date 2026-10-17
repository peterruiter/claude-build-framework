// Types for the tests, which import these helpers directly.
export interface Locale {
  code: string;
  englishName?: string;
  nativeName?: string;
  culture: string;
  lcid: number | null;
}
export interface Locales {
  path: string;
  locales: Locale[];
  source: Locale;
  fallback: Locale;
}
export function localesPath(argv?: string[]): string;
export function readLocales(path: string): Locales;
export function neededCategories(culture: string): string[];
export function lcidFor(locale: { code: string; culture?: string }): number | null;
