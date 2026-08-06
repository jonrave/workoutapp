'use client';

import { useState } from 'react';
import { slotLabel, tissueLabel } from '../../lib/labels';

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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function parse() {
    setNotice(null);
    setBusy(true);
    try {
      const result = await post('/api/parse', { text, date: today() });
      if ('error' in result && result.error) setNotice({ kind: 'error', text: String(result.error) });
      else setDraft(result as unknown as Draft);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
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
        <button type="submit" disabled={busy}>
          {busy && !draft ? 'Parsing…' : 'Parse draft'}
        </button>
      </form>
      {draft && (
        <div className="card" style={{ marginTop: '0.8rem' }}>
          <h2>Draft — confirm or discard</h2>
          <div className="table-scroll">
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
                  <td className="muted">{draft.tissueChannels.map(tissueLabel).join(', ') || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">Parser confidence: {draft.confidence}</p>
          <button onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Logging…' : 'Confirm & log'}
          </button>{' '}
          <button className="secondary" onClick={() => setDraft(null)} disabled={busy}>
            Discard
          </button>
        </div>
      )}
      <Notice state={notice} />
    </div>
  );
}

export interface QuickLogSlot {
  slot: string;
  description: string;
  modality: string;
  durationMinutes: number;
  targetSRPE: number;
}

export function QuickLog({ slots }: { slots: QuickLogSlot[] }) {
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function mark(s: QuickLogSlot, done: boolean) {
    setBusySlot(s.slot);
    try {
      // A completed planned session is logged at its planned duration, target
      // sRPE and modality — not at invented defaults.
      const result = done
        ? await post('/api/events', {
            kind: 'activity',
            planned: true,
            plannedSlot: s.slot,
            modality: s.modality,
            durationMinutes: s.durationMinutes,
            sRPE: s.targetSRPE,
            occurredAt: `${today()}T12:00:00Z`,
            description: s.description,
          })
        : await post('/api/events', {
            kind: 'missed-session',
            plannedSlot: s.slot,
            occurredAt: `${today()}T12:00:00Z`,
          });
      setNotice(
        result.error
          ? { kind: 'error', text: result.error }
          : { kind: 'ok', text: done ? 'Session logged as planned.' : 'Noted — adherence is learned, never moralized.' },
      );
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div>
      <div className="table-scroll">
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
                <td>{slotLabel(s.slot)}</td>
                <td>
                  {s.description}
                  <div className="muted">
                    {s.durationMinutes} min · target sRPE {s.targetSRPE}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => void mark(s, true)} disabled={busySlot !== null}>
                    Done
                  </button>{' '}
                  <button className="secondary" onClick={() => void mark(s, false)} disabled={busySlot !== null}>
                    Missed
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
