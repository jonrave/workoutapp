/**
 * Stream ingestion boundary: zone labels rejected, per-modality calibration
 * enforced, lower-trust bucketed records distinct, Cooper constructor honest
 * about surface.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSTANTS } from '@peakspan/engine';
import type { HrBand, HrStream, Modality } from '@peakspan/engine';
import {
  aerobicSessionFromStream,
  bucketedZoneMinutes,
  cooperTest,
  DeviceZoneLabelRejection,
  hrBandCalibration,
  ModalityCalibrationMismatch,
  parseStreamDrop,
} from '../src/streams';
import { StravaClient, stravaEnvironment } from '../src/strava';
import type { EventContext } from '../src/manual';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const steady = (
  JSON.parse(readFileSync(`${root}/fixtures/streams/steady-run.json`, 'utf8')) as {
    stream: HrStream;
  }
).stream;
const runBands = (
  JSON.parse(readFileSync(`${root}/fixtures/calibrations/run-hr-bands.json`, 'utf8')) as {
    calibration: { modality: Modality; hrMaxBpm: number; hrRestBpm: number; bands: HrBand[] };
  }
).calibration;

const ctx = (): EventContext => {
  let n = 0;
  return { id: () => `t_${++n}`, now: () => '2026-08-08T12:00:00Z' };
};

const runCalEvent = () =>
  hrBandCalibration(
    {
      modality: runBands.modality,
      hrMaxBpm: runBands.hrMaxBpm,
      hrRestBpm: runBands.hrRestBpm,
      bands: runBands.bands,
      occurredAt: '2026-08-08T08:00:00Z',
      method: 'user-declared',
    },
    ctx(),
  );

describe('hrBandCalibration', () => {
  it('builds a user-reported calibration event from the declared run bands', () => {
    const e = runCalEvent();
    expect(e.type).toBe('hr-band-calibration');
    expect(e.source).toBe('user-reported');
    expect(e.hrMaxBpm).toBe(182);
    expect(e.bands.find((b) => b.name === 'zone2')).toEqual({
      name: 'zone2',
      lowerBpm: 128,
      upperBpm: 141,
    });
  });

  it('refuses an invalid partition at construction, before it can enter the log', () => {
    expect(() =>
      hrBandCalibration(
        {
          modality: 'run',
          hrMaxBpm: 182,
          hrRestBpm: 43,
          bands: [{ name: 'only', lowerBpm: 100, upperBpm: null }],
          occurredAt: '2026-08-08T08:00:00Z',
        },
        ctx(),
      ),
    ).toThrow(/must start at 0/);
  });
});

describe('aerobicSessionFromStream', () => {
  it('computes the session summary and records which calibration produced it', () => {
    const cal = runCalEvent();
    const e = aerobicSessionFromStream(
      {
        stream: steady,
        modality: 'run',
        calibration: cal,
        occurredAt: '2026-08-07T07:00:00Z',
        activityId: 'strava_123',
        environment: 'treadmill',
      },
      ctx(),
    );
    expect(e.id).toBe('aerobic_strava_123'); // deterministic: re-sync never duplicates
    expect(e.source).toBe('derived');
    expect(e.calibrationId).toBe(cal.id);
    expect(e.timeInBandSeconds['zone2']).toBe(2400);
    expect(e.drift.kind).toBe('measured');
  });

  it('refuses band math for a modality the calibration does not cover (I9)', () => {
    expect(() =>
      aerobicSessionFromStream(
        {
          stream: steady,
          modality: 'airBike', // uncalibrated: run bands may not be borrowed
          calibration: runCalEvent(),
          occurredAt: '2026-08-07T07:00:00Z',
        },
        ctx(),
      ),
    ).toThrow(ModalityCalibrationMismatch);
  });
});

describe('device zone label rejection', () => {
  it('rejects a payload that offers only device zone buckets', () => {
    const appleExport = {
      zones: [
        { label: 'Zone 2', minutes: 34 },
        { label: 'Zone 3', minutes: 12 },
      ],
    };
    expect(() => parseStreamDrop(appleExport)).toThrow(DeviceZoneLabelRejection);
    expect(() => parseStreamDrop(appleExport)).toThrow(/lower-trust/);
  });

  it('parses the Strava key_by_type form and the plain-array form identically', () => {
    const keyed = {
      time: { data: [0, 5, 10] },
      heartrate: { data: [130, 132, 134] },
      velocity_smooth: { data: [3, 3, 3] },
    };
    const plain = { time: [0, 5, 10], heartrate: [130, 132, 134], velocity: [3, 3, 3] };
    expect(parseStreamDrop(keyed)).toEqual(parseStreamDrop(plain));
  });

  it('parses the array-of-streams export form', () => {
    const arrayForm = [
      { type: 'time', data: [0, 5] },
      { type: 'heartrate', data: [131, 133] },
    ];
    expect(parseStreamDrop(arrayForm)).toEqual({ time: [0, 5], heartrate: [131, 133] });
  });
});

describe('bucketedZoneMinutes', () => {
  it('produces a distinct lower-trust record with buckets stored verbatim', () => {
    const e = bucketedZoneMinutes(
      {
        device: 'apple-watch',
        modality: 'run',
        durationMinutes: 52,
        occurredAt: '2025-11-14T18:00:00Z',
        minutesAboveThreshold: [{ thresholdBpm: 150, minutes: 18 }],
        deviceBuckets: [
          { label: 'Zone 2', minutes: 30 },
          { label: 'Zone 3', minutes: 18 },
        ],
        note: 'Apple Watch history; no stream exists for this session',
      },
      ctx(),
    );
    expect(e.type).toBe('bucketed-zone-minutes');
    expect(e.trust).toBe('low');
    expect(e.deviceBuckets).toHaveLength(2);
    // The record type carries no band-seconds field at all: there is no path
    // from a device bucket into time-in-band math.
    expect('timeInBandSeconds' in e).toBe(false);
  });
});

describe('cooperTest', () => {
  it('computes the estimate and applies the convention typical error as a floor', () => {
    const e = cooperTest(
      {
        surface: 'track',
        distanceMeters: 2800,
        pacingStrategy: 'even splits, no sprint finish',
        occurredAt: '2026-08-01T09:00:00Z',
      },
      ctx(),
    );
    expect(e.vo2maxEstimate).toBe(51.3);
    expect(e.typicalError).toBe(CONSTANTS.COOPER_TYPICAL_ERROR);
    expect(e.source).toBe('measured-field');
  });

  it('refuses a treadmill test with no ramp correction on record', () => {
    expect(() =>
      cooperTest(
        {
          surface: 'treadmill',
          distanceMeters: 2750,
          pacingStrategy: 'steady belt speed',
          occurredAt: '2026-08-01T09:00:00Z',
        },
        ctx(),
      ),
    ).toThrow(/ramp/);
  });

  it('lets a provided typical error widen but never narrow the default (I3)', () => {
    const wide = cooperTest(
      {
        surface: 'track',
        distanceMeters: 2800,
        pacingStrategy: 'went out too hard',
        occurredAt: '2026-08-01T09:00:00Z',
        typicalError: 3.5,
      },
      ctx(),
    );
    const narrow = cooperTest(
      {
        surface: 'track',
        distanceMeters: 2800,
        pacingStrategy: 'even splits',
        occurredAt: '2026-08-01T09:00:00Z',
        typicalError: 0.5,
      },
      ctx(),
    );
    expect(wide.typicalError).toBe(3.5);
    expect(narrow.typicalError).toBe(CONSTANTS.COOPER_TYPICAL_ERROR);
  });
});

describe('StravaClient.pullStreams', () => {
  const tokenResponse = new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });

  it('fetches raw sample streams and returns a parsed HrStream', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('oauth/token')) return tokenResponse.clone();
      return new Response(
        JSON.stringify({
          time: { data: [0, 5, 10] },
          heartrate: { data: [130, 133, 135] },
          velocity_smooth: { data: [3.1, 3.1, 3.2] },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new StravaClient('id', 'secret', 'refresh', fetchImpl);
    const stream = await client.pullStreams(42);
    expect(stream).toEqual({
      time: [0, 5, 10],
      heartrate: [130, 133, 135],
      velocity: [3.1, 3.1, 3.2],
    });
    // Only raw sample keys are requested — never Strava's zone summaries.
    const streamCall = calls.find((c) => c.includes('/streams'));
    expect(streamCall).toContain('keys=time,heartrate,velocity_smooth,watts');
    expect(streamCall).not.toContain('zone');
  });

  it('returns null when the activity has no HR stream', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).includes('oauth/token')) return tokenResponse.clone();
      return new Response(JSON.stringify({ time: { data: [0, 5] } }), { status: 200 });
    }) as typeof fetch;
    const client = new StravaClient('id', 'secret', 'refresh', fetchImpl);
    expect(await client.pullStreams(42)).toBeNull();
  });
});

describe('stravaEnvironment', () => {
  it('maps trainer runs to treadmill and non-trainer sessions to outdoor', () => {
    expect(stravaEnvironment({ id: 1, moving_time: 60, sport_type: 'Run', trainer: true })).toBe('treadmill');
    expect(stravaEnvironment({ id: 1, moving_time: 60, sport_type: 'Run', trainer: false })).toBe('outdoor');
    expect(stravaEnvironment({ id: 1, moving_time: 60, sport_type: 'Ride', trainer: true })).toBe('indoor');
    expect(stravaEnvironment({ id: 1, moving_time: 60, sport_type: 'Run' })).toBe('unknown');
  });
});
