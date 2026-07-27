/**
 * `Decision`: the structured output of `decide(state, date)`.
 *
 * Structured data only — no prose. An LLM may render a Decision into readable
 * text or explain it on demand, but may never choose sets, reps, intensity,
 * modality, or rest (I2). Rationale is therefore expressed as machine codes
 * with parameters, not sentences.
 */

import type { IsoDate } from './field';
import type {
  FitnessMetric,
  Modality,
  Pillar,
  Slot,
  TissueChannel,
} from './state';

/** Layer indices of the section 4 cascade, evaluated in strict order. */
export type CascadeLayer = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Machine-readable reason, e.g.
 * `{ code: 'hrv-flag-active', params: { hrv7d: 4.10, threshold: 4.13, sustainedDays: 5 } }`.
 * The code vocabulary is fixed in Step 3 alongside the engine.
 */
export interface RationaleCode {
  code: string;
  params?: Record<string, string | number | boolean>;
}

/** Per-layer evaluation record, kept for on-demand explanation (I2c). */
export interface LayerTrace {
  layer: CascadeLayer;
  fired: boolean;
  codes: RationaleCode[];
}

/** Layer 0 red flags. Output is stop and seek care; no training content. */
export type MedicalRedFlag =
  | 'chest-pain'
  | 'syncope'
  | 'new-neurological-symptoms'
  | 'suspected-fracture'
  | 'resting-hr-out-of-range';

export interface MedicalStop {
  reasons: MedicalRedFlag[];
  instruction: 'stop-training-seek-care';
}

/** Layer 1 hard blocks. No optimization inside this layer. */
export interface GateResult {
  gate:
    /** Systemic illness: no training, section 6 ramp on return. */
    | 'systemic-illness'
    /** Pain >3/10 or altered movement: pattern blocked, alternative substituted. */
    | 'pain-block'
    /** Plyo/max-velocity blocked: sleep <6h prior night, active HRV flag, or post-strain tissue window. */
    | 'plyometric-block'
    /** Sleep lever active (7d mean <7h): any increase in training load is blocked (section 5). */
    | 'sleep-load-cap';
  blockedChannels: TissueChannel[];
  /** Substituted session when a pattern is blocked but training continues; `null` when nothing substitutes. */
  substitution: SessionPrescription | null;
  trigger: RationaleCode;
}

/** Layer 2 surface (I6). Never consumes or reallocates training time. */
export interface LeverSurface {
  lever:
    | 'bloodPressure'
    | 'apoB'
    | 'lpaNeverMeasured'
    | 'sleepDuration'
    | 'sleepTimingVariance'
    | 'alcohol'
    | 'centralAdiposity'
    | 'metabolic'
    /** A lever field is past its refresh cadence (section 5). */
    | 'staleness';
  priority: 'highest-non-emergent' | 'standard';
  /** Structurally pinned: surfacing a lever never changes the training plan (I6). */
  trainingPlanUnchanged: true;
  trigger: RationaleCode;
}

/** Layer 3: floor status per pillar. */
export interface FloorAllocation {
  met: boolean;
  prescribedSessions: number;
  /** sRPE-minute cost reserved for this pillar's floor (I7). */
  reservedCost: number;
}

/** Layer 4: one marginal reallocation of residual budget. */
export interface MarginalAllocation {
  pillar: Pillar;
  /** healthSlope * estimatedResponseRate * (1 - injuryHazardDelta). */
  marginalValue: number;
  /** Signed share of weekly budget moved; |value| capped at ~0.15 per step. */
  deltaShareOfBudget: number;
}

export interface AllocationReport {
  floors: Record<Pillar, FloorAllocation>;
  /** Residual after floors, in sRPE-minute cost units — never minutes (I7). */
  residualBudgetCost: number;
  marginal: MarginalAllocation[];
}

/** One element of a session: an exercise or interval block. */
export interface ExerciseBlock {
  name: string;
  sets?: number;
  /** e.g. "5", "6-8", "3/side". */
  reps?: string;
  /**
   * e.g. "75-80% e1RM", "Z2", "Z5 4x4min". Zones are per-modality from
   * measured thresholds — never `220 - age` (I9).
   */
  intensity?: string;
  restSeconds?: number;
}

/** Layer 5 output: a fully specified session. */
export interface SessionPrescription {
  slot: Slot;
  pillar: Pillar;
  /** Interval work only on a `vo2CapableModalities` member (I9). */
  modality: Modality;
  blocks: ExerciseBlock[];
  durationMinutes: number;
  targetSRPE: number;
  modalityMultiplier: number;
  /** sRPE * durationMinutes * modalityMultiplier (I7). */
  expectedCost: number;
  /** Channels this session loads, for tissue recency accounting. */
  tissueExposure: TissueChannel[];
}

/** A plan change stripped by the noise gate: its trigger had not cleared SDC (I3). */
export interface StrippedChange {
  metric: FitnessMetric | string;
  delta: number;
  sdc: number;
  reason: 'delta-below-sdc';
}

/** A plan change that survived the noise gate. */
export interface AppliedChange {
  metric: FitnessMetric | string;
  delta: number;
  sdc: number;
  change: RationaleCode;
}

/**
 * Layer 6 report. `no-change-detected` — the standing plan, stated as such —
 * is the expected output most weeks and must be rendered as a legible,
 * respectable outcome (sections 1 and 11).
 */
export interface NoiseGateReport {
  outcome: 'changes-applied' | 'no-change-detected';
  strippedChanges: StrippedChange[];
  appliedChanges: AppliedChange[];
}

export interface Decision {
  date: IsoDate;
  /** First layer that fired; determines the shape of the output (section 4). */
  firedLayer: CascadeLayer;
  trace: LayerTrace[];
  /** `null` when Layer 0 or a full Layer 1 illness block stops all training. */
  sessions: SessionPrescription[] | null;
  medicalStop: MedicalStop | null;
  gates: GateResult[];
  surfacedLevers: LeverSurface[];
  /** `null` when no allocation ran (layers 0–1 stopped the cascade). */
  allocation: AllocationReport | null;
  noiseGate: NoiseGateReport;
  rationale: RationaleCode[];
}
