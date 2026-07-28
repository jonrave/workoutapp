/**
 * `UserState`: the single object consumed by `decide(state, date) -> Decision`.
 *
 * The engine is a pure function over this state (I1). Everything here is
 * either raw signal, a derived rolling statistic, or user-declared fact —
 * never a vendor composite (I4), never a single-day reading where a rolling
 * mean is mandated (I5).
 *
 * Contract section 3 marks its shape "sketch, not final". Two refinements
 * made here, neither touching a section 2 invariant:
 * - The sketch lists tissue exposure both as `load.byTissue` and as a
 *   top-level `tissue` section describing the same nine channels. They are one
 *   structure; it lives once, as top-level `tissue`.
 * - `trainability` and `standingPlan` are added: Layer 4 needs the per-pillar
 *   response estimate (section 7) and Layer 6 diffs against the standing plan,
 *   and a pure function can only receive them through state.
 */

import type { Field, IsoDate, IsoDateTime, TrainabilityEstimate } from './field';

/** The five capacity pillars (section 4, Layer 3). */
export type Pillar = 'maxStrength' | 'vo2max' | 'zone2' | 'power' | 'mobility';

/** The nine tissue exposure channels (section 3). */
export type TissueChannel =
  | 'axialCompression'
  | 'kneeExtensor'
  | 'hipExtensor'
  | 'hamstringHighVelocity'
  | 'calfAchillesHighVelocity'
  | 'upperPush'
  | 'upperPull'
  | 'shoulderOverhead'
  | 'connectiveHighVelocity';

/**
 * Training modalities. `vo2CapableModalities` is the hard gate (I9): Zone 5
 * and threshold interval work may only be prescribed on a listed modality.
 * `spinBike` exists as a modality precisely so it can be absent from that list.
 */
export type Modality =
  | 'run'
  | 'airBike'
  | 'spinBike'
  | 'row'
  | 'swim'
  | 'hike'
  | 'lift'
  | 'other';

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type TimeOfDay = 'morning' | 'midday' | 'evening';

/** Scheduling slot; the unit of learned adherence (`adherenceBySlot`). */
export type Slot = `${DayOfWeek}-${TimeOfDay}`;

/** Layer 0 red flags. Output is stop and seek care; no training content. */
export type MedicalRedFlag =
  | 'chest-pain'
  | 'syncope'
  | 'new-neurological-symptoms'
  | 'suspected-fracture'
  | 'resting-hr-out-of-range';

/** Major strength patterns; the "per major pattern" unit of the Layer 3 strength floor. */
export type StrengthPattern =
  | 'squat'
  | 'hinge'
  | 'horizontalPress'
  | 'verticalPress'
  | 'horizontalPull'
  | 'verticalPull';

/** sRPE-minute load per pillar. Cost units, never raw minutes (I7). */
export type PillarLoad = Record<Pillar, number>;

/** Recency and accumulated recent load for one tissue channel. */
export interface TissueState {
  /** `null` = no exposure on record. */
  daysSinceLastExposure: number | null;
  /** Accumulated recent sRPE-minute load routed to this channel. */
  recentLoad: number;
}

export type TissueLoad = Record<TissueChannel, TissueState>;

/**
 * A declared, time-bounded change to circumstances (travel, work crunch).
 * Declared facts, not noisy signals: the SDC gate does not apply to them.
 */
export interface TemporaryConstraint {
  startDate: IsoDate;
  endDate: IsoDate;
  /** Replaces `equipment` while active. */
  equipment?: string[];
  dailyMinutesCap?: number;
  /** Replaces `weeklyBudgetMinutes` while active. */
  weeklyBudgetMinutes?: number;
  note?: string;
}

export interface Profile {
  age: number;
  sex: 'male' | 'female';
  trainingAgeYears: number;
  /** I9: hard constraint. Interval work only on these; per-modality zones from measured thresholds. */
  vo2CapableModalities: Modality[];
  equipment: string[];
  weeklyBudgetMinutes: number;
  /** Declared hard constraints, e.g. "no barbell overhead pressing". */
  hardConstraints: string[];
  temporaryConstraints: TemporaryConstraint[];
}

