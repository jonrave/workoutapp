/**
 * Human-readable labels for the engine's internal identifiers. Pure lookup
 * tables — the deterministic rendering of a structured Decision that I2
 * permits without an LLM. Every function falls back to the raw identifier so
 * an unmapped code degrades to today's behavior, never to a blank.
 */
import type { RationaleCode } from '@peakspan/engine';

export const METRIC_LABELS: Record<string, string> = {
  vo2max: 'VO₂max',
  lt1Pace: 'LT1 pace',
  maxStrength: 'Max strength',
  peakPower: 'Peak power',
  cmjHeight: 'CMJ height',
  rsi: 'Reactive strength index',
  almi: 'Lean mass index (ALMI)',
  fmi: 'Fat mass index (FMI)',
  vat: 'Visceral fat (VAT)',
  romAsymmetry: 'ROM asymmetry',
};

export const LEVER_LABELS: Record<string, string> = {
  homeSBP7d: 'Blood pressure — systolic (7-day home mean)',
  homeDBP7d: 'Blood pressure — diastolic (7-day home mean)',
  apoB: 'ApoB',
  lpa: 'Lp(a)',
  hba1c: 'HbA1c',
  fastingInsulin: 'Fasting insulin',
  alcoholUnits7d: 'Alcohol (7-day units)',
  alcoholUnits: 'Alcohol (units)',
  waistCm: 'Waist circumference',
};

/** Layer-2 surface names (LeverSurface.lever). */
export const SURFACE_LABELS: Record<string, string> = {
  bloodPressure: 'Blood pressure',
  apoB: 'ApoB',
  lpaNeverMeasured: 'Lp(a) — never measured',
  sleepDuration: 'Sleep duration',
  sleepTimingVariance: 'Sleep timing variance',
  alcohol: 'Alcohol',
  centralAdiposity: 'Central adiposity',
  metabolic: 'Metabolic markers',
  staleness: 'Stale measurements',
};

export const TISSUE_LABELS: Record<string, string> = {
  axialCompression: 'Spine / axial compression',
  kneeExtensor: 'Knee extensors (quads)',
  hipExtensor: 'Hip extensors (glutes)',
  hamstringHighVelocity: 'Hamstrings (high velocity)',
  calfAchillesHighVelocity: 'Calf / Achilles (high velocity)',
  upperPush: 'Upper-body push',
  upperPull: 'Upper-body pull',
  shoulderOverhead: 'Shoulder overhead',
  connectiveHighVelocity: 'Connective tissue (high velocity)',
};

export const PILLAR_LABELS: Record<string, string> = {
  maxStrength: 'Max strength',
  vo2max: 'VO₂max',
  zone2: 'Zone 2 / aerobic base',
  power: 'Power',
  mobility: 'Mobility',
};

export const MODALITY_LABELS: Record<string, string> = {
  run: 'Run',
  airBike: 'Air bike',
  spinBike: 'Spin bike',
  row: 'Row',
  swim: 'Swim',
  hike: 'Hike',
  lift: 'Lift',
  other: 'Other',
};

export const SOURCE_LABELS: Record<string, string> = {
  'measured-lab': 'lab test',
  'measured-field': 'field test',
  'user-reported': 'self-reported',
  'device-derived': 'device',
};

export const GATE_LABELS: Record<string, string> = {
  'systemic-illness': 'Illness — no training',
  'pain-block': 'Pain — pattern blocked',
  'plyometric-block': 'Plyometrics blocked',
  'sleep-load-cap': 'Sleep — load capped',
  'post-illness-ramp': 'Post-illness ramp',
  'interruption-ramp': 'Return ramp',
  'unplanned-activity-suppression': 'Hard unplanned activity — next-day suppression',
  'tissue-caution': 'Tissue caution',
  deload: 'Deload week',
};

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export function metricLabel(id: string): string {
  return METRIC_LABELS[id] ?? id;
}

export function leverLabel(id: string): string {
  return LEVER_LABELS[id] ?? id;
}

export function surfaceLabel(id: string): string {
  return SURFACE_LABELS[id] ?? id;
}

export function tissueLabel(id: string): string {
  return TISSUE_LABELS[id] ?? id;
}

export function pillarLabel(id: string): string {
  return PILLAR_LABELS[id] ?? id;
}

export function modalityLabel(id: string): string {
  return MODALITY_LABELS[id] ?? id;
}

export function sourceLabel(id: string): string {
  return SOURCE_LABELS[id] ?? id;
}

export function gateLabel(id: string): string {
  return GATE_LABELS[id] ?? id;
}

/** "thu-evening" → "Thursday evening". */
export function slotLabel(slot: string): string {
  const [day, time] = slot.split('-');
  if (!day || !time) return slot;
  return `${DAY_LABELS[day] ?? day} ${time}`;
}

