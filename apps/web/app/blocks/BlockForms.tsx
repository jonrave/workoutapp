'use client';

import { useState } from 'react';
import { metricLabel, pillarLabel, sourceLabel } from '../../lib/labels';

const today = () => new Date().toISOString().slice(0, 10);

export function StartBlockForm({
  baselines,
}: {
  baselines: Record<string, { value: number; sdc: number } | null>;
}) {
  const [pillar, setPillar] = useState('vo2max');
  const [metric, setMetric] = useState('vo2max');
  const [weeks, setWeeks] = useState(8);
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const baseline = baselines[metric];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'start',
          pillar,
          metricUnderTest: metric,
          plannedWeeks: weeks,
          direction,
          thresholdValue: Number(threshold),
          occurredAt: `${today()}T09:00:00Z`,
        }),
      });
      const body = await res.json();
      setNotice(
        body.error
          ? { kind: 'error', text: body.error }
          : { kind: 'ok', text: 'Block started; threshold registered immutably (I10).' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Pillar under focus
        <select value={pillar} onChange={(e) => setPillar(e.target.value)}>
          {['vo2max', 'maxStrength', 'zone2', 'power'].map((p) => (
            <option key={p} value={p}>
              {pillarLabel(p)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Metric under test
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {Object.keys(baselines).map((m) => (
            <option key={m} value={m}>
              {metricLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Planned weeks
        <input type="number" min={2} max={16} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
      </label>
      <label>
        Direction
        <select value={direction} onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')}>
          <option value="increase">increase</option>
          <option value="decrease">decrease</option>
        </select>
      </label>
      <label>
        Success threshold — must clear the noise band
        {baseline ? (
          <span className="muted">
            baseline {baseline.value}; a detectable threshold is{' '}
            {direction === 'increase'
              ? `≥ ${(baseline.value + baseline.sdc).toFixed(1)}`
              : `≤ ${(baseline.value - baseline.sdc).toFixed(1)}`}{' '}
            (SDC {baseline.sdc.toFixed(1)})
          </span>
        ) : (
          <span className="muted">
            no baseline on record for this metric — record a measurement first; a threshold cannot
            be validated against a value that does not exist
          </span>
        )}
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="e.g. 58.5" />
      </label>
      <button type="submit" disabled={!baseline || busy}>
        {busy ? 'Registering…' : 'Register threshold & start block'}
      </button>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </form>
  );
}

export function RetestForm() {
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'measured-lab' | 'measured-field'>('measured-lab');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'retest',
          value: Number(value),
          source,
          occurredAt: `${today()}T09:00:00Z`,
        }),
      });
      const body = await res.json();
      setNotice(
        body.error
          ? { kind: 'error', text: body.error }
          : {
              kind: 'ok',
              text: body.warning ?? 'Retest recorded — see Today for the verdict against the pre-registered threshold.',
            },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Retest value (metric under test)
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 58.8" />
      </label>
      <label>
        Source
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          {(['measured-lab', 'measured-field'] as const).map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Submitting…' : 'Submit retest'}
      </button>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </form>
  );
}
