import { describe, expect, it } from 'vitest';
import {
  activity,
  cmjMedianOfFive,
  defaultTypicalError,
  fitnessMeasurement,
  homeBpProtocol,
  IllPosedThresholdError,
  mapOuraDaily,
  resolveTypicalError,
  startBlock,
  StubActivityParser,
  validateEvent,
  type EventContext,
} from '../src/index';

const ctx: EventContext = {
  id: (() => {
    let n = 0;
    return () => `evt_test_${++n}`;
  })(),
  now: () => '2026-07-28T12:00:00Z',
};

describe('typicalError defaults (§8) and the no-narrowing rule', () => {
  it('supplies defaults per metric', () => {
    expect(defaultTypicalError('vo2max', 52.5)).toBeCloseTo(2.1);
    expect(defaultTypicalError('waistCm', 84.5)).toBe(1);
    expect(defaultTypicalError('homeSBP7d', 121)).toBe(4);
  });

  it('a user-provided error may widen but never narrow the default', () => {
    expect(resolveTypicalError('vo2max', 52.5, 0.5)).toBeCloseTo(2.1); // clamped up
    expect(resolveTypicalError('vo2max', 52.5, 3.5)).toBe(3.5); // widening allowed
  });
});

describe('manual constructors', () => {
  it('provenance is set by the entry path and events validate', () => {
    const e = fitnessMeasurement(
      {
        metric: 'vo2max',
        value: 54,
        unit: 'ml/kg/min',
        occurredAt: '2026-07-27T09:00:00Z',
        source: 'measured-lab',
        modality: 'run',
      },
      ctx,
    );
    expect(e.source).toBe('measured-lab');
    expect(e.typicalError).toBeCloseTo(2.16);
    expect(validateEvent(e)).toEqual(e);
  });

  it('activity events default pillar attribution and validate', () => {
    const e = activity(
      {
        planned: false,
        plannedSlot: null,
        modality: 'hike',
        durationMinutes: 120,
        sRPE: 5,
        occurredAt: '2026-07-26T15:00:00Z',
        tissueLoad: { kneeExtensor: 200, calfAchillesHighVelocity: 100 },
      },
      ctx,
    );
    expect(e.pillarLoad.zone2).toBe(600);
    expect(validateEvent(e)).toEqual(e);
  });

  it('validation rejects implausible values', () => {
    const e = activity(
      {
        planned: false,
        plannedSlot: null,
        modality: 'run',
        durationMinutes: 30,
        sRPE: 4,
        occurredAt: '2026-07-26T15:00:00Z',
      },
      ctx,
    );
    expect(() => validateEvent({ ...e, sRPE: 14 })).toThrow();
    expect(() => validateEvent({ ...e, durationMinutes: 0 })).toThrow();
  });
});

describe('block pre-registration (I10 + approved RA2 validation)', () => {
  const base = {
    pillar: 'vo2max' as const,
    plannedWeeks: 8,
    metricUnderTest: 'vo2max' as const,
    baselineValue: 52.5,
    baselineTypicalError: 2.1,
    direction: 'increase' as const,
    unit: 'ml/kg/min',
    occurredAt: '2026-07-28T09:00:00Z',
  };

  it('refuses a threshold inside the noise band', () => {
    // SDC = 5.82; 55.5 is only +3.0 from baseline — the RA2 ill-posed case.
    expect(() => startBlock({ ...base, thresholdValue: 55.5 }, ctx)).toThrow(
      IllPosedThresholdError,
    );
  });

  it('refuses a threshold on the wrong side of baseline', () => {
    expect(() => startBlock({ ...base, thresholdValue: 50 }, ctx)).toThrow(IllPosedThresholdError);
  });

  it('registers a well-posed threshold immutably-shaped', () => {
    const e = startBlock({ ...base, thresholdValue: 58.5 }, ctx);
    expect(e.preRegisteredThreshold).toMatchObject({
      metric: 'vo2max',
      direction: 'increase',
      value: 58.5,
    });
    expect(validateEvent(e)).toEqual(e);
  });
});

describe('guided protocols (§8, §5)', () => {
  it('CMJ requires exactly 5 jumps and reports the median', () => {
    expect(() => cmjMedianOfFive([40, 41, 42], '2026-07-27', ctx)).toThrow();
    const e = cmjMedianOfFive([39.5, 41.2, 42.0, 40.8, 43.1], '2026-07-27', ctx);
    expect(e.value).toBe(41.2);
    expect(e.source).toBe('measured-field');
  });

  it('BP protocol discards the first reading of each sitting', () => {
    const day = (date: string, first: number) => ({
      date,
      morning: {
        readings: [
          { sbp: first, dbp: 90 }, // discarded
          { sbp: 120, dbp: 76 },
          { sbp: 122, dbp: 78 },
        ],
      },
      evening: {
        readings: [
          { sbp: first, dbp: 90 }, // discarded
          { sbp: 124, dbp: 80 },
        ],
      },
    });
    const days = ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25'].map((d) =>
      day(d, 160), // wildly high first readings must not contaminate the mean
    );
    const { sbp, dbp } = homeBpProtocol(days, ctx);
    expect(sbp.value).toBe(122.5); // mean of (121, 124) per day — 160s discarded
    expect(dbp.value).toBe(78.5);
    expect(sbp.lever).toBe('homeSBP7d');
  });

  it('BP protocol rejects sittings with a single reading', () => {
    const bad = [
      {
        date: '2026-07-21',
        morning: { readings: [{ sbp: 120, dbp: 76 }] },
        evening: { readings: [{ sbp: 120, dbp: 76 }, { sbp: 121, dbp: 77 }] },
      },
    ];
    expect(() => homeBpProtocol([...bad, ...bad, ...bad, ...bad, ...bad] as never, ctx)).toThrow(
      /at least 2 readings/,
    );
  });
});

describe('Oura adapter (I4: raw signals only)', () => {
  it('maps raw signals and converts rMSSD to ln rMSSD', () => {
    const events = mapOuraDaily(
      {
        day: '2026-07-27',
        average_hrv: 74,
        resting_heart_rate: 47,
        total_sleep_duration_seconds: 7.4 * 3600,
        readiness_score: 85,
        sleep_score: 90,
      },
      ctx,
    );
    const signals = events.map((e) => e.signal);
    expect(signals).toEqual(['hrvLnRmssd', 'restingHr', 'sleepDurationHours']);
    expect(events[0]!.value).toBeCloseTo(Math.log(74), 3);
    expect(events.every((e) => e.source === 'device-raw')).toBe(true);
    // The composite scores must leave no trace anywhere in the output (I4).
    expect(JSON.stringify(events)).not.toContain('85');
    expect(JSON.stringify(events)).not.toContain('readiness');
  });
});

describe('free-text parser interface (I2a)', () => {
  it('stub parser produces a draft that always needs confirmation', async () => {
    const draft = await new StubActivityParser().parse(
      'played 70 min pickup soccer, legs cooked',
      '2026-07-26',
    );
    expect(draft.needsConfirmation).toBe(true);
    expect(draft.durationMinutes).toBe(70);
    expect(draft.tissueChannels).toContain('hamstringHighVelocity');
    expect(draft.confidence).toBe('low');
  });
});
