import { currentState } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const state = await currentState();
  const plan = state.standingPlan;

  return (
    <>
      <section className="card headline">
        <h2>Standing plan</h2>
        <p className="muted">
          The default output most weeks is: do the planned session. Last changed {plan.lastChanged}.
        </p>
      </section>
      <section className="card">
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
                  <td>{s.slot}</td>
                  <td>{s.pillar}</td>
                  <td>{s.modality}</td>
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
        <p className="muted">
          Adherence is learned from outcomes, never declared. Slots that complete rarely stop
          receiving hard work (§3).
        </p>
      </section>
    </>
  );
}
