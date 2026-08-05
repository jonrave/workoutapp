'use client';

import { useEffect, useState } from 'react';

interface Providers {
  oura: boolean;
  strava: boolean;
}

/**
 * Pull-on-demand device sync. Raw signals only cross this boundary (I4);
 * pulls are idempotent thanks to deterministic adapter event ids, so the
 * button is always safe to press.
 */
export function DeviceSync() {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void fetch('/api/sync')
      .then((r) => r.json())
      .then((b) => setProviders(b.providers ?? { oura: false, strava: false }))
      .catch(() => setProviders({ oura: false, strava: false }));
  }, []);

  async function sync() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const body = await res.json();
      if (body.error) setNotice({ kind: 'error', text: body.error });
      else {
        const parts = [];
        if (providers?.oura) parts.push(`${body.added.oura} Oura readings`);
        if (providers?.strava) parts.push(`${body.added.strava} Strava activities`);
        setNotice({
          kind: body.ok ? 'ok' : 'error',
          text:
            `Pulled ${parts.join(' and ') || 'nothing new'} from the last 30 days.` +
            (body.errors ? ` Problems: ${body.errors.join('; ')}` : ''),
        });
      }
    } catch (err) {
      setNotice({ kind: 'error', text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (providers === null) return null;
  if (!providers.oura && !providers.strava) {
    return (
      <p className="muted">
        No device sync configured. Set <code>OURA_TOKEN</code> and/or the <code>STRAVA_*</code>{' '}
        variables to pull nightly HRV, resting HR and sleep, and your activities, automatically —
        see DEPLOY.md.
      </p>
    );
  }
  return (
    <div className="stack">
      <p className="muted">
        Configured: {providers.oura ? 'Oura (nightly HRV, resting HR, sleep)' : ''}
        {providers.oura && providers.strava ? ' · ' : ''}
        {providers.strava ? 'Strava (activities)' : ''}. Composite scores are never imported —
        raw signals only (I4). Safe to press twice: pulls never duplicate.
      </p>
      <button onClick={() => void sync()} disabled={busy}>
        {busy ? 'Syncing…' : 'Sync last 30 days'}
      </button>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </div>
  );
}
