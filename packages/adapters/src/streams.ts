/**
 * Raw HR stream ingestion — the aerobic ledger's adapter boundary.
 *
 * The hard rule enforced here: device-supplied zone labels are REJECTED as
 * input to any time-in-band calculation. Apple Watch bands are cut
 * differently from the personal bands and have silently changed boundaries
 * mid-history, which makes device zone labels flatter sessions that were run
 * too hard. A source that offers only bucketed zone minutes produces a
 * `BucketedZoneMinutesEvent` — a distinct lower-trust record type, excluded
 * from band math, labeled as such wherever it surfaces.
 *
 * Band math also runs only against a calibration for the exact modality
 * (I9). There is no fallback to another modality's bands and no default
 * band set.
 */
import {
  cardiacDrift,
  cooperVo2max,
  CONSTANTS,
  timeInBands,
  validateHrBandCalibration,
} from '@peakspan/engine';
import type {
  AerobicSessionEvent,
  BucketedZoneMinutesEvent,
  CooperSurface,
  CooperTestEvent,
  HrBand,
  HrBandCalibrationEvent,
  HrStream,
  IsoDate,
  IsoDateTime,
  Modality,
} from '@peakspan/engine';
import { defaultContext, type EventContext } from './manual';

/** Thrown when a payload offers zone labels where raw samples are required. */
export class DeviceZoneLabelRejection extends Error {
  constructor(detail: string) {
    super(
      `Device zone labels are not valid time-in-band input (${detail}). ` +
        'Device bands differ from the personal calibration and have changed ' +
        'boundaries mid-history. If only bucketed zone minutes exist, record ' +
        'them with bucketedZoneMinutes() as a lower-trust record instead.',
    );
  }
}

