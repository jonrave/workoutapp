'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { slotLabel } from '../lib/labels';

const today = () => new Date().toISOString().slice(0, 10);

export interface LoggableSession {
  slot: string;
  description: string;
  modality: string;
  durationMinutes: number;
  targetSRPE: number;
}

type Outcome = 'done' | 'adjusted' | 'missed';

/**
 * Done / adjust / missed for planned sessions. "Done" logs the planned
 * duration and target sRPE; "Adjust" logs what actually happened — actual
 * sRPE is the engine's core cost input (I7), so a modified session should
 * never have to be logged as if it went to plan.
 */
export function SessionLogger({ sessions }: { sessions: LoggableSession[] }) {
  const router = useRouter();
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [sRPE, setSRPE] = useState(0);
  const [logged, setLogged] = useState<Record<string, Outcome>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function send(s: LoggableSession, outcome: Outcome, actualMinutes?: number, actualSRPE?: number) {
    setBusySlot(s.slot);
    setNotice(null);
    try {
      const body =
        outcome === 'missed'
          ? { kind: 'missed-session', plannedSlot: s.slot, occurredAt: `${today()}T12:00:00Z` }
          : {
              kind: 'activity',
              planned: true,
              plannedSlot: s.slot,
              modality: s.modality,
              durationMinutes: actualMinutes ?? s.durationMinutes,
              sRPE: actualSRPE ?? s.targetSRPE,
              occurredAt: `${today()}T12:00:00Z`,
              description: s.description,
            };
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.error) {
        setNotice({ kind: 'error', text: result.error });
      } else {
        setLogged((prev) => ({ ...prev, [s.slot]: outcome }));
        setAdjusting(null);
        setNotice({
          kind: 'ok',
          text:
            outcome === 'missed'
              ? 'Noted — adherence is learned, never moralized.'
              : outcome === 'adjusted'
                ? 'Logged as it actually went.'
                : 'Session logged as planned.',
        });
        router.refresh();
      }
    } finally {
      setBusySlot(null);
    }
  }

  function beginAdjust(s: LoggableSession) {
    setAdjusting(s.slot);
    setMinutes(s.durationMinutes);
    setSRPE(s.targetSRPE);
  }

  if (sessions.length === 0) {
    return <p className="muted">No planned sessions to log.</p>;
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
            {sessions.map((s) => {
              const outcome = logged[s.slot];
              return (
                <tr key={s.slot}>
                  <td>{slotLabel(s.slot)}</td>
                  <td>
                    {s.description}
                    <div className="muted">
                      {s.durationMinutes} min · target sRPE {s.targetSRPE}
                    </div>
                    {adjusting === s.slot && !outcome && (
                      <div className="adjust-row">
                        <label>
                          Actual minutes
                          <input
                            type="number"
                            min={1}
                            max={720}
                            value={minutes}
                            onChange={(e) => setMinutes(Number(e.target.value))}
                          />
                        </label>
                        <label>
                          Actual sRPE
                          <input
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            value={sRPE}
                            onChange={(e) => setSRPE(Number(e.target.value))}
                          />
                        </label>
                        <button
                          onClick={() => void send(s, 'adjusted', minutes, sRPE)}
                          disabled={busySlot !== null}
                        >
                          Log
                        </button>
                        <button className="secondary" onClick={() => setAdjusting(null)} disabled={busySlot !== null}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {outcome ? (
                      <span className={`pill ${outcome === 'missed' ? 'flag' : 'ok'}`}>
                        {outcome === 'missed' ? 'missed' : outcome === 'adjusted' ? 'logged (adjusted)' : 'logged'}
                      </span>
                    ) : (
                      <>
                        <button onClick={() => void send(s, 'done')} disabled={busySlot !== null}>
                          Done
                        </button>{' '}
                        <button className="secondary" onClick={() => beginAdjust(s)} disabled={busySlot !== null}>
                          Adjust…
                        </button>{' '}
                        <button className="secondary" onClick={() => void send(s, 'missed')} disabled={busySlot !== null}>
                          Missed
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
    </div>
  );
}