export interface LoadState {
  /** 7-day EWMA of sRPE-minutes per pillar. */
  acute: PillarLoad;
  /** 28-day EWMA of sRPE-minutes per pillar. ACWR derived from these is a soft flag only, never a hard block (section 6). */
  chronic: PillarLoad;
  /**
   * Most recent unplanned activity, classified into tissue exposure
   * (section 6). Drives following-day suppression when hard (sRPE >= 7).
   */
  lastUnplannedActivity: {
    date: IsoDate;
    sRPE: number;
    tissueChannels: TissueChannel[];
  } | null;
}

export interface IllnessFlag {
  onset: IsoDate;
  /** Fever, body aches, below-neck symptoms → Layer 1 hard block, no training. */
  systemic: boolean;
  symptoms: string[];
  resolved: IsoDate | null;
}

/**
 * Raw recovery signals only (I4). HRV and RHR appear exclusively as rolling
 * 7-day means against 60-day baselines (I5); the flag condition is
 * `hrv7d < hrvBaseline60d - 0.75 * hrvBaselineSD`, sustained.
 */
export interface RecoveryState {
  /** ln rMSSD, rolling 7-day mean. */
  hrv7d: Field<number>;
  /** ln rMSSD, 60-day baseline mean. */
  hrvBaseline60d: Field<number>;
  /** SD of the 60-day HRV baseline. */
  hrvBaselineSD: Field<number>;
  /** bpm, rolling 7-day mean. */
  rhr7d: Field<number>;
  /** bpm, 60-day baseline mean. */
  rhrBaseline60d: Field<number>;
  /** Hours, rolling 7-day mean. Lever flag at <7h (section 5). */
  sleepMean7d: Field<number>;
  /** Minutes: 14-day SD of sleep midpoint. Lever flag at >60 min (section 5). */
  sleepMidpointSD14d: Field<number>;
  /** Hours of accumulated sleep debt vs need, rolling. */
  sleepDebtRolling: Field<number>;
  /** Hours slept the prior night — Layer 1 blocks plyometric/max-velocity work when <6h. */
  sleepPriorNight: Field<number>;
  /** 0–10 whole-body soreness, user-reported. */
  subjectiveSoreness: Field<number>;
  illnessFlags: IllnessFlag[];
  /**
   * Consecutive days the 7-day HRV mean has been strictly below
   * baseline − 0.75 SD (I5). Projector-derived; "sustained" is defined over
   * this counter (convention pinned in constants.ts).
   */
  hrvDaysBelowThreshold: number;
  /** Currently reported site pain (Layer 1 input); injury *history* lives in `history.injuries`. */
  activePain: PainReport[];
  /** Layer 0 inputs. Any entry stops the cascade: no training content generated. */
  medicalRedFlags: MedicalRedFlag[];
}

export interface PainReport {
  site: TissueChannel | string;
  score0to10: number;
  /** Pain that alters gait or movement quality blocks regardless of score (Layer 1). */
  altersMovement: boolean;
  reportedAt: IsoDate;
}

/**
 * Per-pillar fitness estimates: point estimate + uncertainty + measurement
 * date, all carried by `Field<number>` (`typicalError` → derived SDC, I3).
 */
export interface FitnessState {
  /** ml/kg/min. */
  vo2max: Field<number>;
  /** Seconds per km at LT1 on the primary modality. */
  lt1Pace: Field<number>;
  /** Estimated 1RM in kg per major pattern. */
  maxStrength: Record<StrengthPattern, Field<number>>;
  /** Watts. */
  peakPower: Field<number>;
  /** cm, weekly median of 5 (section 8). */
  cmjHeight: Field<number>;
  /** Reactive strength index, unitless. */
  rsi: Field<number>;
  /** Appendicular lean mass index, kg/m². Near-zero decision value in a 15-year lifter (section 8). */
  almi: Field<number>;
  /** Fat mass index, kg/m². */
  fmi: Field<number>;
  /** DEXA visceral adipose tissue, cm³. */
  vat: Field<number>;
  /** Percent asymmetry on tracked ROM tests. */
  romAsymmetry: Field<number>;
}

