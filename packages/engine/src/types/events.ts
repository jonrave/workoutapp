/**
 * Event types for the append-only log (consumed in Step 5; adapters in Step 4
 * normalize into these and do nothing else). Derived `UserState` must be
 * recomputable from this log.
 *
 * Only raw signals are representable (I4): there is deliberately no event for
 * a vendor composite score.
 */

import type { IsoDate, IsoDateTime, Provenance } from './field';
import type { CardiacDriftResult, CooperSurface, HrBand } from './aerobic';
import type {
  FitnessMetric,
  Modality,
  Pillar,
  PlannedSession,
  PreRegisteredThreshold,
  Slot,
  StrengthPattern,
  TissueChannel,
} from './state';

interface BaseEvent {
  id: string;
  /** When the thing happened. */
  occurredAt: IsoDateTime;
  /** When it entered the log (append-only; never mutated). */
  recordedAt: IsoDateTime;
  source: Provenance;
}

/** Raw daily wearable signal (I4). One reading; rolling means are derived state (I5). */
export interface RecoverySignalEvent extends BaseEvent {
  type: 'recovery-signal';
  signal:
    | 'hrvLnRmssd'
    | 'restingHr'
    | 'sleepDurationHours'
    | 'sleepMidpointClockTime'
    | 'sleepEfficiencyPct'
    | 'temperatureDeviation';
  value: number;
}

/** A fitness test result: GXT, CMJ median-of-5, lactate step, DEXA, e1RM estimate. */
export interface FitnessMeasurementEvent extends BaseEvent {
  type: 'fitness-measurement';
  metric: FitnessMetric;
  value: number;
  unit: string;
  /** Same units as `value`; feeds the derived SDC (I3). */
  typicalError?: number;
  /** For threshold-derived measures: the modality they were measured on (I9). */
  modality?: Modality;
  /** Required when metric is `maxStrength`: which major pattern the e1RM belongs to. */
  pattern?: StrengthPattern;
}

/** A non-training lever measurement: home BP mean, bloods, waist, alcohol log. */
export interface LeverMeasurementEvent extends BaseEvent {
  type: 'lever-measurement';
  lever:
    | 'homeSBP7d'
    | 'homeDBP7d'
    | 'apoB'
    | 'lpa'
    | 'hba1c'
    | 'fastingInsulin'
    | 'alcoholUnits'
    | 'waistCm';
  value: number;
  unit: string;
  typicalError?: number;
}

/**
 * A completed activity, planned or unplanned. Unplanned activity must be
 * classified into pillar and tissue load, not calories or minutes (section 6):
 * a two-hour hike is aerobic plus eccentric lower-limb load, not a rest day.
 */
export interface ActivityEvent extends BaseEvent {
  type: 'activity';
  planned: boolean;
  /** Slot of the standing-plan session this fulfilled, if any; feeds `adherenceBySlot`. */
  plannedSlot: Slot | null;
  modality: Modality;
  durationMinutes: number;
  /** Session RPE 0-10, user-reported. */
  sRPE: number;
  /** sRPE-minute load attributed per pillar. */
  pillarLoad: Partial<Record<Pillar, number>>;
  /** sRPE-minute load attributed per tissue channel. */
  tissueLoad: Partial<Record<TissueChannel, number>>;
  description?: string;
}

/** A planned session that did not happen. Feeds `adherenceBySlot`; copy never moralizes (section 9). */
export interface MissedSessionEvent extends BaseEvent {
  type: 'missed-session';
  plannedSlot: Slot;
  reason?: string;
}

/** Soreness / pain / movement-quality report (Layer 1 inputs). */
export interface SubjectiveEvent extends BaseEvent {
  type: 'subjective';
  /** 0-10 whole-body soreness. */
  soreness?: number;
  /** Site-specific pain, 0-10; >3/10 blocks the implicated pattern (Layer 1). */
  pain?: { site: TissueChannel | string; score: number };
  /** Pain that alters gait or movement quality blocks regardless of score (Layer 1). */
  altersMovement?: boolean;
  note?: string;
}

export interface IllnessEvent extends BaseEvent {
  type: 'illness';
  phase: 'onset' | 'update' | 'resolved';
  /** Fever, body aches, below-neck symptoms (Layer 1 hard block). */
  systemic: boolean;
  symptoms: string[];
}

export interface InjuryEvent extends BaseEvent {
  type: 'injury';
  site: TissueChannel | string;
  severity: 'minor' | 'moderate' | 'severe';
  /** id of the earlier InjuryEvent this recurs, if a recurrence. */
  recurrenceOf?: string;
  resolved: boolean;
  note?: string;
}

/** A training interruption: the empirical base rate that matters most (section 3). */
export interface InterruptionEvent extends BaseEvent {
  type: 'interruption';
  cause: 'illness' | 'injury' | 'travel' | 'work' | 'family' | 'other';
  startDate: IsoDate;
  /** Open-ended while `null`. */
  endDate: IsoDate | null;
}

/**
 * Block start. The threshold is pre-registered here, before the block runs,
 * and is immutable once written (I10).
 */
export interface BlockStartEvent extends BaseEvent {
  type: 'block-start';
  pillar: Pillar;
  plannedWeeks: number;
  metricUnderTest: FitnessMetric;
  preRegisteredThreshold: PreRegisteredThreshold;
  /**
   * The metric value the threshold was validated against at registration.
   * Recorded so state projected from the log alone can reconstruct
   * `block.baselineAtStart` even when the seed carries no value for the
   * metric. Optional for events written before this field existed.
   */
  baselineValue?: number;
}

