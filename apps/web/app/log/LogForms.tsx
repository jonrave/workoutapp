'use client';

import { useState } from 'react';
import { tissueLabel } from '../../lib/labels';

const today = () => new Date().toISOString().slice(0, 10);

async function post(path: string, body: unknown): Promise<{ ok?: boolean; error?: string } & Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function Notice({ state }: { state: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!state) return null;
  return <div className={`notice ${state.kind}`}>{state.text}</div>;
}

interface NoteResult {
  summary: string;
  confidence: string;
  recorded: Array<{ type: string; label: string }>;
  skipped?: string[];
}

const eventTypeLabel: Record<string, string> = {
  activity: 'Activity',
  subjective: 'Check-in',
  illness: 'Illness',
  injury: 'Injury',
  'lever-measurement': 'Lever',
  'recovery-signal': 'Sleep',
};

export function QuickLog() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NoteResult | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await post('/api/note', { text, date: today() });
      if (res.error) {
        setNotice({ kind: 'error', text: String(res.error) });
      } else {
        setResult(res as unknown as NoteResult);
        setText('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          Anything worth remembering — a workout, soreness, sleep, beers, illness. It is saved
          verbatim and structured into the log for you; below you see exactly what was recorded.
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ran 40 min easy, knee a bit sore 2/10, slept 6h, 2 beers last night"
          />
        </label>
        <button type="submit" disabled={busy || text.trim().length < 3}>
          {busy ? 'Saving…' : 'Save to log'}
        </button>
      </form>
      {result && (
        <div className="card" style={{ marginTop: '0.8rem' }}>
          <h2>Recorded</h2>
          <p>{result.summary}</p>
          {result.recorded.length > 0 ? (
            <ul>
              {result.recorded.map((r, i) => (
                <li key={i}>
                  <strong>{eventTypeLabel[r.type] ?? r.type}</strong> — {r.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No structured facts recognized — the note itself is saved and stays in your history.
            </p>
          )}
          {result.skipped && result.skipped.length > 0 && (
            <p className="muted">Not recorded (implausible values): {result.skipped.join('; ')}</p>
          )}
          <p className="muted">Parser confidence: {result.confidence}. The raw note is kept verbatim.</p>
        </div>
      )}
      <Notice state={notice} />
    </div>
  );
}

export function MorningCheckIn() {
  const [soreness, setSoreness] = useState(2);
  const [painSite, setPainSite] = useState('');
  const [painScore, setPainScore] = useState(0);
  const [altersMovement, setAltersMovement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await post('/api/events', {
        kind: 'subjective',
        occurredAt: `${today()}T07:00:00Z`,
        soreness,
        ...(painSite ? { pain: { site: painSite, score: painScore }, altersMovement } : {}),
      });
      setNotice(
        result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Check-in saved.' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Whole-body soreness (0–10)
        <input
          type="number"
          min={0}
          max={10}
          value={soreness}
          onChange={(e) => setSoreness(Number(e.target.value))}
        />
      </label>
      <label>
        Site pain (optional)
        <select value={painSite} onChange={(e) => setPainSite(e.target.value)}>
          <option value="">none</option>
          {[
            'kneeExtensor',
            'hipExtensor',
            'hamstringHighVelocity',
            'calfAchillesHighVelocity',
            'axialCompression',
            'upperPush',
            'upperPull',
            'shoulderOverhead',
          ].map((c) => (
            <option key={c} value={c}>
              {tissueLabel(c)}
            </option>
          ))}
        </select>
      </label>
      {painSite && (
        <>
          <label>
            Pain score (0–10) — above 3, or any pain that changes how you move, blocks the pattern
            <input
              type="number"
              min={0}
              max={10}
              value={painScore}
              onChange={(e) => setPainScore(Number(e.target.value))}
            />
          </label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={altersMovement}
              onChange={(e) => setAltersMovement(e.target.checked)}
            />
            It changes how I move (gait, depth, mechanics)
          </label>
        </>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save check-in'}
      </button>
      <Notice state={notice} />
    </form>
  );
}
