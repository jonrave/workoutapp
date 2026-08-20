import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '@peakspan/engine';
import {
  GATE_TUNABLES,
  buildGateDays,
  newestRecordAgeHours,
  planGateEvents,
  renderGateCurrentMd,
  renderGateSeriesCsv,
  type GateDay,
} from '../src/index';
import type { EventContext } from '../src/manual';

const ctx: EventContext = (() => {
  let n = 0;
  return { id: () => `t_${++n}`, now: () => '2026-08-19T11:30:00Z' };
})();

const sleepDoc = {
  day: '2026-08-18',
  average_hrv: 68,
  lowest_heart_rate: 44,
  total_sleep_duration: 26100, // 7.25 h
  type: 'long_sleep',
};
const readinessDoc = { day: '2026-08-18', score: 82, temperature_deviation: -0.12 };

describe('buildGateDays', () => {
  it('joins both endpoints per day and renders absent days explicitly', () => {
    const days = buildGateDays([sleepDoc], [readinessDoc], '2026-08-19', 3);
    expect(days.map((d) => d.day)).toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
    expect(days[0]!.present).toBe(false);
    expect(days[1]).toMatchObject({
      present: true,
      score: 82,
      rhrBpm: 44,
      hrvMs: 68,
      temperatureDeviation: -0.12,
      sleepHours: 7.25,
    });
    // Readiness-only day still counts as present (worn, sleep doc not synced yet).
    const readinessOnly = buildGateDays([], [{ ...readinessDoc, day: '2026-08-19' }], '2026-08-19', 1);
    expect(readinessOnly[0]!.present).toBe(true);
    expect(readinessOnly[0]!.rhrBpm).toBeNull();
  });

  it('ignores naps and picks the longest nightly period of a day', () => {
    const nap = { ...sleepDoc, type: 'late_nap', lowest_heart_rate: 39 };
    const short = { ...sleepDoc, total_sleep_duration: 3600, lowest_heart_rate: 50 };
    const days = buildGateDays([nap, short, sleepDoc], [], '2026-08-18', 1);
    expect(days[0]!.rhrBpm).toBe(44);
    expect(days[0]!.sleepHours).toBe(7.25);
  });
});

describe('gate_current.md', () => {
  const days = buildGateDays([sleepDoc], [readinessDoc], '2026-08-19', 14);

  it('starts with generated_at, has one row per day, marks gaps explicitly', () => {
    const md = renderGateCurrentMd(days, '2026-08-19T11:30:00Z');
    const lines = md.split('\n');
    expect(lines[0]).toBe('generated_at: 2026-08-19T11:30:00Z');
    expect(md.match(/^\| 2026-/gm)).toHaveLength(14);
    expect(md).toContain('| 2026-08-17 | not worn or not synced |');
    expect(md).toContain('| 2026-08-18 | 82 | 44 | 68 | -0.12 | 7.25 |');
  });

  it('surfaces both reference comparisons without a pass/fail verdict', () => {
    const md = renderGateCurrentMd(days, '2026-08-19T11:30:00Z');
    expect(md).toContain('44 bpm vs reference 46 bpm (delta -2.0)');
    expect(md).toContain('68 ms vs reference 72 ms (delta -4.0)');
    expect(md).toContain('No pass/fail rule is encoded');
    expect(md.toLowerCase()).not.toContain('pass |');
    expect(md.toLowerCase()).not.toContain('fail |');
  });

  it('is fresh at 11.5h and stale past 36h, naming the age in hours', () => {
    const fresh = renderGateCurrentMd(days, '2026-08-19T11:30:00Z');
    expect(fresh).not.toContain('STALE');
    expect(newestRecordAgeHours(days, '2026-08-19T11:30:00Z')).toBeCloseTo(11.5, 5);

    const staleDays = buildGateDays(
      [{ ...sleepDoc, day: '2026-08-15' }],
      [{ ...readinessDoc, day: '2026-08-15' }],
      '2026-08-19',
      14,
    );
    const stale = renderGateCurrentMd(staleDays, '2026-08-19T11:30:00Z');
    expect(stale.split('\n')[0]).toBe('generated_at: 2026-08-19T11:30:00Z');
    expect(stale).toContain('STALE: newest record (2026-08-15) is 83 hours older than generated_at.');
  });

  it('contains no em dashes (hard constraint on generated prose)', () => {
    const md = renderGateCurrentMd(days, '2026-08-19T11:30:00Z');
    expect(md).not.toContain('—');
    expect(renderGateSeriesCsv(days)).not.toContain('—');
  });
});

