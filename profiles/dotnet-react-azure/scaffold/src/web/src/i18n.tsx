import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { countedText, format } from './plural.ts';
import { initialLanguage, loadBundle, offered, type Bundle, type Locale } from './strings.ts';
import { readSetting, writeSetting } from './storage.ts';

interface I18n {
  locale: Locale;
  locales: readonly Locale[];
  setLanguage: (code: string) => void;
  /** A translation; the English is the fallback and documents the key where it is used. */
  t: (key: string, english: string, ...args: Array<string | number>) => string;
  /** A counted translation: key.one/.few/.many as the language needs, the key itself for "other". */
  count: (key: string, english: string, englishOne: string, n: number) => string;
}

const Context = createContext<I18n | null>(null);

// Languages written right to left. CSS should use logical properties (margin-inline-start, not margin-left)
// so layouts mirror by themselves.
const rightToLeft = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'dv', 'yi', 'ku', 'sd', 'ug']);

export function direction(culture: string): 'ltr' | 'rtl' {
  return rightToLeft.has(culture.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}

export function I18nProvider({ ns, children }: { ns: string; children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => initialLanguage(readSetting('language'), navigator.languages ?? [navigator.language]));
  const [bundle, setBundle] = useState<Bundle>({});

  useEffect(() => {
    let current = true;
    void loadBundle(ns, locale.code).then((loaded) => { if (current) setBundle(loaded); });
    // The page's language, for screen readers, hyphenation and spell checking; and its direction.
    document.documentElement.lang = locale.culture;
    document.documentElement.dir = direction(locale.culture);
    return () => { current = false; };
  }, [ns, locale]);

  const rules = useMemo(() => new Intl.PluralRules(locale.culture), [locale]);

  const setLanguage = useCallback((code: string) => {
    const next = offered.find((l) => l.code === code);
    if (!next) return;
    writeSetting('language', next.code);
    setLocale(next);
  }, []);

  const value = useMemo<I18n>(() => ({
    locale,
    locales: offered,
    setLanguage,
    t: (key, english, ...args) => format(countedText(bundle, key, args, rules) ?? bundle[key] ?? english, args, locale.culture),
    count: (key, english, englishOne, n) => {
      const form = countedText(bundle, key, [n], rules) ?? bundle[key] ?? (rules.select(n) === 'one' && bundle[key] === undefined ? englishOne : english);
      return format(form, [n], locale.culture);
    }
  }), [bundle, locale, rules, setLanguage]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
