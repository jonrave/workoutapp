/**
 * Manual-entry adapter: form payloads → EngineEvents.
 *
 * Provenance is set by the entry path, never chosen by the user. typicalError
 * defaults come from the contract §8 measurement table and are not overridable
 * to a smaller value — a user cannot declare a measurement more precise than
 * its protocol supports (I3).
 */
import { CONSTANTS, sdc } from '@peakspan/engine';
import type {
  ActivityEvent,
  BlockStartEvent,
  FitnessMeasurementEvent,
  FitnessMetric,
  IllnessEvent,
  InjuryEvent,
  InterruptionEvent,
  IsoDate,
  IsoDateTime,
  LeverMeasurementEvent,
  MissedSessionEvent,
  Modality,
  Pillar,
  RecoverySignalEvent,
  RetestEvent,
  Slot,
  SubjectiveEvent,
  TissueChannel,
} from '@peakspan/engine';

/** Injectable id/clock so tests are deterministic; real callers use the default. */
export interface EventContext {
  id: () => string;
  now: () => IsoDateTime;
}

export const defaultContext: EventContext = {
  id: () => `evt_${crypto.randomUUID()}`,
  now: () => new Date().toISOString(),
};

/**
 * §8 typical-error defaults. Percent entries are of the measured value;
 * absolute entries are in the metric's units. All conventions from the
 * contract's measurement table.
 */
const TYPICAL_ERROR_DEFAULTS: Record<string, { pct?: number; abs?: number }> = {
  vo2max: { pct: 0.04 },
  lt1Pace: { pct: 0.025 },
  cmjHeight: { pct: 0.04 },
  rsi: { pct: 0.05 },
  maxStrength: { pct: 0.03 },
  peakPower: { pct: 0.05 },
  almi: { pct: 0.02 },
  fmi: { pct: 0.05 },
  vat: { abs: 50 },
  romAsymmetry: { abs: 2 },
  waistCm: { abs: 1 },
  homeSBP7d: { abs: 4 },
  homeDBP7d: { abs: 3 },
  apoB: { abs: 4 },
  lpa: { abs: 5 },
  hba1c: { abs: 0.1 },
  fastingInsulin: { abs: 0.8 },
};

export function defaultTypicalError(metric: string, value: number): number | undefined {
  const d = TYPICAL_ERROR_DEFAULTS[metric];
  if (!d) return undefined;
  const candidates = [d.pct !== undefined ? Math.abs(value) * d.pct : undefined, d.abs].filter(
    (x): x is number => x !== undefined,
  );
  return candidates.length ? Math.max(...candidates) : undefined;
}

/** Provided error may widen the default, never narrow it. */
export function resolveTypicalError(
  metric: string,
  value: number,
  provided?: number,
): number | undefined {
  const def = defaultTypicalError(metric, value);
  if (provided === undefined) return def;
  if (def === undefined) return provided;
  return Math.max(provided, def);
}

export function fitnessMeasurement(
  input: {
    metric: FitnessMetric;
    value: number;
    unit: string;
    occurredAt: IsoDateTime;
    typicalError?: number;
    modality?: Modality;
    source: 'measured-lab' | 'measured-field' | 'derived';
  },
  ctx: EventContext = defaultContext,
): FitnessMeasurementEvent {
  const event: FitnessMeasurementEvent = {
    id: ctx.id(),
    type: 'fitness-measurement',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: input.source,
    metric: input.metric,
    value: input.value,
    unit: input.unit,
  };
  const te = resolveTypicalError(input.metric, input.value, input.typicalError);
  if (te !== undefined) event.typicalError = te;
  if (input.modality !== undefined) event.modality = input.modality;
  return event;
}

export function leverMeasurement(
  input: {
    lever: LeverMeasurementEvent['lever'];
    value: number;
    unit: string;
    occurredAt: IsoDateTime;
    typicalError?: number;
    source: 'measured-lab' | 'measured-field' | 'user-reported';
  },
  ctx: EventContext = defaultContext,
): LeverMeasurementEvent {
  const event: LeverMeasurementEvent = {
    id: ctx.id(),
    type: 'lever-measurement',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: input.source,
    lever: input.lever,
    value: input.value,
    unit: input.unit,
  };
  const te = resolveTypicalError(input.lever, input.value, input.typicalError);
  if (te !== undefined) event.typicalError = te;
  return event;
}

export function recoverySignal(
  input: {
    signal: RecoverySignalEvent['signal'];
    value: number;
    occurredAt: IsoDateTime;
    /** 'device-raw' only from a device adapter; manual entry is 'user-reported'. */
    source: 'device-raw' | 'user-reported';
  },
  ctx: EventContext = defaultContext,
): RecoverySignalEvent {
  return {
    id: ctx.id(),
    type: 'recovery-signal',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: input.source,
    signal: input.signal,
    value: input.value,
  };
}

export function activity(
  input: {
    planned: boolean;
    plannedSlot: Slot | null;
    modality: Modality;
    durationMinutes: number;
    sRPE: number;
    occurredAt: IsoDateTime;
    pillarLoad?: Partial<Record<Pillar, number>>;
    tissueLoad?: Partial<Record<TissueChannel, number>>;
    description?: string;
  },
  ctx: EventContext = defaultContext,
): ActivityEvent {
  const baseLoad = input.sRPE * input.durationMinutes;
  const event: ActivityEvent = {
    id: ctx.id(),
    type: 'activity',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    planned: input.planned,
    plannedSlot: input.plannedSlot,
    modality: input.modality,
    durationMinutes: input.durationMinutes,
    sRPE: input.sRPE,
    pillarLoad: input.pillarLoad ?? defaultPillarLoad(input.modality, baseLoad),
    tissueLoad: input.tissueLoad ?? {},
  };
  if (input.description !== undefined) event.description = input.description;
  return event;
}

