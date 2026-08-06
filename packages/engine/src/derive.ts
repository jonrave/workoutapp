/**
 * Pure derivation helpers shared by the cascade layers. No I/O (I1).
 */
import { CONSTANTS } from './constants';
import type { MarginalAllocation } from './types/decision';
import type { IsoDate } from './types/field';
import type {
  History,
  Pillar,
  Profile,
  RecoveryState,
  TemporaryConstraint,
  TissueChannel,
  UserState,
} from './types/state';

/** Smallest detectable change (I3): deltas at or below this are "no change detected". */
export function sdc(typicalError: number): number {
  return CONSTANTS.SDC_MULTIPLIER * typicalError;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(Date.parse(date) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export function dayOfWeek(date: IsoDate): (typeof DOW)[number] {
  return DOW[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
}

export const HIGH_VELOCITY_CHANNELS: TissueChannel[] = [
  'hamstringHighVelocity',
  'calfAchillesHighVelocity',
  'connectiveHighVelocity',
];

export interface HrvFlagStatus {
  active: boolean;
  deep: boolean;
  threshold: number;
}

/**
 * I5: HRV enters only as the 7d mean vs the 60d baseline. Flag = strictly
 * below baseline − 0.75 SD, sustained ≥3 consecutive days (convention).
 * Deep flag (deload trigger, convention): >1 SD for ≥7 days, corroborated by
 * RHR elevation and soreness, with no active illness.
 */
export function hrvFlagStatus(r: RecoveryState): HrvFlagStatus {
  const threshold = r.hrvBaseline60d.value - CONSTANTS.HRV_FLAG_SD * r.hrvBaselineSD.value;
  const below = r.hrv7d.value < threshold;
  const active = below && r.hrvDaysBelowThreshold >= CONSTANTS.HRV_FLAG_SUSTAINED_DAYS;
  const deepLine = r.hrvBaseline60d.value - CONSTANTS.HRV_DEEP_FLAG_SD * r.hrvBaselineSD.value;
  const rhrElevated =
    r.rhr7d.value - r.rhrBaseline60d.value >= CONSTANTS.HRV_DEEP_FLAG_RHR_DELTA;
  const deep =
    active &&
    r.hrv7d.value < deepLine &&
    r.hrvDaysBelowThreshold >= CONSTANTS.HRV_DEEP_FLAG_DAYS &&
    rhrElevated &&
    r.subjectiveSoreness.value >= CONSTANTS.HRV_DEEP_FLAG_SORENESS &&
    !activeSystemicIllness(r) &&
    r.illnessFlags.every((f) => f.resolved !== null);
  return { active, deep, threshold };
}

export function activeSystemicIllness(r: RecoveryState): boolean {
  return r.illnessFlags.some((f) => f.systemic && f.resolved === null);
}

export interface IllnessRamp {
  stage: 'easy-aerobic-only' | 'reduced-strength';
  illnessDurationDays: number;
  daysSinceResolved: number;
  noIntervals: boolean;
}

/** §6 post-illness ramp; total length scales with illness duration. */
export function illnessRamp(r: RecoveryState, date: IsoDate): IllnessRamp | null {
  const resolved = r.illnessFlags
    .filter((f) => f.systemic && f.resolved !== null)
    .sort((a, b) => (a.resolved! < b.resolved! ? 1 : -1))[0];
  if (!resolved) return null;
  const illnessDurationDays = daysBetween(resolved.onset, resolved.resolved!);
  const daysSinceResolved = daysBetween(resolved.resolved!, date);
  const rampTotal = Math.max(7, illnessDurationDays);
  if (daysSinceResolved < 0 || daysSinceResolved > rampTotal) return null;
  return {
    stage:
      daysSinceResolved <= CONSTANTS.POST_ILLNESS_EASY_DAYS
        ? 'easy-aerobic-only'
        : 'reduced-strength',
    illnessDurationDays,
    daysSinceResolved,
    noIntervals: daysSinceResolved <= CONSTANTS.POST_ILLNESS_NO_INTERVAL_DAYS,
  };
}

export interface InterruptionRamp {
  week: number;
  interruptionDays: number;
  /** ≥2-week gap: connective tissue is the rate limiter; high-velocity ramps last (§6). */
  connectiveLimited: boolean;
  noIntervals: boolean;
  noPlyo: boolean;
}

/** §6 per-pillar return ramp after an interruption of INTERRUPTION_RAMP_MIN_DAYS or more. */
export function interruptionRamp(history: History, date: IsoDate): InterruptionRamp | null {
  const last = history.interruptions[history.interruptions.length - 1];
  if (!last || last.durationDays < CONSTANTS.INTERRUPTION_RAMP_MIN_DAYS) return null;
  const end = addDays(last.startDate, last.durationDays);
  const daysSinceEnd = daysBetween(end, date);
  if (daysSinceEnd < 0 || daysSinceEnd > 28) return null;
  const week = Math.floor(daysSinceEnd / 7) + 1;
  const connectiveLimited = last.durationDays >= CONSTANTS.INTERRUPTION_CONNECTIVE_DAYS;
  return {
    week,
    interruptionDays: last.durationDays,
    connectiveLimited,
    noIntervals: week <= 1,
    noPlyo: connectiveLimited && week < CONSTANTS.INTERRUPTION_PLYO_WEEK,
  };
}

/** The temporary constraint active on `date`, if any (declared facts; SDC-exempt). */
export function activeConstraint(profile: Profile, date: IsoDate): TemporaryConstraint | null {
  return (
    profile.temporaryConstraints.find((c) => c.startDate <= date && date <= c.endDate) ?? null
  );
}

/** A declared constraint starting soon (forward planning, Layer 5). */
export function upcomingConstraint(profile: Profile, date: IsoDate): TemporaryConstraint | null {
  return (
    profile.temporaryConstraints.find(
      (c) =>
        c.startDate > date && daysBetween(date, c.startDate) <= CONSTANTS.FORWARD_PLAN_HORIZON_DAYS,
    ) ?? null
  );
}

/** Weekly budget in effect on `date` (I7 note: budget is a scheduling input; ranking is by cost). */
export function effectiveWeeklyBudget(profile: Profile, date: IsoDate): number {
  const c = activeConstraint(profile, date);
  if (c?.weeklyBudgetMinutes !== undefined) return c.weeklyBudgetMinutes;
  if (c?.dailyMinutesCap !== undefined) return c.dailyMinutesCap * 7;
  return profile.weeklyBudgetMinutes;
}

/** Session descriptions matching this carry plyometric / max-velocity elements. */
export const PLYO_MARKER = /(primer|jump|pogo|plyo|throw|sprint|stride)/i;

/**
 * Tissue channels a pillar's typical sessions load — used for the Layer 4
 * injury-hazard bump and for excluding gated pillars from free-day
 * suggestions. Convention, coarse by design.
 */
export const PILLAR_CHANNELS: Record<Pillar, TissueChannel[]> = {
  maxStrength: ['axialCompression', 'kneeExtensor', 'hipExtensor', 'upperPush', 'upperPull'],
  vo2max: ['calfAchillesHighVelocity', 'kneeExtensor', 'hipExtensor'],
  zone2: ['calfAchillesHighVelocity', 'kneeExtensor', 'hipExtensor'],
  power: ['connectiveHighVelocity', 'hamstringHighVelocity', 'calfAchillesHighVelocity'],
  mobility: [],
};

export interface PlanFloorAudit {
  /** Pillars whose §4 maintenance floor the standing plan does not structurally carry. */
  deficits: Pillar[];
  /** Weekly session count the plan carries per pillar (power counts plyo/primer exposures too). */
  sessionsByPillar: Record<Pillar, number>;
  /** vo2max sessions prescribed on a modality outside `vo2CapableModalities` (I9 violations). */
  i9Violations: Array<{ slot: string; modality: string }>;
}

/**
 * Layer 3 structural check: does the standing plan carry every pillar's
 * minimum effective dose? Losing a pillar costs far more than gaining one is
 * worth (§4), so a plan that structurally drops a floor is flagged loudly —
 * independent of budget. Also audits I9 on the plan itself.
 */
export function planFloorAudit(state: UserState): PlanFloorAudit {
  const sessionsByPillar: Record<Pillar, number> = {
    maxStrength: 0,
    vo2max: 0,
    zone2: 0,
    power: 0,
    mobility: 0,
  };
  const i9Violations: Array<{ slot: string; modality: string }> = [];
  for (const s of state.standingPlan.weekStructure) {
    sessionsByPillar[s.pillar] += 1;
    // Power exposures ride inside other sessions as primers (§4 floor table).
    if (s.pillar !== 'power' && PLYO_MARKER.test(s.description)) {
      sessionsByPillar.power += 1;
    }
    if (s.pillar === 'vo2max' && !state.profile.vo2CapableModalities.includes(s.modality)) {
      i9Violations.push({ slot: s.slot, modality: s.modality });
    }
  }
  const deficits = (Object.keys(sessionsByPillar) as Pillar[]).filter(
    (p) => sessionsByPillar[p] < (CONSTANTS.FLOOR_SESSIONS[p] ?? 0),
  );
  return { deficits, sessionsByPillar, i9Violations };
}

/** True when any recorded injury on the pillar's channels has recurred. */
function recurrentInjuryOnChannels(state: UserState, pillar: Pillar): boolean {
  const channels = PILLAR_CHANNELS[pillar];
  return state.history.injuries.some(
    (inj) => inj.recurrenceCount >= 1 && channels.includes(inj.site as TissueChannel),
  );
}

/**
 * §4 Layer 4: the two-term chain rule plus a hazard penalty, per pillar.
 *
 * marginalValue = healthSlopeAtCurrentPosition × estimatedResponseRate × (1 − injuryHazardDelta)
 *
 * The response term comes from the user's own §7 estimate when identifiable
 * and from the population prior otherwise — every row carries its `basis` so
 * the UI can say which numbers are this user's data and which are placeholders
 * (§11). A population-prior row may never drive a reallocation (I8).
 */
export function marginalRanking(state: UserState): MarginalAllocation[] {
  const pillars = Object.keys(PILLAR_CHANNELS) as Pillar[];
  const rows = pillars.map((pillar): MarginalAllocation => {
    const t = state.trainability[pillar];
    const estimated = t.state === 'estimated';
    const response = estimated
      ? Math.max(t.mean, 0)
      : CONSTANTS.TRAINABILITY_PRIOR_RESPONSE[pillar] ?? 0;
    let hazard = CONSTANTS.INJURY_HAZARD_DELTA_PRIOR[pillar] ?? 0;
    if (recurrentInjuryOnChannels(state, pillar)) {
      hazard = Math.min(0.9, hazard + CONSTANTS.INJURY_HAZARD_RECURRENCE_BUMP);
    }
    const slope = CONSTANTS.HEALTH_SLOPE_PRIOR[pillar] ?? 0;
    return {
      pillar,
      marginalValue: Math.round(slope * response * (1 - hazard) * 1000) / 1000,
      deltaShareOfBudget: 0,
      basis: estimated ? 'estimated' : 'population-prior',
    };
  });
  return rows.sort((a, b) => b.marginalValue - a.marginalValue);
}

/** Highest acute:chronic ratio across pillars — §6: soft caution only, never a hard block. */
export function acwrCaution(state: UserState): { pillar: string; ratio: number } | null {
  let worst: { pillar: string; ratio: number } | null = null;
  for (const pillar of Object.keys(state.load.acute) as (keyof typeof state.load.acute)[]) {
    const chronic = state.load.chronic[pillar];
    if (chronic <= 0) continue;
    const ratio = state.load.acute[pillar] / chronic;
    if (ratio >= CONSTANTS.ACWR_CAUTION_RATIO && (!worst || ratio > worst.ratio)) {
      worst = { pillar, ratio: Math.round(ratio * 100) / 100 };
    }
  }
  return worst;
}
