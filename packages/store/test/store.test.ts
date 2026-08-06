import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide, type EngineEvent, type UserState } from '@peakspan/engine';
import { activity, illness, planUpdate, profileUpdate, recoverySignal, startBlock, submitRetest, validateEvent, type EventContext } from '@peakspan/adapters';
import { ImmutabilityViolation, InMemoryEventLog, projectState } from '../src/index';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const seed = () =>
  JSON.parse(readFileSync(`${root}/fixtures/subjects/subject-a.json`, 'utf8')) as UserState;

const ctx = (): EventContext => {
  let n = 0;
  return { id: () => `evt_${++n}`, now: () => '2026-07-28T12:00:00Z' };
};

describe('event log', () => {
  it('is append-only: duplicate ids are rejected, reads round-trip', async () => {
    const log = new InMemoryEventLog();
    const c = ctx();
    const e = illness(
      { phase: 'onset', systemic: true, symptoms: ['fever'], occurredAt: '2026-07-27T08:00:00Z' },
      c,
    );
    await log.append(e);
    await expect(log.append(e)).rejects.toThrow(ImmutabilityViolation);
    expect(await log.read()).toEqual([e]);
  });

  it('a stored event cannot be replaced by a modified event with the same id', async () => {
    const log = new InMemoryEventLog();
    const c = ctx();
    const original = startBlock(
      {
        pillar: 'vo2max',
        plannedWeeks: 8,
        metricUnderTest: 'vo2max',
        baselineValue: 52.5,
        baselineTypicalError: 2.1,
        direction: 'increase',
        thresholdValue: 58.5,
        unit: 'ml/kg/min',
        occurredAt: '2026-07-28T09:00:00Z',
      },
      c,
    );
    await log.append(original);
    const tampered = structuredClone(original);
    tampered.preRegisteredThreshold.value = 53; // attempt to lower the bar post-hoc
    await expect(log.append(tampered)).rejects.toThrow(ImmutabilityViolation);
    const stored = (await log.read())[0]!;
    expect(stored.type === 'block-start' && stored.preRegisteredThreshold.value).toBe(58.5);
  });
});

describe('projector determinism (Step 5: state recomputable from the log)', () => {
  it('same seed + same log => identical state', async () => {
    const c = ctx();
    const events: EngineEvent[] = [
      recoverySignal({ signal: 'hrvLnRmssd', value: 4.2, occurredAt: '2026-07-27T07:00:00Z', source: 'device-raw' }, c),
      activity(
        {
          planned: false,
          plannedSlot: null,
          modality: 'other',
          durationMinutes: 70,
          sRPE: 8,
          occurredAt: '2026-07-26T18:00:00Z',
          pillarLoad: { vo2max: 560 },
          tissueLoad: { hamstringHighVelocity: 260, connectiveHighVelocity: 220, kneeExtensor: 200 },
          description: 'pickup soccer',
        },
        c,
      ),
    ];
    const a = projectState(seed(), events, '2026-07-27');
    const b = projectState(seed(), events, '2026-07-27');
    expect(a).toEqual(b);
    expect(a).not.toEqual(seed()); // it actually derived something
  });
});

describe('projection semantics', () => {
  it('derives rolling recovery stats from raw daily signals (I5)', () => {
    const c = ctx();
    const events: EngineEvent[] = [];
    // 60 days of stable HRV then a 10-day suppression.
    for (let i = 0; i < 60; i++) {
      const date = new Date(Date.UTC(2026, 4, 29 + i)).toISOString();
      const suppressed = i >= 50;
      events.push(
        recoverySignal(
          { signal: 'hrvLnRmssd', value: suppressed ? 3.9 : 4.31, occurredAt: date, source: 'device-raw' },
          c,
        ),
      );
    }
    const s = projectState(seed(), events, '2026-07-27');
    expect(s.recovery.hrv7d.value).toBeLessThan(4.0);
    expect(s.recovery.hrvBaseline60d.value).toBeGreaterThan(4.2);
    expect(s.recovery.hrvDaysBelowThreshold).toBeGreaterThanOrEqual(3);
    const d = decide(s, '2026-07-27');
    expect(d.gates.some((g) => g.gate === 'plyometric-block')).toBe(true);
  });

  it('classifies unplanned activity into pillar and tissue load (§6) and the engine reacts', () => {
    const c = ctx();
    const soccer = activity(
      {
        planned: false,
        plannedSlot: null,
        modality: 'other',
        durationMinutes: 70,
        sRPE: 8,
        occurredAt: '2026-07-26T18:00:00Z',
        pillarLoad: { vo2max: 560 },
        tissueLoad: { hamstringHighVelocity: 260, connectiveHighVelocity: 220, kneeExtensor: 200 },
      },
      c,
    );
    const s = projectState(seed(), [soccer], '2026-07-27');
    expect(s.load.lastUnplannedActivity).toMatchObject({ date: '2026-07-26', sRPE: 8 });
    expect(s.tissue.hamstringHighVelocity.daysSinceLastExposure).toBe(1);

    const d = decide(s, '2026-07-27');
    expect(d.firedLayer).toBe(1);
    expect(d.gates.some((g) => g.gate === 'unplanned-activity-suppression')).toBe(true);
  });

  it('block start and retest flow through to an engine verdict (I10 end to end)', () => {
    const c = ctx();
    const start = startBlock(
      {
        pillar: 'vo2max',
        plannedWeeks: 8,
        metricUnderTest: 'vo2max',
        baselineValue: 52.5,
        baselineTypicalError: 2.1,
        direction: 'increase',
        thresholdValue: 58.5,
        unit: 'ml/kg/min',
        occurredAt: '2026-06-22T09:00:00Z',
      },
      c,
    );
    const retest = submitRetest(
      {
        blockId: start.id,
        metric: 'vo2max',
        value: 59.5,
        unit: 'ml/kg/min',
        occurredAt: '2026-08-17T09:00:00Z',
        source: 'measured-lab',
      },
      c,
    );
    const s = projectState(seed(), [start, retest], '2026-08-17');
    expect(s.block?.baselineAtStart).toBe(52.5); // baseline is the pre-start value, not the retest
    expect(s.block?.preRegisteredThreshold?.value).toBe(58.5);
    expect(s.block?.pendingRetest?.value).toBe(59.5);
    expect(s.fitness.vo2max?.value).toBe(59.5); // measurement also updates fitness

    const d = decide(s, '2026-08-17');
    // Retest TE defaults to 4% of 59.5 => SDC 6.59; Δ+7.0 clears it and the threshold.
    expect(d.retest?.verdict).toBe('success');
  });

  it('learns adherence by slot from outcomes, not declarations', () => {
    const c = ctx();
    const events: EngineEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(
        activity(
          {
            planned: true,
            plannedSlot: 'mon-morning',
            modality: 'lift',
            durationMinutes: 60,
            sRPE: 7,
            occurredAt: `2026-07-${6 + i * 7}T07:00:00Z`,
          },
          c,
        ),
      );
    }
    events.push({
      ...events[0]!,
      id: 'evt_missed',
      type: 'missed-session',
      plannedSlot: 'thu-evening',
    } as EngineEvent);
    const s = projectState(seed(), events, '2026-07-28');
    expect(s.history.adherenceBySlot['mon-morning']).toBe(1);
    expect(s.history.adherenceBySlot['thu-evening']).toBe(0);
  });
});

