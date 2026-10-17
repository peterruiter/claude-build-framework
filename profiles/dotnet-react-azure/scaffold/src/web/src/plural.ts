// Counted strings, for both web apps.
//
// A counted string has its key ("other", and the fallback) plus key.<category> for every CLDR plural
// category its language needs besides "other": English needs key.one ("1 item"); Polish needs key.one,
// key.few and key.many; Arabic needs zero, one, two, few and many. Intl.PluralRules on the language's
// culture picks the category, so French reads 0 as singular and pt-PT differs from pt-BR. The server
// evaluates the same CLDR rules from build/contracts/plurals.json (PluralRules.cs), and
// scripts/check-plurals.mjs holds that file to Intl.

/** A whole number written by toLocaleString in any culture: 7, 1,234, 1.234, 1 234. */
const grouped = /^-?\d{1,3}(?:[\s  .,'’]\d{3})*$|^-?\d+$/;

/**
 * The count a translation's first argument carries: the number itself, or a whole number already
 * formatted for the reader ("1 234"). Anything else (a name, a time, a decimal) is not a count.
 */
export function countIn(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return grouped.test(text) ? Number(text.replace(/[^\d-]/g, '')) : null;
}

/**
 * The text for a counted key: key.<category> when the first argument is a count whose category is not
 * "other" and the bundle has that form; undefined otherwise (the caller then uses the key itself).
 */
export function countedText(
  bundle: Readonly<Record<string, string>>,
  key: string,
  args: ReadonlyArray<string | number>,
  rules: Intl.PluralRules
): string | undefined {
  const count = countIn(args[0]);
  if (count === null) return undefined;
  const category = rules.select(Math.abs(count));
  return category === 'other' ? undefined : bundle[`${key}.${category}`];
}

/** The categories besides "other" that counts 0 to 200 fall into in a culture: the forms a counted key needs. */
export function neededCategories(culture: string): Intl.LDMLPluralRule[] {
  const rules = new Intl.PluralRules(culture);
  const order: Intl.LDMLPluralRule[] = ['zero', 'one', 'two', 'few', 'many'];
  const found = new Set<Intl.LDMLPluralRule>();
  for (let n = 0; n <= 200; n++) found.add(rules.select(n));
  return order.filter((category) => found.has(category));
}

/** Fills {0}, {1} ... in a template. Numbers are formatted for the culture. */
export function format(template: string, args: ReadonlyArray<string | number>, culture: string): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    if (value === undefined) return match;
    return typeof value === 'number' ? value.toLocaleString(culture) : value;
  });
}
