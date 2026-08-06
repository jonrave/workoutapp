/**
 * Today's decision. "No change detected — do the planned session" is the
 * engine's expected default most weeks and is rendered as the first-class,
 * respectable outcome it is (contract §1, §11) — never as a failure state.
 */
import type { Metadata } from 'next';
import { currentDecision, todayIso } from '../../lib/data';
import {
  gateLabel,
  modalityLabel,
  pillarLabel,
  rationaleText,
  retestVerdictLabel,
  slotLabel,
  surfaceLabel,
  tissueLabel,
} from '../../lib/labels';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Today' };

const LAYER_NAMES: Record<number, string> = {
  0: 'medical red flag',
  1: 'injury & illness gate',
  2: 'non-training lever',
  3: 'pillar floors',
  4: 'marginal allocation',
  5: 'session selection',
  6: 'noise gate',
};

export default async function TodayPage() {
  const { decision } = await currentDecision();
  const noChange = decision.noiseGate.outcome === 'no-change-detected';

  return (
    <>
      <section className="card headline">
        <div className="muted">
          {todayIso()} · decided at layer {decision.firedLayer} ({LAYER_NAMES[decision.firedLayer]})
        </div>
        {decision.medicalStop ? (
          <p className="big">
            <span className="pill stop">Stop</span> Stop training and seek care (
            {decision.medicalStop.reasons.join(', ')}).
          </p>
        ) : decision.sessions === null ? (
          <p className="big">
            <span className="pill stop">No training today</span> Systemic illness gate — rest,
            hydrate, and log symptoms. The §6 ramp will govern your return.
          </p>
        ) : noChange ? (
          <p className="big">
            <span className="pill ok">No change detected</span> Do the planned session.
          </p>
        ) : (
          <p className="big">
            <span className="pill flag">Adjusted</span> Today&apos;s session was modified — details
            below.
          </p>
        )}
        {noChange && (
          <p className="muted">
            Every tracked signal is inside its own smallest detectable change. A plan that changes
            often is a plan responding to noise — this is the system working.
          </p>
        )}
      </section>

      {decision.surfacedLevers.length > 0 && (
        <section className="card">
          <h2>Outside the training budget</h2>
          <p className="muted">
            Highest-value actions right now. These never consume or reallocate training time.
          </p>
          <ul>
            {decision.surfacedLevers.map((s) => (
              <li key={s.lever}>
                <strong>{surfaceLabel(s.lever)}</strong>{' '}
                {s.priority === 'highest-non-emergent' && <span className="pill flag">priority</span>}
                <div className="muted">{rationaleText(s.trigger)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decision.sessions && decision.sessions.length > 0 && (
        <section className="card">
          <h2>Today&apos;s session</h2>
          <div className="table-scroll">
            <table className="plain">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Pillar</th>
                  <th>Modality</th>
                  <th>Content</th>
                  <th>Duration</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {decision.sessions.map((s) => (
                  <tr key={s.slot + s.pillar}>
                    <td>{slotLabel(s.slot)}</td>
                    <td>{pillarLabel(s.pillar)}</td>
                    <td>{modalityLabel(s.modality)}</td>
                    <td>{s.blocks.map((b) => b.name).join('; ')}</td>
                    <td>{s.durationMinutes} min</td>
                    <td title="sRPE × minutes × modality multiplier (I7)">{s.expectedCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {decision.sessions && decision.sessions.length === 0 && (
        <section className="card">
          <h2>Rest day</h2>
          <p className="muted">Nothing on the standing plan today.</p>
        </section>
      )}

      {decision.gates.length > 0 && (
        <section className="card">
          <h2>Active gates</h2>
          <ul>
            {decision.gates.map((gate, i) => (
              <li key={i} style={{ marginBottom: '0.4rem' }}>
                <span className="pill flag">{gateLabel(gate.gate)}</span>
                <div className="muted">
                  {rationaleText(gate.trigger)}
                  {gate.blockedChannels.length > 0 &&
                    ` Blocked: ${gate.blockedChannels.map(tissueLabel).join(', ')}.`}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decision.retest && (
        <section className="card">
          <h2>Retest verdict</h2>
          <p>
            <span className={`pill ${decision.retest.verdict === 'success' ? 'ok' : 'flag'}`}>
              {retestVerdictLabel(decision.retest.verdict)}
            </span>
            {decision.retest.delta !== undefined && (
              <span className="muted">
                {' '}
                Δ {decision.retest.delta} vs SDC {decision.retest.sdc} · threshold{' '}
                {decision.retest.thresholdValue}
              </span>
            )}
          </p>
        </section>
      )}

      <section className="card">
        <details className="trace">
          <summary>Why — how this decision was made</summary>
          <ul>
            {decision.rationale.map((r, i) => (
              <li key={i}>{rationaleText(r)}</li>
            ))}
          </ul>
          <p className="muted">Cascade layers evaluated in strict order — the first to fire shapes the output:</p>
          <ul>
            {decision.trace.map((t) => (
              <li key={t.layer} className={t.fired ? undefined : 'muted'}>
                Layer {t.layer} — {LAYER_NAMES[t.layer]}: {t.fired ? 'fired' : 'passed through'}
                {t.codes.length > 0 && (
                  <ul>
                    {t.codes.map((c, i) => (
                      <li key={i} className="muted">
                        {rationaleText(c)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <details className="trace">
            <summary>Raw trace (JSON)</summary>
            <pre>{JSON.stringify({ trace: decision.trace, rationale: decision.rationale }, null, 2)}</pre>
          </details>
        </details>
      </section>
    </>
  );
}
