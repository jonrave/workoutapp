/**
 * Aerobic-ledger types: personally calibrated heart-rate bands, raw HR
 * streams, and the deterministic quantities computed from them (time in band,
 * cardiac drift, Cooper series).
 *
 * Two rules are load-bearing here:
 *
 * 1. Device-supplied zone labels are not representable as time-in-band input.
 *    A stream is raw samples or it is nothing; sources that offer only
 *    bucketed zone minutes produce a `BucketedZoneMinutesEvent` (lower trust,
 *    excluded from band math) instead. Apple Watch bands are cut differently
 *    from the personal bands and have silently changed boundaries
 *    mid-history, so a device zone label can flatter a session that was run
 *    too hard.
 *
 * 2. Band math exists only against a calibration for the exact modality (I9:
 *    zone boundaries are per-modality). An uncalibrated modality gets no
 *    time-in-band output at all — silently applying another modality's bands
 *    is the same failure as trusting a device's.
 *
 * None of this feeds `decide()`. The aerobic ledger is measurement-module
 * output (§8): it describes, it does not prescribe, and no ranking across
 * training qualities is derived from it.
 */

import type { IsoDate } from './field';
import type { Modality } from './state';

/**
 * One named band with explicit bpm boundaries, inclusive on both ends;
 * `upperBpm: null` means open-ended (the top band). Bands come from the
 * user's calibration, never from a device and never from `220 − age` (§9).
 */
export interface HrBand {
  name: string;
  lowerBpm: number;
  /** Inclusive; `null` for the open-ended top band. */
  upperBpm: number | null;
}

/**
 * A personally calibrated band set for one modality. Recalibration is a new
 * calibration (a new event in the log), never an edit — so every computed
 * session records which calibration it was computed against.
 */
export interface HrBandCalibration {
  modality: Modality;
  /** Measured or field-estimated max HR, bpm. Never `220 − age` (§9). */
  hrMaxBpm: number;
  /** Resting floor used for heart-rate-reserve arithmetic, bpm. */
  hrRestBpm: number;
  /** Ordered, contiguous, non-overlapping; validated before any band math runs. */
  bands: HrBand[];
  calibratedOn: IsoDate;
  /** Where the boundaries came from, e.g. "field-calibrated HRR; lactate-informed". */
  method?: string;
}

/**
 * A raw heart-rate stream as parallel arrays (the shape Strava's streams API
 * returns). `time` is seconds from session start, strictly increasing.
 * Work-rate streams are optional; without one, cardiac drift is confounded
 * by construction because first and second half cannot be matched for work.
 */
export interface HrStream {
  /** Seconds from start, strictly increasing. */
  time: number[];
  /** bpm, one per time sample. */
  heartrate: number[];
  /** m/s (Strava `velocity_smooth`), one per time sample. */
  velocity?: number[];
  /** Watts, one per time sample. */
  watts?: number[];
}

/** Which work-rate stream drift matching used. */
export type WorkRateSource = 'watts' | 'velocity';

/**
 * Cardiac drift, first half vs second half at matched work rate. The clean
 * form exists only when the halves are actually comparable; a variable
 * outdoor run is confounded and is flagged as such rather than reported as a
 * clean number (the delta is still carried, labeled).
 */
export type CardiacDriftResult =
  | {
      kind: 'measured';
      deltaBpm: number;
      firstHalfMeanBpm: number;
      secondHalfMeanBpm: number;
      workRateSource: WorkRateSource;
      /** Percent difference in mean work rate between halves; small by definition here. */
      workRateHalfDeltaPct: number;
    }
  | {
      kind: 'confounded';
      reason:
        | 'no-work-rate-stream'
        | 'work-rate-mismatch-between-halves'
        | 'variable-work-rate';
      /** Raw half-vs-half delta, carried but never presented as clean drift. */
      deltaBpm: number;
      firstHalfMeanBpm: number;
      secondHalfMeanBpm: number;
      workRateSource: WorkRateSource | null;
      workRateHalfDeltaPct: number | null;
    }
  | {
      kind: 'unavailable';
      reason: 'too-short' | 'too-few-samples';
    };

/** Result of time-weighted band accumulation over one stream. */
export interface TimeInBandsResult {
  /** Seconds per band name, keyed exactly by the calibration's band names. */
  bandSeconds: Record<string, number>;
  /** Seconds actually attributed to bands (recording gaps excluded). */
  trackedSeconds: number;
  /** Seconds lost to gaps longer than the gap cap. */
  gapSeconds: number;
  meanHrBpm: number;
  maxHrBpm: number;
}

/** Cooper test surface. Separate series, never pooled into one trend (see CooperTestEvent). */
export type CooperSurface = 'track' | 'treadmill';

/** One week of the Zone 2 rollup, evaluated against the floor. */
export interface WeeklyZone2Week {
  /** Monday of the week, IsoDate. */
  weekStart: IsoDate;
  zone2Minutes: number;
  floorMinutes: number;
  metFloor: boolean;
}