describe('gate_series.csv', () => {
  it('is flat, oldest first, with explicit status for gap days', () => {
    const days = buildGateDays([sleepDoc], [readinessDoc], '2026-08-19', 180);
    const csv = renderGateSeriesCsv(days);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('date,oura_score,rhr_bpm,hrv_ms,temp_dev_c,sleep_h,status');
    expect(lines).toHaveLength(181);
    expect(lines[1]!.startsWith('2026-02-21,')).toBe(true);
    expect(lines[1]).toContain('not_worn_or_not_synced');
    expect(lines[179]).toBe('2026-08-18,82,44,68,-0.12,7.25,ok');
  });
});

describe('planGateEvents (idempotent ingest with supersede-on-revision)', () => {
  const days: GateDay[] = buildGateDays([sleepDoc], [readinessDoc], '2026-08-18', 1);

  it('plans one event per raw metric on first sight, none for the score', () => {
    const planned = planGateEvents([], days, ctx);
    expect(planned.map((e) => e.id).sort()).toEqual([
      'oura_2026-08-18_hrvLnRmssd',
      'oura_2026-08-18_restingHr',
      'oura_2026-08-18_sleepDurationHours',
      'oura_2026-08-18_temperatureDeviation',
    ]);
    expect(planned.every((e) => e.source === 'device-raw')).toBe(true);
    expect(planned.find((e) => e.id.endsWith('hrvLnRmssd'))?.value).toBeCloseTo(Math.log(68), 3);
  });

  it('re-running with unchanged values plans nothing', () => {
    const first = planGateEvents([], days, ctx);
    expect(planGateEvents(first as EngineEvent[], days, ctx)).toHaveLength(0);
  });

  it('a revised value supersedes via a _rev event; unchanged revisions stay idempotent', () => {
    const first = planGateEvents([], days, ctx) as EngineEvent[];
    const revisedDays = buildGateDays(
      [{ ...sleepDoc, lowest_heart_rate: 45 }],
      [readinessDoc],
      '2026-08-18',
      1,
    );
    const second = planGateEvents(first, revisedDays, ctx);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe('oura_2026-08-18_restingHr_rev1');
    expect(second[0]!.value).toBe(45);
    const third = planGateEvents([...first, ...second] as EngineEvent[], revisedDays, ctx);
    expect(third).toHaveLength(0);
  });
});

describe('gate tunables hygiene (contract §11)', () => {
  it('holds the personal reference lines as conventions', () => {
    expect(GATE_TUNABLES.RHR_REFERENCE_BPM).toBe(46);
    expect(GATE_TUNABLES.HRV_REFERENCE_MS).toBe(72);
  });

  it('every tunable is marked convention or evidence in source', () => {
    const src = readFileSync(new URL('../src/oura-gate.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('export const GATE_TUNABLES'), src.indexOf('} as const'));
    const lines = block.split('\n');
    const keys = lines.filter((l) => /^\s+[A-Z_]+:/.test(l));
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const key of keys) {
      const prev = lines[lines.indexOf(key) - 1];
      expect(prev, `tunable missing convention/evidence marker: ${key.trim()}`).toMatch(
        /(convention|evidence):/,
      );
    }
  });
});
