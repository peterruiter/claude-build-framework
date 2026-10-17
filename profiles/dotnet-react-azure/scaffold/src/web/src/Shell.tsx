import { useEffect, useState } from 'react';
import { Chrome } from './Chrome.tsx';
import { useI18n } from './i18n.tsx';

type Status = 'checking' | 'ready' | 'unreachable';

interface Item { itemId: string; name: string }

/** The main app's first page: replace it. It shows the patterns: strings by key, a counted string, a live status. */
export function Shell() {
  const { t, count } = useI18n();
  const [status, setStatus] = useState<Status>('checking');
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    fetch('/health/ready').then((r) => setStatus(r.ok ? 'ready' : 'unreachable')).catch(() => setStatus('unreachable'));
    fetch('/api/items').then((r) => (r.ok ? r.json() : [])).then((list: Item[]) => setItems(list)).catch(() => setItems([]));
  }, []);

  return (
    <Chrome title={t('app.title', 'App')}>
      <h1>{t('app.title', 'App')}</h1>
      <p>{t('app.tagline', 'A starting point: one API, two web apps, one database.')}</p>
      {/* role=status: a screen reader hears the change without moving focus. */}
      <p role="status">
        {status === 'checking' && t('status.checking', 'Checking the server')}
        {status === 'ready' && t('status.ready', 'The server is ready.')}
        {status === 'unreachable' && t('status.unreachable', 'The server does not answer.')}
      </p>
      {items !== null && (
        items.length === 0
          ? <p className="muted">{t('items.empty', 'Nothing here yet.')}</p>
          : <>
              <p>{count('items.count', '{0} items', '{0} item', items.length)}</p>
              <ul>{items.map((item) => <li key={item.itemId}>{item.name}</li>)}</ul>
            </>
      )}
    </Chrome>
  );
}
