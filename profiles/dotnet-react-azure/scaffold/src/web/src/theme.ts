// Light and dark. "system" follows prefers-color-scheme (styles/design-system/tokens.css); "light" and "dark" set
// data-theme on <html>, which tokens.css honours over the system setting.
import { readSetting, writeSetting } from './storage.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

export function storedTheme(): ThemeChoice {
  const value = readSetting('theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function chooseTheme(choice: ThemeChoice): void {
  writeSetting('theme', choice === 'system' ? null : choice);
  applyTheme(choice);
}
