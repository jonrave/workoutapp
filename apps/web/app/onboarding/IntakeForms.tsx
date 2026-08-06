'use client';

import { useState } from 'react';
import { leverLabel, metricLabel, sourceLabel, tissueLabel } from '../../lib/labels';

const today = () => new Date().toISOString().slice(0, 10);

async function post(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

type NoticeState = { kind: 'ok' | 'error'; text: string } | null;

export function MeasurementIntake() {
  const [metric, setMetric] = useState('cmjHeight');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today());
  const [source, setSource] = useState<'measured-lab' | 'measured-field'>('measured-field');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  const units: Record<string, string> = {
    vo2max: 'ml/kg/min',
    lt1Pace: 's/km',
    peakPower: 'W',
    cmjHeight: 'cm',
    rsi: 'ratio',
    almi: 'kg/m2',
    fmi: 'kg/m2',
    vat: 'cm3',
    romAsymmetry: '%',
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await post({
        kind: 'fitness-measurement',
        metric,
        value: Number(value),
        unit: units[metric],
        occurredAt: `${date}T09:00:00Z`,
        source,
      });
      setNotice(
        result.error
          ? { kind: 'error', text: result.error }
          : { kind: 'ok', text: 'Measurement recorded — typical error applied from the §8 table.' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Metric
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {Object.keys(units).map((m) => (
            <option key={m} value={m}>
              {metricLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value ({units[metric]})
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label>
        Measured on
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Source
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="measured-field">{sourceLabel('measured-field')} (self-administered protocol)</option>
          <option value="measured-lab">{sourceLabel('measured-lab')} (supervised test)</option>
        </select>
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record'}</button>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </form>
  );
}

export function LeverIntake() {
  const [lever, setLever] = useState('apoB');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  const units: Record<string, string> = {
    homeSBP7d: 'mmHg',
    homeDBP7d: 'mmHg',
    apoB: 'mg/dL',
    lpa: 'nmol/L',
    hba1c: '%',
    fastingInsulin: 'uIU/mL',
    alcoholUnits: 'units',
    waistCm: 'cm',
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await post({
        kind: 'lever-measurement',
        lever,
        value: Number(value),
        unit: units[lever],
        occurredAt: `${date}T09:00:00Z`,
        source: lever === 'alcoholUnits' || lever === 'waistCm' ? 'user-reported' : 'measured-lab',
      });
      setNotice(
        result.error
          ? { kind: 'error', text: result.error }
          : { kind: 'ok', text: 'Recorded with its assay date — staleness is tracked from day one.' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Lever
        <select value={lever} onChange={(e) => setLever(e.target.value)}>
          {Object.keys(units).map((l) => (
            <option key={l} value={l}>
              {leverLabel(l)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Value ({units[lever]})
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label>
        Assay / measurement date — an old value is entered as old, and shows as stale
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record'}</button>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </form>
  );
}

export function InjuryIntake() {
  const [site, setSite] = useState('hamstringHighVelocity');
  const [severity, setSeverity] = useState<'minor' | 'moderate' | 'severe'>('moderate');
  const [date, setDate] = useState('2023-01-01');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await post({
        kind: 'injury',
        site,
        severity,
        occurredAt: `${date}T09:00:00Z`,
        ...(note ? { note } : {}),
      });
      setNotice(
        result.error
          ? { kind: 'error', text: result.error }
          : { kind: 'ok', text: 'Injury history recorded — it drives Layer 1 gating from day one.' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Site (tissue channel)
        <select value={site} onChange={(e) => setSite(e.target.value)}>
          {[
            'hamstringHighVelocity',
            'calfAchillesHighVelocity',
            'kneeExtensor',
            'hipExtensor',
            'axialCompression',
            'upperPush',
            'upperPull',
            'shoulderOverhead',
            'connectiveHighVelocity',
          ].map((c) => (
            <option key={c} value={c}>
              {tissueLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Severity
        <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
          <option>minor</option>
          <option>moderate</option>
          <option>severe</option>
        </select>
      </label>
      <label>
        When
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. left biceps femoris, sprinting" />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record'}</button>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </form>
  );
}
