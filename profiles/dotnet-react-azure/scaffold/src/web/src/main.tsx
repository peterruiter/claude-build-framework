import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n.tsx';
import { Shell } from './Shell.tsx';
import { applyTheme, storedTheme } from './theme.ts';
// The design system first (generated: colours for light and dark, fonts, type scale, roles), then the app's base.
import './styles/design-system/tokens.css';
import './styles/base.css';

// Before the first render, so a reader who chose dark never sees a light flash.
applyTheme(storedTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider ns="ui">
      <Shell />
    </I18nProvider>
  </StrictMode>
);
