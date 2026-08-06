'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MODALITY_LABELS, PILLAR_LABELS } from '../../lib/labels';

const today = () => new Date().toISOString().slice(0, 10);

export interface EditableSession {
  slot: string;
  pillar: string;
  modality: string;
  description: string;
  durationMinutes: number;
  targetSRPE: number;
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const TIMES = ['morning', 'midday', 'evening'];

/**
 * Standing-plan editor. Saving writes a plan-update event carrying the whole
 * week structure — the plan stays reproducible from the log alone, and
 * `lastChanged` reflects the edit. This edits the *standing plan* the engine
 * starts from; day-to-day adjustments remain the engine's job.
 */
export function PlanEditor({ initial }: { initial: EditableSession[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<EditableSession[]>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function update(i: number, patch: Partial<EditableSession>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function setSlot(i: number, day: string, time: string) {
    update(i, { slot: `${day}-${time}` });
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { slot: 'fri-morning', pillar: 'zone2', modality: 'run', description: '', durationMinutes: 45, targetSRPE: 4 },
    ]);
  }

  const duplicateSlots = new Set(
    rows.map((r) => r.slot).filter((s, _, all) => all.indexOf(s) !== all.lastIndexOf(s)),
  );

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'plan-update',
          occurredAt: `${today()}T09:00:00Z`,
          weekStructure: rows,
        }),
      });
      const body = await res.json();
      if (body.error) setNotice({ kind: 'error', text: body.error });
      else {
        setNotice({ kind: 'ok', text: 'Standing plan updated.' });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="table-scroll">
        <table className="plain">
          <thead>
            <tr>
              <th>Day</th>
              <th>Time</th>
              <th>Pillar</th>
              <th>Modality</th>
              <th>Session</th>
              <th>Min</th>
              <th>sRPE</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const [day = 'mon', time = 'morning'] = r.slot.split('-');
              return (
                <tr key={i}>
                  <td>
                    <select value={day} onChange={(e) => setSlot(i, e.target.value, time)}>
                      {DAYS.map((d) => (
                        <option key={d} value={d}>
                          {DAY_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={time} onChange={(e) => setSlot(i, day, e.target.value)}>
                      {TIMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={r.pillar} onChange={(e) => update(i, { pillar: e.target.value })}>
                      {Object.entries(PILLAR_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={r.modality} onChange={(e) => update(i, { modality: e.target.value })}>
                      {Object.entries(MODALITY_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={r.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                      style={{ minWidth: '12rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={5}
                      max={240}
                      value={r.durationMinutes}
                      onChange={(e) => update(i, { durationMinutes: Number(e.target.value) })}
                      style={{ width: '4.5rem' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      value={r.targetSRPE}
                      onChange={(e) => update(i, { targetSRPE: Number(e.target.value) })}
                      style={{ width: '4rem' }}
                    />
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        <button className="secondary" onClick={addRow} disabled={busy}>
          Add session
        </button>{' '}
        <button
          onClick={() => void save()}
          disabled={busy || rows.length === 0 || duplicateSlots.size > 0 || rows.some((r) => !r.description.trim())}
        >
          {busy ? 'Saving…' : 'Save standing plan'}
        </button>
      </p>
      {duplicateSlots.size > 0 && (
        <p className="muted">Each slot may appear only once — duplicated: {[...duplicateSlots].join(', ')}.</p>
      )}
      {rows.some((r) => !r.description.trim()) && (
        <p className="muted">Every session needs a description.</p>
      )}
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </div>
  );
}
