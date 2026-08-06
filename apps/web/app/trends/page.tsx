import type { Metadata } from 'next';
import { CONSTANTS } from '@peakspan/engine';
import { currentState, readEvents } from '../../lib/data';
import { TrendChart, type TrendPoint } from '../../components/TrendChart';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Trends' };

/**
 * Daily signal → rolling 7-day mean series, matching the projector's window
 * (I5: single days never enter the engine; neither should the eye lead with
 * them).
 */
function rolling7d(daily: TrendPoint[], decimals: number): TrendPoint[] {
  const f = 10 ** decimals;
  return daily.map((p, i) => {
    const window = daily.filter(
      (q, j) => j <= i && (Date.parse(p.date) - Date.parse(q.date)) / 86_400_000 < 7,
    );
    const mean = window.reduce((s, q) => s + q.value, 0) / window.length;
    return { date: p.date, value: Math.round(mean * f) / f };
  });
}

export default async function TrendsPage() {
  const [state, events] = await Promise.all([currentState(), readEvents()]);

  const series = (pick: (e: (typeof events)[number]) => TrendPoint | null): TrendPoint[] =>
    events
      .map(pick)
      .filter((p): p is TrendPoint => p !== null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));

  const cmj = series((e) =>
    e.type === 'fitness-measurement' && e.metric === 'cmjHeight'
      ? { date: e.occurredAt.slice(0, 10), value: e.value }
      : null,
  );
  const waist = series((e) =>
    e.type === 'lever-measurement' && e.lever === 'waistCm'
      ? { date: e.occurredAt.slice(0, 10), value: e.value }
      : null,
  );
  const vo2 = series((e) =>
    (e.type === 'fitness-measurement' || e.type === 'retest') && e.metric === 'vo2max'
      ? { date: e.occurredAt.slice(0, 10), value: e.value }
      : null,
  );
  if (cmj.length === 0 && state.fitness.cmjHeight !== null) {
    cmj.push({ date: state.fitness.cmjHeight.lastUpdated, value: state.fitness.cmjHeight.value });
  }
  if (waist.length === 0 && state.levers.waistCm !== null) {
    waist.push({ date: state.levers.waistCm.lastUpdated, value: state.levers.waistCm.value });
  }
  if (vo2.length === 0 && state.fitness.vo2max !== null) {
    vo2.push({ date: state.fitness.vo2max.lastUpdated, value: state.fitness.vo2max.value });
  }

  const signalSeries = (signal: string): TrendPoint[] =>
    series((e) =>
      e.type === 'recovery-signal' && e.signal === signal
        ? { date: e.occurredAt.slice(0, 10), value: e.value }
        : null,
    );
  const hrv7d = rolling7d(signalSeries('hrvLnRmssd'), 3);
  const rhr7d = rolling7d(signalSeries('restingHr'), 1);
  const sleep7d = rolling7d(signalSeries('sleepDurationHours'), 2);

  const hrvBaseline = state.recovery.hrvBaseline60d;
  const hrvSD = state.recovery.hrvBaselineSD;
  const hrvFlagLine =
    hrvBaseline && hrvSD
      ? {
          value: Math.round((hrvBaseline.value - CONSTANTS.HRV_FLAG_SD * hrvSD.value) * 1000) / 1000,
          label: 'flag threshold',
        }
      : undefined;

  const empty = (what: string) => (
    <p className="muted">No {what} on record yet — record one and the chart draws itself.</p>
  );

  return (
    <>
      <section className="card headline">
        <h2>Trends</h2>
        <p className="muted">
          Every chart carries its SDC band — a percentile or a weekly wiggle without measurement
          error is meaningless at the individual level (§9). Trends are read over quarters, not
          weeks.
        </p>
      </section>
      <section className="card">
        <h2>CMJ height (weekly median of 5)</h2>
        {cmj.length > 0 ? (
          <TrendChart
            title="CMJ height"
            unit="cm"
            points={cmj}
            typicalError={state.fitness.cmjHeight?.typicalError ?? 0}
          />
        ) : (
          empty('CMJ measurement')
        )}
      </section>
      <section className="card">
        <h2>Waist (weekly)</h2>
        {waist.length > 0 ? (
          <TrendChart
            title="Waist"
            unit="cm"
            points={waist}
            typicalError={state.levers.waistCm?.typicalError ?? 0}
          />
        ) : (
          empty('waist measurement')
        )}
      </section>
      <section className="card">
        <h2>HRV — 7-day rolling mean (ln rMSSD)</h2>
        {hrv7d.length > 0 ? (
          <TrendChart
            title="HRV 7-day mean"
            unit="ln rMSSD"
            points={hrv7d}
            typicalError={0}
            {...(hrvFlagLine ? { refLine: hrvFlagLine } : {})}
            caption={
              hrvFlagLine
                ? `Dashed line = your 60-day baseline − ${CONSTANTS.HRV_FLAG_SD} SD (${hrvFlagLine.value}). The engine flags only when the 7-day mean sits below it, sustained — one low morning changes nothing (I5).`
                : 'Rolling 7-day mean. The flag threshold appears once a 60-day baseline accumulates (I5).'
            }
          />
        ) : (
          empty('HRV reading — sync a device or log one')
        )}
      </section>
      <section className="card">
        <h2>Resting HR — 7-day rolling mean</h2>
        {rhr7d.length > 0 ? (
          <TrendChart
            title="Resting HR 7-day mean"
            unit="bpm"
            points={rhr7d}
            typicalError={0}
            caption="Rolling 7-day mean of nightly resting HR. Corroborates the HRV flag; never acts alone."
          />
        ) : (
          empty('resting HR reading')
        )}
      </section>
      <section className="card">
        <h2>Sleep — 7-day rolling mean</h2>
        {sleep7d.length > 0 ? (
          <TrendChart
            title="Sleep 7-day mean"
            unit="h"
            points={sleep7d}
            typicalError={0}
            refLine={{ value: CONSTANTS.SLEEP_LEVER_HOURS, label: 'load-increase block' }}
            caption="Below the dashed line the engine blocks any increase in training load — adding sleep beats adding sessions (§5)."
          />
        ) : (
          empty('sleep reading')
        )}
      </section>
      <section className="card">
        <h2>VO2max (annual GXT / block retests)</h2>
        {vo2.length > 0 ? (
          <TrendChart
            title="VO2max"
            unit="ml/kg/min"
            points={vo2}
            typicalError={state.fitness.vo2max?.typicalError ?? 0}
          />
        ) : (
          empty('VO2max measurement')
        )}
      </section>
    </>
  );
}