/**
 * Block retest. Evaluated only against the stored pre-registered threshold;
 * a retest with no such threshold on record must be refused (I10), and a
 * delta below SDC is "no change detected" (I3).
 */
export interface RetestEvent extends BaseEvent {
  type: 'retest';
  /** id of the BlockStartEvent this retests. */
  blockId: string;
  metric: FitnessMetric;
  value: number;
  unit: string;
  typicalError?: number;
}

/**
 * A declared change to profile facts. Partial: only the fields present are
 * overlaid on the seed profile. These are declared facts, not noisy signals —
 * the SDC gate does not apply (same footing as TemporaryConstraint).
 */
export interface ProfileUpdateEvent extends BaseEvent {
  type: 'profile-update';
  fields: Partial<{
    age: number;
    trainingAgeYears: number;
    /** I9 hard constraint: interval work only on these. */
    vo2CapableModalities: Modality[];
    equipment: string[];
    weeklyBudgetMinutes: number;
    hardConstraints: string[];
  }>;
}

/**
 * A declared replacement of the standing plan's week structure. The whole
 * structure is recorded (not a diff) so state projected from the log alone
 * reproduces the plan exactly; `lastChanged` becomes this event's day.
 */
export interface PlanUpdateEvent extends BaseEvent {
  type: 'plan-update';
  weekStructure: PlannedSession[];
  note?: string;
}

/**
 * A declared per-modality HR band calibration (I9: zones are per-modality,
 * never from `220 − age`). Recalibration is a new event; computed sessions
 * reference the calibration they used by event id, so a later recalibration
 * can never silently rewrite history.
 */
export interface HrBandCalibrationEvent extends BaseEvent {
  type: 'hr-band-calibration';
  modality: Modality;
  hrMaxBpm: number;
  hrRestBpm: number;
  /** Ordered, contiguous, non-overlapping; validated at the adapter boundary. */
  bands: HrBand[];
  method?: string;
}

/**
 * The computed summary of one raw heart-rate stream: time in band against
 * the personal calibration, plus cardiac drift. Only raw samples ever feed
 * this — device zone labels are rejected at the adapter boundary and are not
 * representable here. The stream itself stays outside the log (it is a
 * source blob, not an event); this summary is deterministic given the stream
 * and the referenced calibration.
 */
export interface AerobicSessionEvent extends BaseEvent {
  type: 'aerobic-session';
  /** id of the ActivityEvent this stream belongs to, when known (e.g. strava_<id>). */
  activityId?: string;
  modality: Modality;
  /** id of the HrBandCalibrationEvent the band math used. */
  calibrationId: string;
  durationSeconds: number;
  /** Seconds attributed to bands; gaps beyond the cap are excluded, not guessed. */
  trackedSeconds: number;
  gapSeconds: number;
  /** Seconds per band name from the calibration. */
  timeInBandSeconds: Record<string, number>;
  meanHrBpm: number;
  maxHrBpm: number;
  drift: CardiacDriftResult;
  /** Outdoor runs confound drift; treadmill sessions can be clean. */
  environment: 'outdoor' | 'treadmill' | 'indoor' | 'unknown';
}

/**
 * A LOWER-TRUST aerobic record for sources that offer only device-bucketed
 * zone minutes (e.g. Apple Watch history with no stream). Device buckets are
 * stored verbatim for the record, and where an absolute bpm threshold is
 * reconstructible, minutes above it are recorded — but nothing here may ever
 * enter time-in-band math, and every surface that shows it must label it
 * lower trust. Device bands are cut differently from the personal bands and
 * have changed boundaries mid-history; a zone label is a claim by a vendor,
 * not a measurement.
 */
export interface BucketedZoneMinutesEvent extends BaseEvent {
  type: 'bucketed-zone-minutes';
  device: string;
  /** Literal: this record type cannot be anything but lower trust. */
  trust: 'low';
  modality: Modality;
  durationMinutes: number;
  /** Minutes at or above an absolute bpm line, where reconstructible. */
  minutesAboveThreshold?: Array<{ thresholdBpm: number; minutes: number }>;
  /** The device's own buckets, verbatim, for provenance only — never band math. */
  deviceBuckets?: Array<{ label: string; minutes: number }>;
  note?: string;
}

/**
 * A Cooper 12-minute test. Outdoor track and treadmill are separate series
 * that are never pooled into one trend line — surface changes the test, so a
 * mixed series would trend the venue, not the athlete. Surface, pacing
 * strategy, and (for treadmill) ramp correction are recorded per test.
 * Deliberately not a FitnessMeasurementEvent: it must not overwrite the
 * GXT-derived vo2max estimate or mix into its series.
 */
export interface CooperTestEvent extends BaseEvent {
  type: 'cooper-test';
  surface: CooperSurface;
  distanceMeters: number;
  /** (distanceMeters − 504.9) / 44.73, computed at the adapter, never re-derived downstream. */
  vo2maxEstimate: number;
  pacingStrategy: string;
  /** Treadmill only: what was done about incline/ramp (e.g. "1% incline throughout"). */
  rampCorrection?: string;
  /** ml/kg/min; feeds the SDC band on the series chart (I3). */
  typicalError?: number;
}

export type EngineEvent =
  | RecoverySignalEvent
  | FitnessMeasurementEvent
  | LeverMeasurementEvent
  | ActivityEvent
  | MissedSessionEvent
  | SubjectiveEvent
  | IllnessEvent
  | InjuryEvent
  | InterruptionEvent
  | BlockStartEvent
  | RetestEvent
  | ProfileUpdateEvent
  | PlanUpdateEvent
  | HrBandCalibrationEvent
  | AerobicSessionEvent
  | BucketedZoneMinutesEvent
  | CooperTestEvent;