function defaultPillarLoad(modality: Modality, load: number): Partial<Record<Pillar, number>> {
  if (modality === 'lift') return { maxStrength: load };
  return { zone2: load };
}

export function missedSession(
  input: { plannedSlot: Slot; occurredAt: IsoDateTime; reason?: string },
  ctx: EventContext = defaultContext,
): MissedSessionEvent {
  const event: MissedSessionEvent = {
    id: ctx.id(),
    type: 'missed-session',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    plannedSlot: input.plannedSlot,
  };
  if (input.reason !== undefined) event.reason = input.reason;
  return event;
}

export function subjective(
  input: {
    occurredAt: IsoDateTime;
    soreness?: number;
    pain?: { site: TissueChannel | string; score: number };
    altersMovement?: boolean;
    note?: string;
  },
  ctx: EventContext = defaultContext,
): SubjectiveEvent {
  const { occurredAt, ...rest } = input;
  return {
    id: ctx.id(),
    type: 'subjective',
    occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    ...rest,
  };
}

export function illness(
  input: {
    phase: IllnessEvent['phase'];
    systemic: boolean;
    symptoms: string[];
    occurredAt: IsoDateTime;
  },
  ctx: EventContext = defaultContext,
): IllnessEvent {
  return {
    id: ctx.id(),
    type: 'illness',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    phase: input.phase,
    systemic: input.systemic,
    symptoms: input.symptoms,
  };
}

export function injury(
  input: {
    site: TissueChannel | string;
    severity: InjuryEvent['severity'];
    occurredAt: IsoDateTime;
    recurrenceOf?: string;
    resolved?: boolean;
    note?: string;
  },
  ctx: EventContext = defaultContext,
): InjuryEvent {
  const event: InjuryEvent = {
    id: ctx.id(),
    type: 'injury',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    site: input.site,
    severity: input.severity,
    resolved: input.resolved ?? false,
  };
  if (input.recurrenceOf !== undefined) event.recurrenceOf = input.recurrenceOf;
  if (input.note !== undefined) event.note = input.note;
  return event;
}

export function interruption(
  input: {
    cause: InterruptionEvent['cause'];
    startDate: IsoDate;
    endDate: IsoDate | null;
    occurredAt: IsoDateTime;
  },
  ctx: EventContext = defaultContext,
): InterruptionEvent {
  return {
    id: ctx.id(),
    type: 'interruption',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    cause: input.cause,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}

export class IllPosedThresholdError extends Error {
  constructor(
    public readonly thresholdValue: number,
    public readonly baseline: number,
    public readonly sdcValue: number,
  ) {
    super(
      `Pre-registered threshold ${thresholdValue} lies inside the measurement noise band ` +
        `(baseline ${baseline} ± SDC ${sdcValue.toFixed(2)}). A threshold that a sub-SDC ` +
        `delta could satisfy is unfalsifiable (I3 + I10); register one at least one SDC ` +
        `from baseline.`,
    );
  }
}

/**
 * Block start with pre-registration (I10). Enforces the user-approved RA2
 * rule: the threshold must sit at least one SDC from the baseline, otherwise
 * registration is refused as ill-posed.
 */
export function startBlock(
  input: {
    pillar: Pillar;
    plannedWeeks: number;
    metricUnderTest: FitnessMetric;
    baselineValue: number;
    baselineTypicalError: number;
    direction: 'increase' | 'decrease';
    thresholdValue: number;
    unit: string;
    occurredAt: IsoDateTime;
  },
  ctx: EventContext = defaultContext,
): BlockStartEvent {
  const sdcValue = sdc(input.baselineTypicalError);
  const delta = Math.abs(input.thresholdValue - input.baselineValue);
  const rightDirection =
    input.direction === 'increase'
      ? input.thresholdValue > input.baselineValue
      : input.thresholdValue < input.baselineValue;
  if (!rightDirection || delta < sdcValue) {
    throw new IllPosedThresholdError(input.thresholdValue, input.baselineValue, sdcValue);
  }
  return {
    id: ctx.id(),
    type: 'block-start',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: 'user-reported',
    pillar: input.pillar,
    plannedWeeks: input.plannedWeeks,
    metricUnderTest: input.metricUnderTest,
    preRegisteredThreshold: {
      metric: input.metricUnderTest,
      direction: input.direction,
      value: input.thresholdValue,
      unit: input.unit,
      registeredAt: input.occurredAt,
    },
  };
}

export function submitRetest(
  input: {
    blockId: string;
    metric: FitnessMetric;
    value: number;
    unit: string;
    occurredAt: IsoDateTime;
    typicalError?: number;
    source: 'measured-lab' | 'measured-field';
  },
  ctx: EventContext = defaultContext,
): RetestEvent {
  const event: RetestEvent = {
    id: ctx.id(),
    type: 'retest',
    occurredAt: input.occurredAt,
    recordedAt: ctx.now(),
    source: input.source,
    blockId: input.blockId,
    metric: input.metric,
    value: input.value,
    unit: input.unit,
  };
  const te = resolveTypicalError(input.metric, input.value, input.typicalError);
  if (te !== undefined) event.typicalError = te;
  return event;
}

export { CONSTANTS };
