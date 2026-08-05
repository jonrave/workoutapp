import { currentState, readEvents } from '../../lib/data';
import { TrendChart, type TrendPoint } from '../../components/TrendChart';

export const dynamic = 'force-dynamic';

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
