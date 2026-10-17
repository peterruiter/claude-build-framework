// Per-reader preferences (language, theme) in localStorage, which can be missing or throw (private
// windows, blocked site data). Every access is guarded: the page works the same without it.
const prefix = 'app.';

export function readSetting(name: string): string | null {
  try {
    return window.localStorage.getItem(prefix + name);
  } catch {
    return null;
  }
}

export function writeSetting(name: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(prefix + name);
    else window.localStorage.setItem(prefix + name, value);
  } catch {
    // Not remembered; nothing else changes.
  }
}