export class ModalityCalibrationMismatch extends Error {
  constructor(modality: Modality, calibrated: Modality) {
    super(
      `No band math for modality "${modality}" against a "${calibrated}" calibration (I9: ` +
        'zones are per-modality). Calibrate this modality or record the session without band math.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Constructors                                                        */
/* ------------------------------------------------------------------ */

/** Declared personal band calibration for one modality. Validated before it can enter the log. */
export function hrBandCalibration(
  input: {
    modality: Modality;
    hrMaxBpm: number;
    hrRestBpm: number;
    bands: HrBand[];
    occurredAt: IsoDateTime;
    method?: string;
  },
  ctx: EventContext = defaultContext,
): HrBandCalibrationEvent {
  validateHrBandCalibration({
    modality: input.modality,
    hrMaxBpm: input.hrMaxBpm,
    hrRestBpm: input.hrRestBpm,
    bands: input.bands,
    calibratedOn: input.occurredAt.slice(0, 10) as IsoDate,
  });
  const event: HrBandCalibrationEvent = {
    id: ctx.id(),
    type: 'hr-band-calibration',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    modality: input.modality,
    hrMaxBpm: input.hrMaxBpm,
    hrRestBpm: input.hrRestBpm,
    bands: input.bands,
  };
  if (input.method !== undefined) event.method = input.method;
  return event;
}

/**
 * Compute one aerobic session from a raw stream against the calibration for
 * its exact modality. The stream itself stays outside the log; the computed
 * summary records which calibration produced it. Deterministic id when an
 * activityId is supplied, so re-syncing the same activity never duplicates.
 */
export function aerobicSessionFromStream(
  input: {
    stream: HrStream;
    modality: Modality;
    calibration: HrBandCalibrationEvent;
    occurredAt: IsoDateTime;
    activityId?: string;
    environment?: AerobicSessionEvent['environment'];
  },
  ctx: EventContext = defaultContext,
): AerobicSessionEvent {
  if (input.calibration.modality !== input.modality) {
    throw new ModalityCalibrationMismatch(input.modality, input.calibration.modality);
  }
  const cal = {
    modality: input.calibration.modality,
    hrMaxBpm: input.calibration.hrMaxBpm,
    hrRestBpm: input.calibration.hrRestBpm,
    bands: input.calibration.bands,
    calibratedOn: input.calibration.occurredAt.slice(0, 10) as IsoDate,
  };
  const bands = timeInBands(input.stream, cal);
  const drift = cardiacDrift(input.stream);
  const n = input.stream.time.length;
  const event: AerobicSessionEvent = {
    id: input.activityId ? `aerobic_${input.activityId}` : ctx.id(),
    type: 'aerobic-session',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'derived',
    modality: input.modality,
    calibrationId: input.calibration.id,
    durationSeconds: n > 0 ? input.stream.time[n - 1]! - input.stream.time[0]! : 0,
    trackedSeconds: bands.trackedSeconds,
    gapSeconds: bands.gapSeconds,
    timeInBandSeconds: bands.bandSeconds,
    meanHrBpm: bands.meanHrBpm,
    maxHrBpm: bands.maxHrBpm,
    drift,
    environment: input.environment ?? 'unknown',
  };
  if (input.activityId !== undefined) event.activityId = input.activityId;
  return event;
}

/**
 * The lower-trust path for sources with no raw stream (e.g. Apple Watch
 * history). Buckets are stored verbatim for provenance; minutes above an
 * absolute bpm line may be recorded where reconstructible. Nothing from this
 * record may ever enter band math, and `trust` is the literal 'low' — the
 * type admits no other value.
 */
export function bucketedZoneMinutes(
  input: {
    device: string;
    modality: Modality;
    durationMinutes: number;
    occurredAt: IsoDateTime;
    minutesAboveThreshold?: Array<{ thresholdBpm: number; minutes: number }>;
    deviceBuckets?: Array<{ label: string; minutes: number }>;
    note?: string;
  },
  ctx: EventContext = defaultContext,
): BucketedZoneMinutesEvent {
  const event: BucketedZoneMinutesEvent = {
    id: ctx.id(),
    type: 'bucketed-zone-minutes',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'device-raw',
    device: input.device,
    trust: 'low',
    modality: input.modality,
    durationMinutes: input.durationMinutes,
  };
  if (input.minutesAboveThreshold !== undefined) event.minutesAboveThreshold = input.minutesAboveThreshold;
  if (input.deviceBuckets !== undefined) event.deviceBuckets = input.deviceBuckets;
  if (input.note !== undefined) event.note = input.note;
  return event;
}

/**
 * Cooper 12-minute test. Surface and pacing are mandatory; a treadmill test
 * without its ramp/incline handling on record is refused, because that is
 * exactly the detail that makes treadmill and track incomparable. The
 * estimate is computed here once (Cooper 1968 regression) and the typical
 * error may only widen the convention default, never narrow it (I3).
 */
export function cooperTest(
  input: {
    surface: CooperSurface;
    distanceMeters: number;
    pacingStrategy: string;
    occurredAt: IsoDateTime;
    rampCorrection?: string;
    typicalError?: number;
  },
  ctx: EventContext = defaultContext,
): CooperTestEvent {
  if (input.surface === 'treadmill' && !input.rampCorrection) {
    throw new Error(
      'A treadmill Cooper test must record its ramp/incline handling (e.g. "1% incline throughout") — ' +
        'without it the result cannot be honestly placed in the treadmill series.',
    );
  }
  const event: CooperTestEvent = {
    id: ctx.id(),
    type: 'cooper-test',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'measured-field',
    surface: input.surface,
    distanceMeters: input.distanceMeters,
    vo2maxEstimate: cooperVo2max(input.distanceMeters),
    pacingStrategy: input.pacingStrategy,
    typicalError: Math.max(input.typicalError ?? 0, CONSTANTS.COOPER_TYPICAL_ERROR),
  };
  if (input.rampCorrection !== undefined) event.rampCorrection = input.rampCorrection;
  return event;
}

/* ------------------------------------------------------------------ */
/* File drop / Strava streams parsing                                  */
/* ------------------------------------------------------------------ */

/** Strava streams API shape with key_by_type=true. */
interface StravaKeyedStreams {
  time?: { data: number[] };
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
  watts?: { data: number[] };
}

const ZONE_LABEL_KEYS = ['zones', 'time_in_zone', 'zone_minutes', 'hr_zones', 'heart_rate_zones'];

/**
 * Parse a stream payload from a file drop or the Strava streams API. Accepts
 * the key_by_type object form, the array-of-streams form, or a plain
 * `HrStream`. A payload that carries only zone summaries is rejected with an
 * explanation — by construction there is no code path from a zone label to
 * time in band.
 */
export function parseStreamDrop(raw: unknown): HrStream {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Stream payload must be an object or an array of streams');
  }

  let keyed: StravaKeyedStreams & Record<string, unknown>;
  if (Array.isArray(raw)) {
    keyed = {};
    for (const entry of raw as Array<{ type?: string; data?: unknown }>) {
      if (entry && typeof entry.type === 'string') {
        (keyed as Record<string, unknown>)[entry.type] = { data: entry.data };
      }
    }
  } else {
    keyed = raw as StravaKeyedStreams & Record<string, unknown>;
  }

  const arr = (v: unknown): number[] | undefined =>
    v && typeof v === 'object' && Array.isArray((v as { data?: unknown }).data)
      ? ((v as { data: unknown[] }).data as number[])
      : Array.isArray(v)
        ? (v as number[])
        : undefined;

  const time = arr(keyed.time);
  const heartrate = arr(keyed.heartrate);

  if (!time || !heartrate) {
    const zoneKey = ZONE_LABEL_KEYS.find((k) => k in keyed);
    if (zoneKey) {
      throw new DeviceZoneLabelRejection(`payload offers "${zoneKey}" but no raw time/heartrate samples`);
    }
    throw new Error('Stream payload has no time/heartrate sample arrays');
  }

  const stream: HrStream = { time, heartrate };
  const velocity = arr(keyed.velocity_smooth) ?? arr((keyed as Record<string, unknown>).velocity);
  const watts = arr(keyed.watts);
  if (velocity) stream.velocity = velocity;
  if (watts) stream.watts = watts;
  return stream;
}
