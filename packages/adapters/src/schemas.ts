/**
 * Zod validation for EngineEvents at the ingestion boundary. Plausibility
 * ranges are conventions; the engine itself stays pure and trusts its inputs
 * (I1) — this is the gate in front of it.
 */
import { z } from 'zod';
import type { EngineEvent } from '@peakspan/engine';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T/, 'expected ISO 8601 timestamp');
const provenance = z.enum([
  'measured-lab',
  'measured-field',
  'device-raw',
  'user-reported',
  'derived',
  'population-prior',
]);
const modality = z.enum(['run', 'airBike', 'spinBike', 'row', 'swim', 'hike', 'lift', 'other']);
const pillar = z.enum(['maxStrength', 'vo2max', 'zone2', 'power', 'mobility']);
const tissueChannel = z.enum([
  'axialCompression',
  'kneeExtensor',
  'hipExtensor',
  'hamstringHighVelocity',
  'calfAchillesHighVelocity',
  'upperPush',
  'upperPull',
  'shoulderOverhead',
  'connectiveHighVelocity',
]);
const fitnessMetric = z.enum([
  'vo2max',
  'lt1Pace',
  'maxStrength',
  'peakPower',
  'cmjHeight',
  'rsi',
  'almi',
  'fmi',
  'vat',
  'romAsymmetry',
]);

const base = {
  id: z.string().min(1),
  occurredAt: isoDateTime,
  recordedAt: isoDateTime,
  source: provenance,
};

export const recoverySignalSchema = z.object({
  ...base,
  type: z.literal('recovery-signal'),
  signal: z.enum([
    'hrvLnRmssd',
    'restingHr',
    'sleepDurationHours',
    'sleepMidpointClockTime',
    'sleepEfficiencyPct',
    'temperatureDeviation',
  ]),
  value: z.number(),
});

/** Plausibility ranges per raw signal (conventions). */
const SIGNAL_RANGES: Record<string, [number, number]> = {
  hrvLnRmssd: [2, 6],
  restingHr: [25, 120],
  sleepDurationHours: [0, 16],
  sleepMidpointClockTime: [0, 1440],
  sleepEfficiencyPct: [0, 100],
  temperatureDeviation: [-3, 3],
};

export const fitnessMeasurementSchema = z.object({
  ...base,
  type: z.literal('fitness-measurement'),
  metric: fitnessMetric,
  value: z.number().positive(),
  unit: z.string().min(1),
  typicalError: z.number().positive().optional(),
  modality: modality.optional(),
  pattern: z
    .enum(['squat', 'hinge', 'horizontalPress', 'verticalPress', 'horizontalPull', 'verticalPull'])
    .optional(),
});

export const leverMeasurementSchema = z.object({
  ...base,
  type: z.literal('lever-measurement'),
  lever: z.enum([
    'homeSBP7d',
    'homeDBP7d',
    'apoB',
    'lpa',
    'hba1c',
    'fastingInsulin',
    'alcoholUnits',
    'waistCm',
  ]),
  value: z.number().nonnegative(),
  unit: z.string().min(1),
  typicalError: z.number().positive().optional(),
});

export const activitySchema = z.object({
  ...base,
  type: z.literal('activity'),
  planned: z.boolean(),
  plannedSlot: z.string().nullable(),
  modality,
  durationMinutes: z.number().min(1).max(720),
  sRPE: z.number().min(0).max(10),
  pillarLoad: z.partialRecord(pillar, z.number().nonnegative()),
  tissueLoad: z.partialRecord(tissueChannel, z.number().nonnegative()),
  description: z.string().optional(),
});

export const missedSessionSchema = z.object({
  ...base,
  type: z.literal('missed-session'),
  plannedSlot: z.string(),
  reason: z.string().optional(),
});

export const subjectiveSchema = z.object({
  ...base,
  type: z.literal('subjective'),
  soreness: z.number().min(0).max(10).optional(),
  pain: z.object({ site: z.string(), score: z.number().min(0).max(10) }).optional(),
  altersMovement: z.boolean().optional(),
  note: z.string().optional(),
});

export const illnessSchema = z.object({
  ...base,
  type: z.literal('illness'),
  phase: z.enum(['onset', 'update', 'resolved']),
  systemic: z.boolean(),
  symptoms: z.array(z.string()),
});

export const injurySchema = z.object({
  ...base,
  type: z.literal('injury'),
  site: z.string(),
  severity: z.enum(['minor', 'moderate', 'severe']),
  recurrenceOf: z.string().optional(),
  resolved: z.boolean(),
  note: z.string().optional(),
});

export const interruptionSchema = z.object({
  ...base,
  type: z.literal('interruption'),
  cause: z.enum(['illness', 'injury', 'travel', 'work', 'family', 'other']),
  startDate: isoDate,
  endDate: isoDate.nullable(),
});

export const blockStartSchema = z.object({
  ...base,
  type: z.literal('block-start'),
  pillar,
  plannedWeeks: z.number().int().min(2).max(16),
  metricUnderTest: fitnessMetric,
  baselineValue: z.number().optional(),
  preRegisteredThreshold: z.object({
    metric: fitnessMetric,
    direction: z.enum(['increase', 'decrease']),
    value: z.number(),
    unit: z.string().min(1),
    registeredAt: isoDateTime,
  }),
});

export const retestSchema = z.object({
  ...base,
  type: z.literal('retest'),
  blockId: z.string().min(1),
  metric: fitnessMetric,
  value: z.number().positive(),
  unit: z.string().min(1),
  typicalError: z.number().positive().optional(),
});

