import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Chrome } from '../../src/Chrome.tsx';
import { I18nProvider, useI18n } from '../../src/i18n.tsx';
import { applyTheme, storedTheme } from '../../src/theme.ts';
import '../../src/styles/design-system/tokens.css';
import '../../src/styles/base.css';

applyTheme(storedTheme());

function Portal() {
  const { t } = useI18n();
  return (
    <Chrome title={t('portal.title', 'Portal')}>
      <h1>{t('portal.title', 'Portal')}</h1>
      <p>{t('portal.intro', 'The second app, for a different audience, with its own entry point.')}</p>
    </Chrome>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider ns="ui">
      <Portal />
    </I18nProvider>
  </StrictMode>
);
