import { describe, expect, it } from 'vitest';
import {
  OuraClient,
  classifyStravaSport,
  mapOuraSleepDocV2,
  mapStravaActivity,
  withDeterministicOuraIds,
} from '../src/index';
import type { EventContext } from '../src/manual';

const ctx: EventContext = (() => {
  let n = 0;
  return { id: () => `t_${++n}`, now: () => '2026-08-05T12:00:00Z' };
})();

describe('Oura v2 mapping (raw signals only, I4)', () => {
  const doc = {
    day: '2026-08-04',
    average_hrv: 68,
    lowest_heart_rate: 44,
    total_sleep_duration: 26100, // 7.25 h
    bedtime_start: '2026-08-03T23:00:00-04:00',
    bedtime_end: '2026-08-04T07:00:00-04:00',
    type: 'long_sleep',
  };

  it('maps hrv (ln rMSSD), rhr, sleep hours and midpoint; never any score', () => {
    const events = mapOuraSleepDocV2(doc, ctx);
    const bySignal = Object.fromEntries(events.map((e) => [e.signal, e.value]));
    expect(bySignal.hrvLnRmssd).toBeCloseTo(Math.log(68), 3);
    expect(bySignal.restingHr).toBe(44);
    expect(bySignal.sleepDurationHours).toBeCloseTo(7.25, 2);
    expect(bySignal.sleepMidpointClockTime).toBeGreaterThan(720); // normalized night scale
    expect(events.every((e) => e.source === 'device-raw')).toBe(true);
  });

  it('skips naps for nightly signals', () => {
    expect(mapOuraSleepDocV2({ ...doc, type: 'late_nap' }, ctx)).toHaveLength(0);
  });

  it('deterministic ids make pulls idempotent', () => {
    const ids = withDeterministicOuraIds(mapOuraSleepDocV2(doc, ctx)).map((e) => e.id);
    expect(ids).toContain('oura_2026-08-04_restingHr');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('client paginates and returns mapped events', async () => {
    const pages = [
      { data: [doc], next_token: 'tok2' },
      { data: [{ ...doc, day: '2026-08-05' }], next_token: null },
    ];
    let call = 0;
    const fakeFetch = (async (url: string) => {
      const body = pages[call++];
      expect(String(url)).toContain('api.ouraring.com/v2/usercollection/sleep');
      return { ok: true, json: async () => body, text: async () => '' };
    }) as unknown as typeof fetch;
    const events = await new OuraClient('token', fakeFetch).pullSleep('2026-07-06', '2026-08-05', ctx);
    expect(call).toBe(2);
    expect(events.some((e) => e.id === 'oura_2026-08-05_restingHr')).toBe(true);
  });
});

describe('Strava mapping (§6: load classification, not minutes)', () => {
  it('maps a run with logged perceived exertion', () => {
    const ev = mapStravaActivity(
      {
        id: 987, name: 'Evening run', sport_type: 'Run', moving_time: 2700,
        start_date_local: '2026-08-04T18:05:00Z', perceived_exertion: 5,
      },
      ctx,
    )!;
    expect(ev.id).toBe('strava_987');
    expect(ev.modality).toBe('run');
    expect(ev.durationMinutes).toBe(45);
    expect(ev.sRPE).toBe(5);
    expect(ev.planned).toBe(false);
    expect(ev.source).toBe('device-raw');
    expect(ev.pillarLoad?.zone2).toBeGreaterThan(0);
  });

  it('interval-named runs classify as hard running with HV tissue exposure', () => {
    const profile = classifyStravaSport('Run', 'Track intervals 6x800');
    expect(profile.pillars.vo2max).toBe(0.8);
    expect(profile.tissue.hamstringHighVelocity).toBeGreaterThan(0);
  });

  it('sport types map to the game profile; unknown types degrade gracefully', () => {
    expect(classifyStravaSport('Soccer').tissue.hamstringHighVelocity).toBeGreaterThan(0);
    expect(classifyStravaSport('Windsurf').modality).toBe('other');
  });

  it('rejects unusable rows instead of guessing', () => {
    expect(mapStravaActivity({ id: 1, moving_time: 0, sport_type: 'Run' }, ctx)).toBeNull();
  });
});