const dayOfWeek = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const timeOfDay = z.enum(['morning', 'midday', 'evening']);
const slot = z
  .string()
  .refine(
    (s) => {
      const [d, t] = s.split('-');
      return dayOfWeek.safeParse(d).success && timeOfDay.safeParse(t).success;
    },
    { message: 'expected <day>-<timeOfDay>, e.g. mon-morning' },
  );

export const plannedSessionSchema = z.object({
  slot,
  pillar,
  modality,
  description: z.string().min(1),
  durationMinutes: z.number().min(5).max(240),
  targetSRPE: z.number().min(0).max(10),
});

export const profileUpdateSchema = z.object({
  ...base,
  type: z.literal('profile-update'),
  fields: z
    .object({
      age: z.number().int().min(10).max(110),
      trainingAgeYears: z.number().min(0).max(90),
      vo2CapableModalities: z.array(modality),
      equipment: z.array(z.string().min(1)),
      weeklyBudgetMinutes: z.number().min(30).max(2400),
      hardConstraints: z.array(z.string().min(1)),
    })
    .partial(),
});

export const planUpdateSchema = z.object({
  ...base,
  type: z.literal('plan-update'),
  weekStructure: z
    .array(plannedSessionSchema)
    .min(1)
    .refine((ws) => new Set(ws.map((s) => s.slot)).size === ws.length, {
      message: 'each slot may appear at most once in the week structure',
    }),
  note: z.string().optional(),
});

const hrBandSchema = z.object({
  name: z.string().min(1),
  lowerBpm: z.number().min(0),
  upperBpm: z.number().min(1).nullable(),
});

export const hrBandCalibrationSchema = z.object({
  ...base,
  type: z.literal('hr-band-calibration'),
  modality,
  hrMaxBpm: z.number().min(100).max(230),
  hrRestBpm: z.number().min(25).max(100),
  bands: z.array(hrBandSchema).min(2),
  method: z.string().optional(),
});

const driftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('measured'),
    deltaBpm: z.number(),
    firstHalfMeanBpm: z.number(),
    secondHalfMeanBpm: z.number(),
    workRateSource: z.enum(['watts', 'velocity']),
    workRateHalfDeltaPct: z.number(),
  }),
  z.object({
    kind: z.literal('confounded'),
    reason: z.enum(['no-work-rate-stream', 'work-rate-mismatch-between-halves', 'variable-work-rate']),
    deltaBpm: z.number(),
    firstHalfMeanBpm: z.number(),
    secondHalfMeanBpm: z.number(),
    workRateSource: z.enum(['watts', 'velocity']).nullable(),
    workRateHalfDeltaPct: z.number().nullable(),
  }),
  z.object({
    kind: z.literal('unavailable'),
    reason: z.enum(['too-short', 'too-few-samples']),
  }),
]);

export const aerobicSessionSchema = z.object({
  ...base,
  type: z.literal('aerobic-session'),
  activityId: z.string().optional(),
  modality,
  calibrationId: z.string().min(1),
  durationSeconds: z.number().nonnegative(),
  trackedSeconds: z.number().nonnegative(),
  gapSeconds: z.number().nonnegative(),
  timeInBandSeconds: z.record(z.string(), z.number().nonnegative()),
  meanHrBpm: z.number().nonnegative(),
  maxHrBpm: z.number().nonnegative(),
  drift: driftSchema,
  environment: z.enum(['outdoor', 'treadmill', 'indoor', 'unknown']),
});

/** trust is the literal 'low': the schema, like the type, admits nothing else. */
export const bucketedZoneMinutesSchema = z.object({
  ...base,
  type: z.literal('bucketed-zone-minutes'),
  device: z.string().min(1),
  trust: z.literal('low'),
  modality,
  durationMinutes: z.number().positive(),
  minutesAboveThreshold: z
    .array(z.object({ thresholdBpm: z.number().positive(), minutes: z.number().nonnegative() }))
    .optional(),
  deviceBuckets: z.array(z.object({ label: z.string().min(1), minutes: z.number().nonnegative() })).optional(),
  note: z.string().optional(),
});

export const cooperTestSchema = z.object({
  ...base,
  type: z.literal('cooper-test'),
  surface: z.enum(['track', 'treadmill']),
  distanceMeters: z.number().min(1000).max(5000),
  vo2maxEstimate: z.number(),
  pacingStrategy: z.string().min(1),
  rampCorrection: z.string().optional(),
  typicalError: z.number().positive().optional(),
});

export const engineEventSchema = z.discriminatedUnion('type', [
  recoverySignalSchema,
  fitnessMeasurementSchema,
  leverMeasurementSchema,
  activitySchema,
  missedSessionSchema,
  subjectiveSchema,
  illnessSchema,
  injurySchema,
  interruptionSchema,
  blockStartSchema,
  retestSchema,
  profileUpdateSchema,
  planUpdateSchema,
  hrBandCalibrationSchema,
  aerobicSessionSchema,
  bucketedZoneMinutesSchema,
  cooperTestSchema,
]);

/** Validate an unknown payload as an EngineEvent; throws on failure. */
export function validateEvent(payload: unknown): EngineEvent {
  const event = engineEventSchema.parse(payload);
  if (event.type === 'recovery-signal') {
    const [lo, hi] = SIGNAL_RANGES[event.signal]!;
    if (event.value < lo || event.value > hi) {
      throw new Error(`${event.signal} value ${event.value} out of plausible range [${lo}, ${hi}]`);
    }
  }
  return event as EngineEvent;
}
