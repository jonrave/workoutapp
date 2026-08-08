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

/**
 * Stream file drop: the first-cut ingest path for raw HR streams (a Strava
 * stream export JSON). Band math runs server-side against the personal
 * calibration for the chosen modality; payloads carrying only device zone
 * labels are rejected there with an explanation, by design.
 */
export function StreamDropLog() {
  const [payload, setPayload] = useState('');
  const [modality, setModality] = useState('run');
  const [date, setDate] = useState(today());
  const [environment, setEnvironment] = useState('outdoor');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onFile(file: File) {
    setPayload(await file.text());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    let stream: unknown;
    try {
      stream = JSON.parse(payload);
    } catch {
      setNotice({ kind: 'error', text: 'That is not valid JSON. Drop a Strava stream export file or paste its contents.' });
      return;
    }
    setBusy(true);
    try {
      const result = await post('/api/events', {
        kind: 'aerobic-stream',
        modality,
        occurredAt: `${date}T12:00:00Z`,
        environment,
        stream,
      });
      if (result.error) setNotice({ kind: 'error', text: result.error });
      else {
        setNotice({ kind: 'ok', text: 'Stream computed and logged: time in band against your personal bands, plus cardiac drift.' });
        setPayload('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Stream file (Strava streams JSON: time, heartrate, optionally velocity or watts)
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </label>
      <label>
        Or paste the stream JSON
        <textarea
          rows={2}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder='{"time": [0, 5, ...], "heartrate": [131, 133, ...], "velocity": [3.1, ...]}'
        />
      </label>
      <label>
        Modality — band math needs a calibration for this exact modality; only running is calibrated so far
        <select value={modality} onChange={(e) => setModality(e.target.value)}>
          {['run', 'airBike', 'spinBike', 'row', 'swim', 'hike'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Environment — outdoor sessions usually confound cardiac drift, and that is reported honestly
        <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          {['outdoor', 'treadmill', 'indoor', 'unknown'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy || !payload}>
        {busy ? 'Computing…' : 'Compute & log'}
      </button>
      <Notice state={notice} />
    </form>
  );
}

/** Cooper 12-minute test entry. Track and treadmill stay separate series forever. */
export function CooperTestLog() {
  const [surface, setSurface] = useState('track');
  const [distance, setDistance] = useState(2800);
  const [pacing, setPacing] = useState('');
  const [ramp, setRamp] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await post('/api/events', {
        kind: 'cooper-test',
        surface,
        distanceMeters: distance,
        pacingStrategy: pacing,
        occurredAt: `${date}T09:00:00Z`,
        ...(surface === 'treadmill' && ramp ? { rampCorrection: ramp } : {}),
      });
      if (result.error) setNotice({ kind: 'error', text: result.error });
      else setNotice({ kind: 'ok', text: 'Cooper test recorded in its own series.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Surface — the two series are never pooled
        <select value={surface} onChange={(e) => setSurface(e.target.value)}>
          <option value="track">outdoor track</option>
          <option value="treadmill">treadmill</option>
        </select>
      </label>
      <label>
        Distance in 12 minutes (meters)
        <input
          type="number"
          min={1000}
          max={5000}
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
        />
      </label>
      <label>
        Pacing strategy (recorded with the test)
        <input
          type="text"
          value={pacing}
          onChange={(e) => setPacing(e.target.value)}
          placeholder="even splits, no sprint finish"
        />
      </label>
      {surface === 'treadmill' && (
        <label>
          Ramp correction — required for treadmill tests
          <input
            type="text"
            value={ramp}
            onChange={(e) => setRamp(e.target.value)}
            placeholder="1% incline throughout"
          />
        </label>
      )}
      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || !pacing}>
        {busy ? 'Saving…' : 'Record test'}
      </button>
      <Notice state={notice} />
    </form>
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
