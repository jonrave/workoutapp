/**
 * Aerobic ledger — the deterministic layer for cardiovascular work (§8:
 * many cheap repeated measures; measurement noise is the binding constraint).
 *
 * Everything here is a pure function of its inputs: raw HR streams, a
 * personal per-modality band calibration, and previously computed session
 * events. No I/O, no clock, no network (I1 applies to this package as a
 * whole). Nothing here is consumed by `decide()` — the ledger describes
 * aerobic work, it does not rank it against other training qualities.
 *
 * Device zone labels cannot reach these functions: the only accepted input
 * is an `HrStream` of raw samples, and the only accepted bands are a
 * validated `HrBandCalibration`. Sources with bucketed zone minutes are
 * handled at the adapter boundary as a distinct lower-trust record type.
 */

import { CONSTANTS } from './constants';
import type {
  CardiacDriftResult,
  CooperTestEvent,
  HrBandCalibration,
  HrStream,
  IsoDate,
  TimeInBandsResult,
  WeeklyZone2Week,
  WorkRateSource,
} from './types/index';

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* Calibration validation                                              */
/* ------------------------------------------------------------------ */

export class InvalidCalibrationError extends Error {}
export class InvalidStreamError extends Error {}

/**
 * A calibration must partition the whole bpm range: ordered, contiguous,
 * non-overlapping, starting at 0, ending open. Every raw sample then lands
 * in exactly one band — there is no "unclassified" bucket to hide samples
 * in, and no way for a boundary edit to silently drop time.
 */
export function validateHrBandCalibration(cal: HrBandCalibration): void {
  if (cal.bands.length === 0) {
    throw new InvalidCalibrationError('Calibration has no bands');
  }
  if (!(cal.hrMaxBpm > cal.hrRestBpm) || cal.hrRestBpm <= 0) {
    throw new InvalidCalibrationError(
      `hrMaxBpm (${cal.hrMaxBpm}) must exceed hrRestBpm (${cal.hrRestBpm}) and both must be positive`,
    );
  }
  const names = new Set<string>();
  for (let i = 0; i < cal.bands.length; i++) {
    const b = cal.bands[i]!;
    if (names.has(b.name)) {
      throw new InvalidCalibrationError(`Duplicate band name "${b.name}"`);
    }
    names.add(b.name);
    if (i === 0 && b.lowerBpm !== 0) {
      throw new InvalidCalibrationError(
        `First band must start at 0 bpm so every sample is classified (got ${b.lowerBpm})`,
      );
    }
    const last = i === cal.bands.length - 1;
    if (last) {
      if (b.upperBpm !== null) {
        throw new InvalidCalibrationError(
          'Last band must be open-ended (upperBpm null) so no sample can exceed the partition',
        );
      }
    } else {
      if (b.upperBpm === null) {
        throw new InvalidCalibrationError(`Only the last band may be open-ended ("${b.name}" is not last)`);
      }
      if (b.upperBpm < b.lowerBpm) {
        throw new InvalidCalibrationError(`Band "${b.name}" has upperBpm below lowerBpm`);
      }
      const next = cal.bands[i + 1]!;
      if (next.lowerBpm !== b.upperBpm + 1) {
        throw new InvalidCalibrationError(
          `Bands must be contiguous: "${b.name}" ends at ${b.upperBpm} but "${next.name}" starts at ${next.lowerBpm}`,
        );
      }
    }
  }
}

