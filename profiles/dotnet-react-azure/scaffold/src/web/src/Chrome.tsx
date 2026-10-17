import { useState, type ReactNode } from 'react';
import { useI18n } from './i18n.tsx';
import { chooseTheme, storedTheme, type ThemeChoice } from './theme.ts';

/** The frame every page of both apps shares: skip link, title, language picker, theme toggle, one main. */
export function Chrome({ title, children }: { title: string; children: ReactNode }) {
  const { t, locale, locales, setLanguage } = useI18n();
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);

  return (
    <>
      <a className="skip-link" href="#main">{t('nav.skip', 'Skip to content')}</a>
      <header className="chrome">
        <span><strong>{title}</strong></span>
        <div className="chrome-controls">
          <label>
            {t('language.label', 'Language')}
            {/* Each option names the language in itself, and says so to a screen reader. */}
            <select value={locale.code} onChange={(event) => setLanguage(event.target.value)}>
              {locales.map((l) => <option key={l.code} value={l.code} lang={l.culture}>{l.nativeName}</option>)}
            </select>
          </label>
          <label>
            {t('theme.label', 'Theme')}
            <select
              value={theme}
              onChange={(event) => {
                const next = event.target.value as ThemeChoice;
                setTheme(next);
                chooseTheme(next);
              }}
            >
              <option value="system">{t('theme.system', 'System')}</option>
              <option value="light">{t('theme.light', 'Light')}</option>
              <option value="dark">{t('theme.dark', 'Dark')}</option>
            </select>
          </label>
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>{children}</main>
    </>
  );
}
