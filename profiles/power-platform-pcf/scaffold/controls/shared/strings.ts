/**
 * Strings for a control, in the reader's language.
 *
 * The platform picks the RESX file for the user's language (context.resources.getString); when it
 * has none it uses the environment's base language, and when a key is missing it returns the key
 * itself. This helper adds what RESX does not have:
 *
 * - plural forms by CLDR category (Intl.PluralRules on the configured culture): a counted string
 *   has the key itself for "other" and key.one, key.few, key.many ... for the categories its
 *   language needs, the framework's convention for every string bundle;
 * - placeholders {0}, {1} ... with numbers formatted for the culture;
 * - a fallback to the default language's strings (generated from its RESX at build time), so a
 *   reader never sees a raw key, even in an environment whose base language the control does not
 *   ship.
 */
import { cultureFor } from "./languages.generated";

export type Lookup = (key: string) => string | null | undefined;

export interface Strings {
  /** The culture strings and numbers follow, for example nl-NL. */
  readonly culture: string;
  /** The text for a key, with {0}, {1} ... filled in. */
  text(key: string, ...args: (string | number)[]): string;
  /** The form of a counted string for this count (CLDR category), with {0} the formatted count. */
  counted(key: string, count: number, ...args: (string | number)[]): string;
  /** A number formatted for the culture. */
  number(value: number): string;
}

export function createStrings(lookup: Lookup, languageId: number, fallback: Readonly<Record<string, string>>): Strings {
  const culture = cultureFor(languageId);
  const plural = new Intl.PluralRules(culture);
  const numbers = new Intl.NumberFormat(culture);

  const find = (key: string): string | undefined => {
    const value = lookup(key);
    if (value && value !== key) return value;
    return fallback[key];
  };

  const fill = (template: string, args: (string | number)[]): string =>
    template.replace(/\{(\d+)\}/g, (whole, index: string) => {
      const arg = args[Number(index)];
      if (arg === undefined) return whole;
      return typeof arg === "number" ? numbers.format(arg) : arg;
    });

  return {
    culture,
    text: (key, ...args) => fill(find(key) ?? key, args),
    counted: (key, count, ...args) => {
      const category = plural.select(count);
      const template = (category !== "other" ? find(`${key}.${category}`) : undefined) ?? find(key) ?? key;
      return fill(template, [count, ...args]);
    },
    number: (value) => numbers.format(value),
  };
}
