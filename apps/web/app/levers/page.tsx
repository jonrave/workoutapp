/**
 * The lever panel (§5, I6). Values, staleness, and flags — with the single
 * next action per lever. Nothing here ever touches the training plan.
 */
import type { Metadata } from 'next';
import { CONSTANTS, daysBetween, layer2Levers } from '@peakspan/engine';
import type { Field } from '@peakspan/engine';
import { currentState, todayIso } from '../../lib/data';
import { leverLabel, rationaleText, sourceLabel, surfaceLabel } from '../../lib/labels';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Levers' };

const NEXT_ACTIONS: Record<string, string> = {
  bloodPressure: 'Discuss with a clinician; repeat the 7-day home protocol in 4 weeks.',
  apoB: 'Surface as a pharmacologic decision — lifetime cumulative exposure framing.',
  lpaNeverMeasured: 'Order an isoform-independent Lp(a) assay (nmol/L). Once per lifetime.',
  sleepDuration: 'Add sleep before adding any training. Load increases are blocked while <7h.',
  sleepTimingVariance: 'Stabilize sleep midpoint; the raw data is already collected.',
  alcohol: 'Above your set threshold this week.',
  centralAdiposity: 'Energy-balance lane — not a training reallocation.',
  metabolic: 'Re-test with your next blood panel.',
  staleness: 'Re-measure the stale fields below.',
};

export default async function LeversPage() {
  const state = await currentState();
  const today = todayIso();
  const { surfaces } = layer2Levers(state, today);

  const rows: Array<{ name: string; field: Field<number> | null; cadence?: number }> = [
    { name: 'homeSBP7d', field: state.levers.homeSBP7d, cadence: CONSTANTS.STALENESS_DAYS['homeSBP7d'] },
    { name: 'homeDBP7d', field: state.levers.homeDBP7d, cadence: CONSTANTS.STALENESS_DAYS['homeDBP7d'] },
    { name: 'apoB', field: state.levers.apoB, cadence: CONSTANTS.STALENESS_DAYS['apoB'] },
    { name: 'lpa', field: state.levers.lpa },
    { name: 'hba1c', field: state.levers.hba1c, cadence: CONSTANTS.STALENESS_DAYS['hba1c'] },
    { name: 'fastingInsulin', field: state.levers.fastingInsulin, cadence: CONSTANTS.STALENESS_DAYS['fastingInsulin'] },
    { name: 'alcoholUnits7d', field: state.levers.alcoholUnits7d },
    { name: 'waistCm', field: state.levers.waistCm, cadence: CONSTANTS.STALENESS_DAYS['waistCm'] },
  ];

  return (
    <>
      <section className="card headline">
        <h2>Non-training levers</h2>
        <p className="muted">
          For a trained athlete above population norms, the highest-value actions usually live
          here — outside the training budget. Flags surface prominently and never reallocate
          training time (I6).
        </p>
      </section>

      {surfaces.length > 0 && (
        <section className="card">
          <h2>Flagged now</h2>
          <ul>
            {surfaces.map((s) => (
              <li key={s.lever} style={{ marginBottom: '0.4rem' }}>
                <span className={`pill ${s.priority === 'highest-non-emergent' ? 'stop' : 'flag'}`}>
                  {surfaceLabel(s.lever)}
                </span>{' '}
                {NEXT_ACTIONS[s.lever] ?? ''}
                <div className="muted">{rationaleText(s.trigger)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {surfaces.length === 0 && (
        <section className="card">
          <h2>Nothing flagged</h2>
          <p className="muted">All levers inside their lines and current.</p>
        </section>
      )}

      <section className="card">
        <h2>All levers</h2>
        <div className="table-scroll">
          <table className="plain">
            <thead>
              <tr>
                <th>Lever</th>
                <th>Value</th>
                <th>Measured</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, field, cadence }) => {
                const age = field ? daysBetween(field.lastUpdated, today) : null;
                const stale = field && cadence !== undefined && age !== null && age > cadence;
                return (
                  <tr key={name}>
                    <td>{leverLabel(name)}</td>
                    <td>{field ? field.value : <span className="pill flag">never measured</span>}</td>
                    <td className="muted">
                      {field ? `${field.lastUpdated} (${age}d ago, ${sourceLabel(field.source)})` : '—'}
                    </td>
                    <td>
                      {stale ? (
                        <span className="pill flag">stale — cadence {cadence}d</span>
                      ) : field ? (
                        <span className="pill ok">current</span>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Alcohol threshold (user-set): {state.levers.alcoholThreshold7d} units / 7 days.
        </p>
      </section>
    </>
  );
}
