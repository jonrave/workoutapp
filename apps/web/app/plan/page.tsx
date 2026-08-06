import type { Metadata } from 'next';
import { planFloorAudit } from '@peakspan/engine';
import { currentState } from '../../lib/data';
import { modalityLabel, pillarLabel, slotLabel } from '../../lib/labels';
import { PlanEditor } from './PlanEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Plan' };

export default async function PlanPage() {
  const state = await currentState();
  const plan = state.standingPlan;
  const audit = planFloorAudit(state);

  return (
    <>
      <section className="card headline">
        <h2>Standing plan</h2>
        <p className="muted">
          The default output most weeks is: do the planned session. Last changed {plan.lastChanged}.
        </p>
      </section>

      {(audit.deficits.length > 0 || audit.i9Violations.length > 0) && (
        <section className="card">
          <h2>Plan warnings</h2>
          {audit.deficits.length > 0 && (
            <p>
              <span className="pill flag">Floor missing</span>{' '}
              The plan does not structurally carry the maintenance floor for:{' '}
              {audit.deficits.map(pillarLabel).join(', ')}. Losing a pillar costs far more than
              gaining one is worth (§4) — add its minimum dose back.
            </p>
          )}
          {audit.i9Violations.map((v) => (
            <p key={v.slot}>
              <span className="pill flag">I9</span> {slotLabel(v.slot)}: interval work is planned
              on {modalityLabel(v.modality)}, which is not in your VO₂-capable modalities. The
              engine will substitute your primary capable modality until this is fixed here.
            </p>
          ))}
        </section>
      )}
      <section className="card">
        <div className="table-scroll">
          <table className="plain">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Pillar</th>
                <th>Modality</th>
                <th>Session</th>
                <th>Min</th>
                <th>sRPE</th>
                <th>Adherence</th>
              </tr>
            </thead>
            <tbody>
              {plan.weekStructure.map((s) => {
                const adherence = state.history.adherenceBySlot[s.slot];
                return (
                  <tr key={s.slot}>
                    <td>{slotLabel(s.slot)}</td>
                    <td>{pillarLabel(s.pillar)}</td>
                    <td>{modalityLabel(s.modality)}</td>
                    <td>{s.description}</td>
                    <td>{s.durationMinutes}</td>
                    <td>{s.targetSRPE}</td>
                    <td>
                      {adherence !== undefined ? (
                        <span className={`pill ${adherence < 0.6 ? 'flag' : 'ok'}`}>
                          {Math.round(adherence * 100)}%
                        </span>
                      ) : (
                        <span className="muted">learning…</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Adherence is learned from outcomes, never declared. Slots that complete rarely stop
          receiving hard work (§3).
        </p>
      </section>
      <section className="card">
        <details className="trace">
          <summary>Edit standing plan</summary>
          <p className="muted">
            Changes here are declared facts — your actual week, recorded to the log as a
            plan-update event. Day-to-day adjustments stay the engine&apos;s job.
          </p>
          <PlanEditor
            initial={plan.weekStructure.map((s) => ({
              slot: s.slot,
              pillar: s.pillar,
              modality: s.modality,
              description: s.description,
              durationMinutes: s.durationMinutes,
              targetSRPE: s.targetSRPE,
            }))}
          />
        </details>
      </section>
    </>
  );
}
