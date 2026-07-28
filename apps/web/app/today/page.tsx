/**
 * Today's decision. "No change detected — do the planned session" is the
 * engine's expected default most weeks and is rendered as the first-class,
 * respectable outcome it is (contract §1, §11) — never as a failure state.
 */
import { currentDecision, todayIso } from '../../lib/data';

export const dynamic = 'force-dynamic';

const LAYER_NAMES: Record<number, string> = {
  0: 'Layer 0 — medical red flag',
  1: 'Layer 1 — injury & illness gate',
  2: 'Layer 2 — non-training lever',
  3: 'Layer 3 — pillar floors',
  4: 'Layer 4 — marginal allocation',
  5: 'Layer 5 — session selection',
  6: 'Layer 6 — noise gate',
};

export default async function TodayPage() {
  const { decision } = await currentDecision();
  const noChange = decision.noiseGate.outcome === 'no-change-detected';

  return (
    <>
      <section className="card headline">
        <div className="muted">{todayIso()} · fired: {LAYER_NAMES[decision.firedLayer]}</div>
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
                <strong>{s.lever}</strong>{' '}
                {s.priority === 'highest-non-emergent' && <span className="pill flag">priority</span>}
                <span className="muted"> {s.trigger.code}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decision.sessions && decision.sessions.length > 0 && (
        <section className="card">
          <h2>Today&apos;s session</h2>
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
                  <td>{s.slot}</td>
                  <td>{s.pillar}</td>
                  <td>{s.modality}</td>
                  <td>{s.blocks.map((b) => b.name).join('; ')}</td>
                  <td>{s.durationMinutes} min</td>
                  <td title="sRPE × minutes × modality multiplier (I7)">{s.expectedCost}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
              <li key={i}>
                <span className="pill flag">{gate.gate}</span>
                <span className="muted">
                  {gate.trigger.code}
                  {gate.blockedChannels.length > 0 && ` · blocks: ${gate.blockedChannels.join(', ')}`}
                </span>
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
              {decision.retest.verdict}
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
          <summary>Why — full layer trace and rationale</summary>
          <pre>{JSON.stringify({ trace: decision.trace, rationale: decision.rationale }, null, 2)}</pre>
        </details>
      </section>
    </>
  );
}