/**
 * Non-training levers (section 5, I6). Their own lane; flags here never
 * consume or reallocate training time. Each field's `lastUpdated` drives
 * staleness prompting.
 */
export interface LeverState {
  /** mmHg, 7-day home protocol mean. Flag at >=130. */
  homeSBP7d: Field<number>;
  /** mmHg, 7-day home protocol mean. */
  homeDBP7d: Field<number>;
  /** mg/dL. Flag at >70, or >60 with Lp(a) >50 nmol/L or family history. */
  apoB: Field<number>;
  /** nmol/L, isoform-independent assay. `null` = never measured → prompt once per lifetime. */
  lpa: Field<number> | null;
  /** Percent. */
  hba1c: Field<number>;
  /** µIU/mL. */
  fastingInsulin: Field<number>;
  /** Rolling 7-day units. */
  alcoholUnits7d: Field<number>;
  /** User-set weekly units threshold for the alcohol flag. */
  alcoholThreshold7d: number;
  /** cm. Flag at >94. */
  waistCm: Field<number>;
}

export interface Interruption {
  startDate: IsoDate;
  cause: 'illness' | 'injury' | 'travel' | 'work' | 'family' | 'other';
  durationDays: number;
  note?: string;
}

export interface Injury {
  /** Tissue channel where mappable; free text otherwise. */
  site: TissueChannel | string;
  date: IsoDate;
  severity: 'minor' | 'moderate' | 'severe';
  /** Times this site has re-injured after apparent resolution. */
  recurrenceCount: number;
  resolved: boolean;
  note?: string;
}

/**
 * `interruptions` is the empirical base rate of what actually stops this user
 * from training — under the section 1 objective, more informative than any
 * fitness percentile. `adherenceBySlot` is learned, not declared.
 */
export interface History {
  interruptions: Interruption[];
  injuries: Injury[];
  /** Completion rate 0–1 per slot, learned from outcomes. */
  adherenceBySlot: Partial<Record<Slot, number>>;
}

/**
 * Written to immutable storage before the block runs (I10). A retest without
 * one of these on record must be refused.
 */
export interface PreRegisteredThreshold {
  metric: FitnessMetric;
  direction: 'increase' | 'decrease';
  /** Absolute target value in the metric's units. */
  value: number;
  unit: string;
  registeredAt: IsoDateTime;
}

/** Metrics a block can be registered against. */
export type FitnessMetric = keyof FitnessState;

export interface BlockState {
  activePillar: Pillar;
  startDate: IsoDate;
  plannedWeeks: number;
  /** `null` only for legacy/imported blocks — which makes their retests unevaluable (I10). */
  preRegisteredThreshold: PreRegisteredThreshold | null;
  metricUnderTest: FitnessMetric;
  /** Value of `metricUnderTest` at block start; the retest delta is measured against this (I3). */
  baselineAtStart: number;
  /** `interrupted` when an interruption broke the block; its retest is unevaluable as a block outcome. */
  status: 'active' | 'interrupted';
  /** A submitted retest awaiting evaluation against the pre-registered threshold (I10). */
  pendingRetest: {
    value: number;
    unit: string;
    typicalError?: number;
    measuredAt: IsoDate;
  } | null;
}

/** One session of the standing weekly plan. */
export interface PlannedSession {
  slot: Slot;
  pillar: Pillar;
  modality: Modality;
  /** Human-readable summary; the structured prescription lives in the Decision. */
  description: string;
  durationMinutes: number;
  targetSRPE: number;
}

/**
 * The standing plan Layer 6 diffs against. The default output most weeks is
 * this plan, unchanged (section 1).
 */
export interface StandingPlan {
  weekStructure: PlannedSession[];
  lastChanged: IsoDate;
}

export interface UserState {
  profile: Profile;
  load: LoadState;
  /** Days since last exposure + accumulated recent load, per channel. */
  tissue: TissueLoad;
  recovery: RecoveryState;
  fitness: FitnessState;
  levers: LeverState;
  history: History;
  /** `null` when no focused block is active. */
  block: BlockState | null;
  /** Per-pillar response estimates (section 7); default `not-yet-identifiable` (I8). */
  trainability: Record<Pillar, TrainabilityEstimate>;
  standingPlan: StandingPlan;
}
