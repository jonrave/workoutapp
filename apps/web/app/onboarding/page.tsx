/**
 * Intake: the user enters facts and raw readings, never derived state — there
 * is no field here for hrv7d, baselines, or any vendor composite score (I4).
 * Everything entered becomes an event; all rolling statistics are projected.
 */
import type { Metadata } from 'next';
import { currentState } from '../../lib/data';
import { modalityLabel } from '../../lib/labels';
import { InjuryIntake, LeverIntake, MeasurementIntake } from './IntakeForms';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Intake' };

export default async function OnboardingPage() {
  const state = await currentState();
  const p = state.profile;

  return (
    <>
      <section className="card headline">
        <h2>Intake</h2>
        <p className="muted">
          You enter facts and raw readings; every rolling statistic is derived from the event log.
          There is deliberately nowhere to enter a readiness score (I4) or a 7-day mean.
        </p>
      </section>

      <section className="card">
        <h2>Profile</h2>
        <div className="table-scroll">
        <table className="plain">
          <tbody>
            <tr>
              <th>Age / sex</th>
              <td>
                {p.age} / {p.sex}
              </td>
              <th>Training age</th>
              <td>{p.trainingAgeYears} years</td>
            </tr>
            <tr>
              <th>VO2-capable modalities</th>
              <td colSpan={3}>
                {p.vo2CapableModalities.map(modalityLabel).join(', ')}{' '}
                <span className="muted">
                  — interval work is only ever prescribed on these (I9); zones come from measured
                  thresholds, never 220 − age
                </span>
              </td>
            </tr>
            <tr>
              <th>Weekly budget</th>
              <td>{p.weeklyBudgetMinutes} min</td>
              <th>Equipment</th>
              <td className="muted">{p.equipment.join(', ')}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <section className="card">
        <h2>Baseline measurement</h2>
        <MeasurementIntake />
      </section>
      <section className="card">
        <h2>Lever values (with assay dates)</h2>
        <LeverIntake />
      </section>
      <section className="card">
        <h2>Injury history</h2>
        <InjuryIntake />
      </section>
    </>
  );
}
