/**
 * Pure derivation helpers shared by the cascade layers. No I/O (I1).
 */
import { CONSTANTS } from './constants';
import type { IsoDate } from './types/field';
import type {
  History,
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