describe('declared facts: profile and plan updates', () => {
  it('profile-update overlays only the fields present, in log order', () => {
    const c = ctx();
    const events: EngineEvent[] = [
      profileUpdate({ fields: { weeklyBudgetMinutes: 300 }, occurredAt: '2026-07-01T09:00:00Z' }, c),
      profileUpdate(
        { fields: { vo2CapableModalities: ['run', 'airBike', 'row'] }, occurredAt: '2026-07-10T09:00:00Z' },
        c,
      ),
    ];
    const s = projectState(seed(), events, '2026-07-28');
    expect(s.profile.weeklyBudgetMinutes).toBe(300);
    expect(s.profile.vo2CapableModalities).toEqual(['run', 'airBike', 'row']);
    // Untouched fields keep their seed values.
    expect(s.profile.age).toBe(seed().profile.age);
    expect(s.profile.equipment).toEqual(seed().profile.equipment);
  });

  it('plan-update replaces the week structure wholesale and stamps lastChanged', () => {
    const c = ctx();
    const structure = [
      {
        slot: 'tue-evening' as const,
        pillar: 'zone2' as const,
        modality: 'run' as const,
        description: 'Easy run',
        durationMinutes: 45,
        targetSRPE: 4,
      },
    ];
    const s = projectState(
      seed(),
      [planUpdate({ weekStructure: structure, occurredAt: '2026-07-15T09:00:00Z' }, c)],
      '2026-07-28',
    );
    expect(s.standingPlan.weekStructure).toEqual(structure);
    expect(s.standingPlan.lastChanged).toBe('2026-07-15');
  });

  it('validateEvent accepts the new kinds and rejects duplicate slots', () => {
    const c = ctx();
    const ok = planUpdate(
      {
        weekStructure: [
          { slot: 'mon-morning', pillar: 'maxStrength', modality: 'lift', description: 'Lift', durationMinutes: 60, targetSRPE: 7 },
        ],
        occurredAt: '2026-07-15T09:00:00Z',
      },
      c,
    );
    expect(validateEvent(ok)).toEqual(ok);
    const dup = planUpdate(
      {
        weekStructure: [
          { slot: 'mon-morning', pillar: 'maxStrength', modality: 'lift', description: 'Lift', durationMinutes: 60, targetSRPE: 7 },
          { slot: 'mon-morning', pillar: 'zone2', modality: 'run', description: 'Run', durationMinutes: 40, targetSRPE: 4 },
        ],
        occurredAt: '2026-07-15T09:00:00Z',
      },
      c,
    );
    expect(() => validateEvent(dup)).toThrow(/at most once/);
  });
});

describe('embedded schema stays in sync with the migration file', () => {
  it('postgres.ts SCHEMA_SQL contains every statement of 001_init.sql', () => {
    const migration = readFileSync(`${root}/packages/store/migrations/001_init.sql`, 'utf8');
    const embedded = readFileSync(
      fileURLToPath(new URL('../src/postgres.ts', import.meta.url)),
      'utf8',
    );
    // Compare statement-by-statement, ignoring whitespace and SQL comments.
    const normalize = (sql: string) =>
      sql
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const statement of migration.split(/;\s*\n\s*\n/)) {
      const wanted = normalize(statement);
      if (!wanted) continue;
      expect(normalize(embedded)).toContain(wanted);
    }
  });
});
