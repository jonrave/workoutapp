/**
 * Block management (I10): the start flow refuses to proceed without a
 * registered threshold, registration refuses ill-posed thresholds inside the
 * noise band (approved RA2 rule), and retests are evaluated only against the
 * stored registration.
 */
import { sdc } from '@peakspan/engine';
import { currentState } from '../../lib/data';
import { RetestForm, StartBlockForm } from './BlockForms';

export const dynamic = 'force-dynamic';

export default async function BlocksPage() {
  const state = await currentState();
  const block = state.block;

  const metrics = ['vo2max', 'lt1Pace', 'peakPower', 'cmjHeight', 'rsi'] as const;
  const baselines = Object.fromEntries(
    metrics.map((m) => [
      m,
      { value: state.fitness[m].value, sdc: sdc(state.fitness[m].typicalError ?? 0) },
    ]),
  );

  return (
    <>
      <section className="card headline">
        <h2>Focused blocks</h2>
        <p className="muted">
          A block writes its success threshold to immutable storage before it runs. A retest
          without a pre-registered threshold is a Rorschach test and is refused (I10).
        </p>
      </section>

      {block ? (
        <section className="card">
          <h2>Active block</h2>
          <table className="plain">
            <tbody>
              <tr>
                <th>Pillar</th>
                <td>{block.activePillar}</td>
                <th>Status</th>
                <td>
                  <span className={`pill ${block.status === 'active' ? 'ok' : 'flag'}`}>
                    {block.status}
                  </span>
                </td>
              </tr>
              <tr>
                <th>Started</th>
                <td>{block.startDate}</td>
                <th>Planned</th>
                <td>{block.plannedWeeks} weeks</td>
              </tr>
              <tr>
                <th>Metric</th>
                <td>{block.metricUnderTest}</td>
                <th>Baseline at start</th>
                <td>{block.baselineAtStart}</td>
              </tr>
              <tr>
                <th>Pre-registered threshold</th>
                <td colSpan={3}>
                  {block.preRegisteredThreshold ? (
                    <>
                      {block.preRegisteredThreshold.direction} to{' '}
                      <strong>{block.preRegisteredThreshold.value}</strong>{' '}
                      {block.preRegisteredThreshold.unit}
                      <span className="muted">
                        {' '}
                        · registered {block.preRegisteredThreshold.registeredAt.slice(0, 10)} —
                        immutable
                      </span>
                    </>
                  ) : (
                    <span className="pill flag">
                      none — retests cannot be evaluated as block outcomes
                    </span>
                  )}
                </td>
              </tr>
              {block.pendingRetest && (
                <tr>
                  <th>Pending retest</th>
                  <td colSpan={3}>
                    {block.pendingRetest.value} {block.pendingRetest.unit} on{' '}
                    {block.pendingRetest.measuredAt} — verdict on Today
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <h2 style={{ marginTop: '1rem' }}>Submit retest</h2>
          <RetestForm />
        </section>
      ) : (
        <section className="card">
          <h2>No active block</h2>
        </section>
      )}

      <section className="card">
        <h2>Start a new block</h2>
        <p className="muted">
          Registration is refused if the threshold sits inside the measurement noise band
          (threshold must be at least one SDC from baseline) — a bar that noise could clear is
          unfalsifiable.
        </p>
        <StartBlockForm baselines={baselines} />
      </section>
    </>
  );
}
