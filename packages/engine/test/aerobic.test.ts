/**
 * Aerobic ledger: pure-function tests against checked-in stream fixtures
 * (fixtures/streams/) and the user's declared run calibration
 * (fixtures/calibrations/run-hr-bands.json).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cardiacDrift,
  cooperSeries,
  cooperVo2max,
  CONSTANTS,
  InvalidCalibrationError,
  timeInBands,
  validateHrBandCalibration,
  weeklyZone2Rollup,
  weekStartOf,
} from '../src/index';
import type { CooperTestEvent, HrBandCalibration, HrStream } from '../src/index';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const loadStream = (name: string): HrStream =>
  (JSON.parse(readFileSync(`${root}/fixtures/streams/${name}.json`, 'utf8')) as { stream: HrStream })
    .stream;
const runCal = (
  JSON.parse(readFileSync(`${root}/fixtures/calibrations/run-hr-bands.json`, 'utf8')) as {
    calibration: HrBandCalibration;
  }
).calibration;

describe('calibration validation', () => {
  it('accepts the user-declared run calibration', () => {
    expect(() => validateHrBandCalibration(runCal)).not.toThrow();
  });

  it('rejects non-contiguous bands — a boundary hole would silently drop samples', () => {
    const holed: HrBandCalibration = {
      ...runCal,
      bands: [
        { name: 'low', lowerBpm: 0, upperBpm: 127 },
        { name: 'zone2', lowerBpm: 130, upperBpm: 141 }, // hole at 128-129
        { name: 'top', lowerBpm: 142, upperBpm: null },
      ],
    };
    expect(() => validateHrBandCalibration(holed)).toThrow(InvalidCalibrationError);
  });

  it('rejects a closed top band — samples above it would be unclassifiable', () => {
    const closed: HrBandCalibration = {
      ...runCal,
      bands: [
        { name: 'low', lowerBpm: 0, upperBpm: 171 },
        { name: 'zone5', lowerBpm: 172, upperBpm: 195 },
      ],
    };
    expect(() => validateHrBandCalibration(closed)).toThrow(InvalidCalibrationError);
  });
});

describe('time in band', () => {
  it('attributes a steady zone-2 run almost entirely to zone2, time-weighted', () => {
    const r = timeInBands(loadStream('steady-run'), runCal);
    expect(r.gapSeconds).toBe(0);
    expect(r.trackedSeconds).toBe(2400);
    // HR ramps 130 -> 137 with ±1 wobble: everything sits in 128-141.
    expect(r.bandSeconds['zone2']).toBe(2400);
    expect(r.bandSeconds['zone5']).toBe(0);
    expect(r.meanHrBpm).toBeGreaterThan(130);
    expect(r.meanHrBpm).toBeLessThan(137);
  });

  it('records zone5 time for an interval session against the personal 172 line', () => {
    const r = timeInBands(loadStream('interval-run'), runCal);
    expect(r.bandSeconds['zone5']).toBeGreaterThan(100);
    expect(r.bandSeconds['zone2']).toBeGreaterThan(0);
    expect(r.maxHrBpm).toBeGreaterThanOrEqual(172);
  });

  it('excludes a recording dropout from tracked time instead of fabricating band minutes', () => {
    const r = timeInBands(loadStream('gapped-run'), runCal);
    expect(r.gapSeconds).toBeGreaterThanOrEqual(120);
    // 1800s span minus the dropout: tracked time reflects only sampled intervals.
    expect(r.trackedSeconds + r.gapSeconds).toBe(1800);
    expect(r.bandSeconds['zone2']).toBe(r.trackedSeconds);
  });

  it('sums band seconds exactly to tracked seconds — a full partition leaves nowhere to hide', () => {
    const r = timeInBands(loadStream('interval-run'), runCal);
    const sum = Object.values(r.bandSeconds).reduce((s, x) => s + x, 0);
    expect(sum).toBe(r.trackedSeconds);
  });
});

describe('cardiac drift', () => {
  it('measures drift cleanly on a steady run with a work-rate stream', () => {
    const d = cardiacDrift(loadStream('steady-run'));
    expect(d.kind).toBe('measured');
    if (d.kind === 'measured') {
      expect(d.deltaBpm).toBeGreaterThan(1.5);
      expect(d.deltaBpm).toBeLessThan(6);
      expect(d.workRateSource).toBe('velocity');
      expect(d.workRateHalfDeltaPct).toBeLessThanOrEqual(CONSTANTS.DRIFT_WORKRATE_HALF_DELTA_PCT);
    }
  });

  it('flags an interval session as confounded rather than reporting clean drift', () => {
    const d = cardiacDrift(loadStream('interval-run'));
    expect(d.kind).toBe('confounded');
    if (d.kind === 'confounded') {
      expect(d.reason).toBe('variable-work-rate');
      expect(typeof d.deltaBpm).toBe('number'); // carried, labeled, never clean
    }
  });

  it('flags an HR-only stream as confounded: no work rate to match halves against', () => {
    const d = cardiacDrift(loadStream('hr-only-run'));
    expect(d.kind).toBe('confounded');
    if (d.kind === 'confounded') {
      expect(d.reason).toBe('no-work-rate-stream');
      expect(d.workRateSource).toBeNull();
    }
  });

  it('declines to compute drift on a session shorter than the minimum', () => {
    const short: HrStream = {
      time: Array.from({ length: 60 }, (_, i) => i * 5),
      heartrate: Array.from({ length: 60 }, () => 130),
      velocity: Array.from({ length: 60 }, () => 3),
    };
    expect(cardiacDrift(short)).toEqual({ kind: 'unavailable', reason: 'too-short' });
  });
});

describe('weekly zone 2 rollup', () => {
  const session = (day: string, zone2Seconds: number) => ({
    occurredAt: `${day}T12:00:00Z`,
    timeInBandSeconds: { zone2: zone2Seconds, zone5: 0 },
  });

  it('anchors weeks to Monday', () => {
    expect(weekStartOf('2026-07-27')).toBe('2026-07-27'); // a Monday
    expect(weekStartOf('2026-08-02')).toBe('2026-07-27'); // the following Sunday
    expect(weekStartOf('2026-08-03')).toBe('2026-08-03');
  });

  it('sums stream-verified zone2 minutes per week against the 180-minute floor', () => {
    const weeks = weeklyZone2Rollup([
      session('2026-07-27', 60 * 60),
      session('2026-07-29', 70 * 60),
      session('2026-08-01', 55 * 60), // same week: 185 min total
      session('2026-08-04', 40 * 60), // next week: 40 min
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toEqual({
      weekStart: '2026-07-27',
      zone2Minutes: 185,
      floorMinutes: CONSTANTS.WEEKLY_ZONE2_FLOOR_MIN,
      metFloor: true,
    });
    expect(weeks[1]!.zone2Minutes).toBe(40);
    expect(weeks[1]!.metFloor).toBe(false);
  });

  it('shows an empty week as zero recorded minutes rather than skipping it', () => {
    const weeks = weeklyZone2Rollup([
      session('2026-07-27', 200 * 60),
      session('2026-08-12', 190 * 60), // two weeks later
    ]);
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-07-27', '2026-08-03', '2026-08-10']);
    expect(weeks[1]!.zone2Minutes).toBe(0);
    expect(weeks[1]!.metFloor).toBe(false);
  });
});

describe('Cooper series', () => {
  it('computes VO2max from 12-minute distance by the Cooper regression', () => {
    expect(cooperVo2max(2800)).toBe(51.3);
    expect(cooperVo2max(504.9)).toBe(0);
  });

  it('keeps track and treadmill as separate series that are never pooled', () => {
    const mk = (day: string, surface: 'track' | 'treadmill', dist: number): CooperTestEvent => ({
      id: `cooper_${day}_${surface}`,
      type: 'cooper-test',
      occurredAt: `${day}T09:00:00Z`,
      recordedAt: `${day}T10:00:00Z`,
      source: 'measured-field',
      surface,
      distanceMeters: dist,
      vo2maxEstimate: cooperVo2max(dist),
      pacingStrategy: 'even splits',
      ...(surface === 'treadmill' ? { rampCorrection: '1% incline throughout' } : {}),
    });
    const s = cooperSeries([
      mk('2026-06-01', 'track', 2750),
      mk('2026-07-01', 'treadmill', 2820),
      mk('2026-08-01', 'track', 2790),
    ]);
    expect(s.track.map((p) => p.date)).toEqual(['2026-06-01', '2026-08-01']);
    expect(s.treadmill).toHaveLength(1);
    // No combined view exists to assert on — the API offers no pooled series.
  });
});