/**
 * One sentence per rationale code. The code vocabulary is fixed alongside the
 * engine; unmapped codes render as the raw code so nothing is hidden.
 */
const RATIONALE_TEXT: Record<string, string> = {
  'standing-plan-unchanged':
    'Every tracked signal is inside its smallest detectable change — the standing plan holds.',
  'medical-stop-seek-care': 'A medical red flag is active: stop training and seek care.',
  'systemic-illness-active': 'Systemic illness symptoms are active — no training today.',
  'illness-monitor': 'Recent illness is being monitored.',
  'post-illness-ramp': 'The post-illness return ramp is governing today’s output.',
  'interruption-ramp': 'The per-pillar return ramp after an interruption is governing today’s output.',
  'pain-above-threshold':
    'Reported pain is above 3/10 or alters movement — the implicated pattern is blocked and an alternative substituted.',
  'sleep-under-6h': 'Sleep was under 6 hours last night — plyometric and max-velocity work is blocked.',
  'sleep-under-7h': 'The 7-day sleep mean is under 7 hours — training load increases are blocked.',
  'sleep-load-cap': 'Sleep is short — no increase in training load until it recovers.',
  'hrv-flag-active':
    'The 7-day HRV mean is sustained below your personal baseline — high-velocity work is gated.',
  'deep-hrv-flag-deload':
    'A deep, sustained HRV flag corroborated by resting HR and soreness — intervals become Zone 2 this week.',
  'post-exposure-tissue-window':
    'Within the tissue-specific window after a lower-limb strain — high-velocity work on that channel is blocked.',
  'tissue-caution':
    'Sub-threshold pain on a high-velocity channel with recurrence history — its plyo/sprint work is deferred until 48h pain-free.',
  'hard-unplanned-yesterday':
    'Yesterday’s hard unplanned activity suppresses today’s lower-body load and plyometrics.',
  'acwr-soft-caution':
    'Acute load is high relative to chronic load — a soft caution only; it never hard-blocks.',
  'sbp-flag': 'Home blood pressure (7-day mean) is at or above 130 systolic — the highest-value non-emergent action available.',
  'apob-flag': 'ApoB is above its flag line — worth a pharmacologic discussion (lifetime cumulative exposure).',
  'lpa-never-measured': 'Lp(a) has never been measured — one isoform-independent assay, once per lifetime.',
  'sleep-midpoint-variance': 'Sleep timing varies by more than an hour (14-day SD) — stabilizing it is cheap and neglected.',
  'alcohol-over-threshold': 'Alcohol in the last 7 days is above your set threshold.',
  'waist-flag': 'Waist circumference is above its flag line — energy-balance lane, not a training reallocation.',
  'metabolic-out-of-range': 'A metabolic marker (HbA1c / fasting insulin) is out of range — re-test with your next panel.',
  'lever-stale': 'A lever measurement is past its refresh cadence — re-measure it.',
  'lever-unaddressed-escalation': 'A flagged lever remains unaddressed — surfacing it again, prominently.',
  'floors-only-budget': 'This week’s budget covers only the pillar maintenance floors.',
  'floors-only-compression': 'The plan is compressed to maintenance floors.',
  'forward-plan-constraint': 'A declared upcoming constraint is shaping this week’s plan.',
  'declared-constraint-restructure': 'The week is restructured around a declared constraint (travel, work crunch).',
  'trainability-not-yet-identifiable':
    'Your individual response rate is not yet identifiable — more block data is needed before reallocating toward it.',
  'tissue-recency-adjustment': 'Session choice adjusted for tissue recency — recently loaded channels get more recovery.',
  'block-interrupted': 'The active block was interrupted — its retest cannot be evaluated as a block outcome.',
};

/** Compact "key value" rendering of a code's parameters. */
function paramsText(params?: RationaleCode['params']): string {
  if (!params) return '';
  const parts = Object.entries(params).map(([k, v]) => `${k} ${v}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function rationaleText(r: RationaleCode): string {
  const text = RATIONALE_TEXT[r.code];
  return text ? `${text}${paramsText(r.params)}` : `${r.code}${paramsText(r.params)}`;
}

export const RETEST_VERDICT_LABELS: Record<string, string> = {
  success: 'Success — threshold cleared',
  'threshold-not-met': 'Threshold not met',
  'no-change-detected': 'No change detected',
  'indeterminate-sub-sdc': 'Indeterminate — inside the noise band',
  'refused-no-preregistration': 'Refused — no pre-registered threshold',
  'block-interrupted': 'Block interrupted — not evaluable',
};

export function retestVerdictLabel(id: string): string {
  return RETEST_VERDICT_LABELS[id] ?? id;
}