function validateStream(stream: HrStream): void {
  const n = stream.time.length;
  if (stream.heartrate.length !== n) {
    throw new InvalidStreamError(
      `time (${n}) and heartrate (${stream.heartrate.length}) sample counts differ`,
    );
  }
  if (stream.velocity && stream.velocity.length !== n) {
    throw new InvalidStreamError('velocity sample count differs from time');
  }
  if (stream.watts && stream.watts.length !== n) {
    throw new InvalidStreamError('watts sample count differs from time');
  }
  for (let i = 1; i < n; i++) {
    if (!(stream.time[i]! > stream.time[i - 1]!)) {
      throw new InvalidStreamError(`time must be strictly increasing (index ${i})`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Time in band                                                        */
/* ------------------------------------------------------------------ */

function bandNameFor(hr: number, cal: HrBandCalibration): string {
  for (const b of cal.bands) {
    if (hr >= b.lowerBpm && (b.upperBpm === null || hr <= b.upperBpm)) return b.name;
  }
  // Unreachable for a validated calibration (full partition from 0, open top).
  return cal.bands[cal.bands.length - 1]!.name;
}

/**
 * Time-weighted time in band: each sample's HR owns the interval to the next
 * sample, capped at HR_STREAM_GAP_CAP_S — a recording dropout becomes
 * untracked time, never fabricated band minutes. Samples with non-positive
 * or non-finite HR are treated as dropouts too.
 */
export function timeInBands(stream: HrStream, cal: HrBandCalibration): TimeInBandsResult {
  validateHrBandCalibration(cal);
  validateStream(stream);

  const bandSeconds: Record<string, number> = Object.fromEntries(cal.bands.map((b) => [b.name, 0]));
  let trackedSeconds = 0;
  let gapSeconds = 0;
  let hrWeightedSum = 0;
  let maxHrBpm = 0;

  const n = stream.time.length;
  for (let i = 0; i < n - 1; i++) {
    const dt = stream.time[i + 1]! - stream.time[i]!;
    const hr = stream.heartrate[i]!;
    if (!Number.isFinite(hr) || hr <= 0 || dt > CONSTANTS.HR_STREAM_GAP_CAP_S) {
      gapSeconds += dt;
      continue;
    }
    bandSeconds[bandNameFor(hr, cal)]! += dt;
    trackedSeconds += dt;
    hrWeightedSum += hr * dt;
  }
  for (const hr of stream.heartrate) {
    if (Number.isFinite(hr) && hr > maxHrBpm) maxHrBpm = hr;
  }

  return {
    bandSeconds,
    trackedSeconds,
    gapSeconds,
    meanHrBpm: trackedSeconds > 0 ? round1(hrWeightedSum / trackedSeconds) : 0,
    maxHrBpm,
  };
}

/* ------------------------------------------------------------------ */
/* Cardiac drift                                                       */
/* ------------------------------------------------------------------ */

interface HalfStats {
  hrMean: number;
  workMean: number | null;
  seconds: number;
}

function halfStats(
  stream: HrStream,
  work: number[] | null,
  fromT: number,
  toT: number,
): HalfStats {
  let hrSum = 0;
  let workSum = 0;
  let secs = 0;
  const n = stream.time.length;
  for (let i = 0; i < n - 1; i++) {
    const t = stream.time[i]!;
    if (t < fromT || t >= toT) continue;
    const dt = Math.min(stream.time[i + 1]! - t, CONSTANTS.HR_STREAM_GAP_CAP_S);
    const hr = stream.heartrate[i]!;
    if (!Number.isFinite(hr) || hr <= 0) continue;
    hrSum += hr * dt;
    if (work) workSum += (work[i] ?? 0) * dt;
    secs += dt;
  }
  return {
    hrMean: secs > 0 ? hrSum / secs : 0,
    workMean: work && secs > 0 ? workSum / secs : null,
    seconds: secs,
  };
}

/**
 * Cardiac drift: mean HR of the second half minus the first, halves cut
 * after a warmup exclusion, comparable only at matched work rate. Three
 * honest outcomes:
 *
 * - `measured`: work-rate stream present, session steady, halves matched.
 * - `confounded`: the delta is carried but flagged — no work-rate stream to
 *   match against, halves at different work rates, or a variable session
 *   (intervals, surging outdoor run). A confounded delta is never presented
 *   as clean drift.
 * - `unavailable`: too short or too sparse to say anything.
 */
export function cardiacDrift(stream: HrStream): CardiacDriftResult {
  validateStream(stream);
  const n = stream.time.length;
  if (n < 10) return { kind: 'unavailable', reason: 'too-few-samples' };

  const start = stream.time[0]!;
  const end = stream.time[n - 1]!;
  if (end - start < CONSTANTS.DRIFT_MIN_DURATION_MIN * 60) {
    return { kind: 'unavailable', reason: 'too-short' };
  }

  const analysisStart = start + CONSTANTS.DRIFT_WARMUP_EXCLUDE_MIN * 60;
  const mid = analysisStart + (end - analysisStart) / 2;

  const work: number[] | null = stream.watts ?? stream.velocity ?? null;
  const workRateSource: WorkRateSource | null = stream.watts
    ? 'watts'
    : stream.velocity
      ? 'velocity'
      : null;

  const first = halfStats(stream, work, analysisStart, mid);
  const second = halfStats(stream, work, mid, end);
  if (first.seconds === 0 || second.seconds === 0) {
    return { kind: 'unavailable', reason: 'too-few-samples' };
  }
  const deltaBpm = round1(second.hrMean - first.hrMean);
  const base = {
    deltaBpm,
    firstHalfMeanBpm: round1(first.hrMean),
    secondHalfMeanBpm: round1(second.hrMean),
  };

  if (!work || workRateSource === null || first.workMean === null || second.workMean === null) {
    return {
      kind: 'confounded',
      reason: 'no-work-rate-stream',
      ...base,
      workRateSource: null,
      workRateHalfDeltaPct: null,
    };
  }

  // Time-weighted work-rate CV over the analysis window.
  let wSum = 0;
  let wSecs = 0;
  for (let i = 0; i < n - 1; i++) {
    const t = stream.time[i]!;
    if (t < analysisStart || t >= end) continue;
    const dt = Math.min(stream.time[i + 1]! - t, CONSTANTS.HR_STREAM_GAP_CAP_S);
    wSum += (work[i] ?? 0) * dt;
    wSecs += dt;
  }
  const wMean = wSecs > 0 ? wSum / wSecs : 0;
  let wVar = 0;
  for (let i = 0; i < n - 1; i++) {
    const t = stream.time[i]!;
    if (t < analysisStart || t >= end) continue;
    const dt = Math.min(stream.time[i + 1]! - t, CONSTANTS.HR_STREAM_GAP_CAP_S);
    wVar += ((work[i] ?? 0) - wMean) ** 2 * dt;
  }
  const workCvPct = wMean > 0 && wSecs > 0 ? (Math.sqrt(wVar / wSecs) / wMean) * 100 : Infinity;

  const halfDeltaPct =
    first.workMean > 0
      ? round1((Math.abs(second.workMean - first.workMean) / first.workMean) * 100)
      : Infinity;

  if (workCvPct > CONSTANTS.DRIFT_WORKRATE_CV_PCT) {
    return {
      kind: 'confounded',
      reason: 'variable-work-rate',
      ...base,
      workRateSource,
      workRateHalfDeltaPct: Number.isFinite(halfDeltaPct) ? halfDeltaPct : null,
    };
  }
  if (halfDeltaPct > CONSTANTS.DRIFT_WORKRATE_HALF_DELTA_PCT) {
    return {
      kind: 'confounded',
      reason: 'work-rate-mismatch-between-halves',
      ...base,
      workRateSource,
      workRateHalfDeltaPct: halfDeltaPct,
    };
  }
  return {
    kind: 'measured',
    ...base,
    workRateSource,
    workRateHalfDeltaPct: halfDeltaPct,
  };
}

/* ------------------------------------------------------------------ */
/* Weekly Zone 2 rollup                                                */
/* ------------------------------------------------------------------ */

/** Monday of the week containing `date`. */
export function weekStartOf(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly minutes in the band named `zone2`, against the floor
 * (WEEKLY_ZONE2_FLOOR_MIN, a convention). Input is computed
 * `aerobic-session` events only — stream-verified minutes. Bucketed device
 * records never enter this sum. Weeks between the first and last session are
 * filled so a zero-minutes week is visible; zero means "no recorded stream
 * minutes", a statement about the ledger, not a synthesized rest week.
 */
export function weeklyZone2Rollup(
  sessions: Array<{ occurredAt: string; timeInBandSeconds: Record<string, number> }>,
): WeeklyZone2Week[] {
  if (sessions.length === 0) return [];
  const byWeek = new Map<IsoDate, number>();
  for (const s of sessions) {
    const week = weekStartOf(s.occurredAt.slice(0, 10));
    byWeek.set(week, (byWeek.get(week) ?? 0) + (s.timeInBandSeconds['zone2'] ?? 0));
  }
  const weeks = [...byWeek.keys()].sort();
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  const out: WeeklyZone2Week[] = [];
  for (let w = first; w <= last; ) {
    const minutes = round1((byWeek.get(w) ?? 0) / 60);
    out.push({
      weekStart: w,
      zone2Minutes: minutes,
      floorMinutes: CONSTANTS.WEEKLY_ZONE2_FLOOR_MIN,
      metFloor: minutes >= CONSTANTS.WEEKLY_ZONE2_FLOOR_MIN,
    });
    const d = new Date(`${w}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    w = d.toISOString().slice(0, 10);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cooper series                                                       */
/* ------------------------------------------------------------------ */

/**
 * evidence: Cooper (JAMA, 1968) regression of 12-minute distance on measured
 * VO2max: VO2max = (distanceMeters − 504.9) / 44.73.
 */
export function cooperVo2max(distanceMeters: number): number {
  return round1((distanceMeters - 504.9) / 44.73);
}

/**
 * Track and treadmill Cooper tests as two separate series. Never pooled:
 * surface changes the test, so a mixed series would trend the venue, not the
 * athlete. Callers that chart these must draw two lines or two charts.
 */
export function cooperSeries(events: CooperTestEvent[]): {
  track: Array<{ date: IsoDate; value: number }>;
  treadmill: Array<{ date: IsoDate; value: number }>;
} {
  const pick = (surface: CooperTestEvent['surface']) =>
    events
      .filter((e) => e.surface === surface)
      .map((e) => ({ date: e.occurredAt.slice(0, 10) as IsoDate, value: e.vo2maxEstimate }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { track: pick('track'), treadmill: pick('treadmill') };
}
