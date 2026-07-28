'use client';

import { useState } from 'react';

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

interface Draft {
  modality: string;
  durationMinutes: number;
  sRPE: number;
  description: string;
  pillarLoad: Record<string, number>;
  tissueChannels: string[];
  confidence: string;
}

export function FreeTextLog() {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function parse() {
    setNotice(null);
    const result = await post('/api/parse', { text, date: today() });
    if ('error' in result && result.error) setNotice({ kind: 'error', text: String(result.error) });
    else setDraft(result as unknown as Draft);
  }

  async function confirm() {
    if (!draft) return;
    const tissueLoad = Object.fromEntries(
      draft.tissueChannels.map((c) => [c, Math.round((draft.sRPE * draft.durationMinutes) / Math.max(1, draft.tissueChannels.length))]),
    );
    const result = await post('/api/events', {
      kind: 'activity',
      planned: false,
      plannedSlot: null,
      modality: draft.modality,
      durationMinutes: draft.durationMinutes,
      sRPE: draft.sRPE,
      occurredAt: `${today()}T12:00:00Z`,
      pillarLoad: draft.pillarLoad,
      tissueLoad,
      description: draft.description,
    });
    if (result.error) setNotice({ kind: 'error', text: result.error });
    else {
      setNotice({ kind: 'ok', text: 'Activity logged.' });
      setDraft(null);
      setText('');
    }
  }

  return (
    <div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void parse();
        }}
      >
        <label>
          Describe what you did — a draft is parsed for your confirmation; nothing enters the log
          until you approve it
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="played 70 min pickup soccer, legs cooked"
          />
        </label>
        <button type="submit">Parse draft</button>
      </form>
      {draft && (
        <div className="card" style={{ marginTop: '0.8rem' }}>
          <h2>Draft — confirm or discard</h2>
          <table className="plain">
            <tbody>
              <tr>
                <th>Modality</th>
                <td>{draft.modality}</td>
                <th>Duration</th>
                <td>
                  <input
                    type="number"
                    value={draft.durationMinutes}
                    onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}
                    style={{ width: '5rem' }}
                  />{' '}
                  min
                </td>
              </tr>
              <tr>
                <th>sRPE</th>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={draft.sRPE}
                    onChange={(e) => setDraft({ ...draft, sRPE: Number(e.target.value) })}
                    style={{ width: '4rem' }}
                  />
                </td>
                <th>Tissue</th>
                <td className="muted">{draft.tissueChannels.join(', ') || '—'}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted">Parser confidence: {draft.confidence}</p>
          <button onClick={() => void confirm()}>Confirm &amp; log</button>{' '}
          <button className="secondary" onClick={() => setDraft(null)}>
            Discard
          </button>
        </div>
      )}
      <Notice state={notice} />
    </div>
  );
}

export function QuickLog({ slots }: { slots: Array<{ slot: string; description: string }> }) {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function mark(slot: string, done: boolean, description: string) {
    const result = done
      ? await post('/api/events', {
          kind: 'activity',
          planned: true,
          plannedSlot: slot,
          modality: 'other',
          durationMinutes: 60,
          sRPE: 6,
          occurredAt: `${today()}T12:00:00Z`,
          description,
        })
      : await post('/api/events', {
          kind: 'missed-session',
          plannedSlot: slot,
          occurredAt: `${today()}T12:00:00Z`,
        });
    setNotice(
      result.error
        ? { kind: 'error', text: result.error }
        : { kind: 'ok', text: done ? 'Session logged.' : 'Noted — adherence is learned, never moralized.' },
    );
  }

  return (
    <div>
      <table className="plain">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Planned</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.slot}>
              <td>{s.slot}</td>
              <td>{s.description}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button onClick={() => void mark(s.slot, true, s.description)}>Done</button>{' '}
                <button className="secondary" onClick={() => void mark(s.slot, false, s.description)}>
                  Missed
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Notice state={notice} />
    </div>
  );
}

export function MorningCheckIn() {
  const [soreness, setSoreness] = useState(2);
  const [painSite, setPainSite] = useState('');
  const [painScore, setPainScore] = useState(0);
  const [altersMovement, setAltersMovement] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await post('/api/events', {
      kind: 'subjective',
      occurredAt: `${today()}T07:00:00Z`,
      soreness,
      ...(painSite ? { pain: { site: painSite, score: painScore }, altersMovement } : {}),
    });
    setNotice(
      result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Check-in saved.' },
    );
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
              {c}
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
      <button type="submit">Save check-in</button>
      <Notice state={notice} />
    </form>
  );
}
