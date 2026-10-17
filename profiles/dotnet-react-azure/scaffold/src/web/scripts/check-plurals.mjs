// ===========================================================================
// Holds build/contracts/plurals.json (the server's CLDR plural rules) to this
// Node's Intl.PluralRules, for whole numbers: every language in the file, or
// only the ones given.
//
//   node src/web/scripts/check-plurals.mjs            every language in plurals.json
//   node src/web/scripts/check-plurals.mjs pl pt-PT   just these
//   node src/web/scripts/check-plurals.mjs --configured   the cultures in locales.json
//
// Exit code 1 and a line per disagreement when they differ. The server's
// evaluator (PluralRules.cs) is re-implemented here in a few lines, so the
// check runs without .NET; PluralRulesTests holds the C# side to the same.
// ===========================================================================
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(here, '../../../build/contracts/plurals.json'), 'utf8'));
const categories = ['zero', 'one', 'two', 'few', 'many'];

/** Evaluates one CLDR condition for a whole number n (v, w, f, t, c, e are 0). */
export function matches(condition, n) {
  const text = condition.split('@')[0].trim();
  if (!text) return true;
  return text.split(' or ').some((alternative) => alternative.split(' and ').every((relation) => {
    const m = /^\s*([niftvwce])\s*(?:%\s*(\d+))?\s*(!=|=)\s*([\d\s.,]+)$/.exec(relation);
    if (!m) throw new Error(`Not a CLDR plural relation: '${relation}'`);
    let value = m[1] === 'n' || m[1] === 'i' ? n : 0;
    if (m[2]) value %= Number(m[2]);
    const inside = m[4].split(',').map((r) => r.trim()).filter(Boolean).some((range) => {
      const [low, high = low] = range.split('..').map(Number);
      return value >= low && value <= high;
    });
    return m[3] === '=' ? inside : !inside;
  }));
}

export function category(rules, n) {
  for (const c of categories) if (rules[c] !== undefined && matches(rules[c], n)) return c;
  return 'other';
}

const counts = [...Array(1001).keys(), 1001, 1002, 1011, 1100, 10000, 100000, 1000000, 2000000, 1000001, 10000000];
const wanted = process.argv.slice(2);
const configured = wanted.includes('--configured')
  ? JSON.parse(readFileSync(resolve(here, '../../../build/contracts/locales.json'), 'utf8')).locales.map((l) => l.culture)
  : [];
const languages = configured.length ? configured : wanted.length ? wanted : Object.keys(data.rules);
let failures = 0;

for (const language of languages) {
  const rules = data.rules[language] ?? data.rules[language.split('-')[0]];
  if (!rules) { console.error(`${language}: no rules in plurals.json`); failures++; continue; }
  const intl = new Intl.PluralRules(language);
  const wrong = counts.filter((n) => category(rules, n) !== intl.select(n));
  if (wrong.length) {
    failures++;
    console.error(`${language}: differs from Intl for ${wrong.slice(0, 12).map((n) => `${n} (file ${category(rules, n)}, Intl ${intl.select(n)})`).join(', ')}`);
  }
}

if (failures) { console.error(`${failures} language(s) disagree with Intl.PluralRules (Node ${process.versions.node}, ICU ${process.versions.icu}, CLDR ${process.versions.cldr}).`); process.exit(1); }
console.log(`plurals.json agrees with Intl.PluralRules for ${languages.length} language(s) (CLDR ${process.versions.cldr}).`);
