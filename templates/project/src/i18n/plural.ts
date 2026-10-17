// Counted strings: picking the plural form a language needs (CLDR categories via Intl.PluralRules).
//
// A counted string has a key per CLDR plural category its language needs besides "other":
// English needs key.one ("1 message"); Polish needs key.one, key.few and key.many ("1 wiadomość",
// "2 wiadomości", "5 wiadomości"); the key itself is "other" and the fallback. Which categories a
// language needs is data, not code: neededCategories(culture) asks Intl, so adding a language to
// locales.json is enough. Use the language's culture (pt-PT, not pt), because rules differ.
//
// Only erasable TypeScript syntax is used, so Node (22.18+) can import this file directly in tests.

export type Bundle = Readonly<Record<string, string>>;
export type Arg = string | number;

/** A whole number as toLocaleString writes it in common cultures: 7, 1,234, 1.234, 1 234. */
const grouped = /^-?\d{1,3}(?:[\s  .,'’]\d{3})*$|^-?\d+$/;

/**
 * The count a translation's first argument carries: the number itself, or a whole number already
 * formatted for the reader ("1 234"). Anything else (a name, a time, a decimal) is not a count.
 */
export function countIn(value: Arg | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return grouped.test(text) ? Number(text.replace(/[^\d-]/g, '')) : null;
}

/**
 * The text for a counted key in the reader's language: key.one, key.few, ... when the first
 * argument is a count in that category and the bundle has the form; otherwise undefined, and the
 * caller uses the key itself ("other").
 */
export function countedText(bundle: Bundle, key: string, args: ReadonlyArray<Arg>, rules: Intl.PluralRules): string | undefined {
  const count = countIn(args[0]);
  if (count === null) return undefined;
  const category = rules.select(Math.abs(count));
  return category === 'other' ? undefined : bundle[`${key}.${category}`];
}

/** The categories besides "other" that whole numbers 0..upTo fall into in a culture. */
export function neededCategories(culture: string, upTo: number = 200): string[] {
  const rules = new Intl.PluralRules(culture);
  const seen = new Set<string>();
  for (let count = 0; count <= upTo; count++) seen.add(rules.select(count));
  seen.delete('other');
  return [...seen];
}

/** Fills {0}, {1} ... and {name} placeholders. Unknown placeholders are left as they are. */
export function format(text: string, args: ReadonlyArray<Arg> = [], named: Readonly<Record<string, Arg>> = {}): string {
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole: string, name: string) => {
    if (/^\d+$/.test(name)) return Number(name) < args.length ? String(args[Number(name)]) : whole;
    return name in named ? String(named[name]) : whole;
  });
}

/**
 * The whole lookup: the counted form if there is one, else the key itself in the reader's bundle,
 * else in the fallback bundle, else the key (so a missing string is visible, not blank).
 */
export function translate(bundle: Bundle, fallback: Bundle, key: string, args: ReadonlyArray<Arg>, rules: Intl.PluralRules): string {
  const text = countedText(bundle, key, args, rules) ?? bundle[key] ?? fallback[key] ?? key;
  return format(text, args);
}
