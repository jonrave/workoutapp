/**
 * Event types for the append-only log (consumed in Step 5; adapters in Step 4
 * normalize into these and do nothing else). Derived `UserState` must be
 * recomputable from this log.
 *
 * Only raw signals are representable (I4): there is deliberately no event for
 * a vendor composite score.
 */

import type { IsoDate, IsoDateTime, Provenance } from './field';
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
  | PlanUpdateEvent;
