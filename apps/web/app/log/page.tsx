import { currentState } from '../../lib/data';
import { FreeTextLog, MorningCheckIn, QuickLog } from './LogForms';

export const dynamic = 'force-dynamic';

export default async function LogPage() {
  const state = await currentState();
  const slots = state.standingPlan.weekStructure.map((s) => ({
    slot: s.slot,
    description: s.description,
  }));

  return (
    <>
      <section className="card">
        <h2>Free-text log</h2>
        <FreeTextLog />
      </section>
      <section className="card">
        <h2>Planned sessions</h2>
        <p className="muted">Missed sessions feed learned adherence. No streaks, no guilt (§9).</p>
        <QuickLog slots={slots} />
      </section>
      <section className="card">
        <h2>Morning check-in</h2>
        <MorningCheckIn />
      </section>
    </>
  );
}
