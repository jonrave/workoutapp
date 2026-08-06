import type { Metadata } from 'next';
import { currentState } from '../../lib/data';
import { StorageNotice } from '../../components/StorageNotice';
import { DeviceSync } from '../../components/DeviceSync';
import { SessionLogger } from '../../components/SessionLogger';
import { QuickLog, MorningCheckIn } from './LogForms';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Log' };

export default async function LogPage() {
  const state = await currentState();
  const slots = state.standingPlan.weekStructure.map((s) => ({
    slot: s.slot,
    description: s.description,
    modality: s.modality,
    durationMinutes: s.durationMinutes,
    targetSRPE: s.targetSRPE,
  }));

  return (
    <>
      <StorageNotice />
      <section className="card">
        <h2>Quick log</h2>
        <QuickLog />
      </section>
      <section className="card">
        <h2>Planned sessions</h2>
        <p className="muted">Missed sessions feed learned adherence. No streaks, no guilt (§9).</p>
        <SessionLogger sessions={slots} />
      </section>
      <section className="card">
        <h2>Morning check-in</h2>
        <MorningCheckIn />
      </section>
      <section className="card">
        <h2>Device sync</h2>
        <DeviceSync />
      </section>
    </>
  );
}
