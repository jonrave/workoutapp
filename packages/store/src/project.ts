/**
 * State projector (contract Step 5): `UserState` is recomputed from the
 * append-only event log. `seed` supplies declared and prior state (profile,
 * standing plan, trainability priors, intake baselines); events overlay and
 * re-derive everything measured or rolling. Same seed + same log ⇒ identical
 * state, byte for byte.
 *
 * All rolling-statistic constants here are conventions (§11); window choices
 * follow the contract's §3 definitions (7d/28d EWMA, 60d baselines, 14d
 * midpoint SD).
 */
import { CONSTANTS, daysBetween, addDays } from '@peakspan/engine';
import type {
  ActivityEvent,
  EngineEvent,
  Field,
  FitnessMetric,
  IsoDate,
  Pillar,
  Slot,
  StrengthPattern,
  TissueChannel,
  UserState,
} from '@peakspan/engine';

const PILLARS: Pillar[] = ['maxStrength', 'vo2max', 'zone2', 'power', 'mobility'];
const CHANNELS: TissueChannel[] = [
  'axialCompression',
  'kneeExtensor',
  'hipExtensor',
  'hamstringHighVelocity',
  'calfAchillesHighVelocity',
  'upperPush',
  'upperPull',
  'shoulderOverhead',
  'connectiveHighVelocity',
];

/** convention: sleep need used for the rolling debt figure (hours). */
const SLEEP_NEED_HOURS = 7.5;
/** convention: EWMA smoothing per contract §3 windows. */
const ACUTE_ALPHA = 2 / (7 + 1);
const CHRONIC_ALPHA = 2 / (28 + 1);

const day = (iso: string): IsoDate => iso.slice(0, 10);

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Daily series of a raw recovery signal over the window ending at `today` (inclusive). */
function signalSeries(
  events: EngineEvent[],
  signal: string,
  today: IsoDate,
  windowDays: number,
): Array<{ date: IsoDate; value: number }> {
  const from = addDays(today, -(windowDays - 1));
  const byDay = new Map<IsoDate, number>();
  for (const e of events) {
    if (e.type !== 'recovery-signal' || e.signal !== signal) continue;
    const d = day(e.occurredAt);
    if (d >= from && d <= today) byDay.set(d, e.value); // last reading of a day wins
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

function rolling7dMean(
  events: EngineEvent[],
  signal: string,
  endDay: IsoDate,
): number | undefined {
  const series = signalSeries(events, signal, endDay, 7);
  return series.length ? mean(series.map((s) => s.value)) : undefined;
}

export function projectState(seed: UserState, events: EngineEvent[], today: IsoDate): UserState {
  const state: UserState = structuredClone(seed);
  const ordered = [...events].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));

  const seedFitness = structuredClone(seed.fitness);
  projectRecovery(state, ordered, today);
  projectLoadAndTissue(state, ordered, today);
  projectFitness(state, ordered);
  projectLevers(state, ordered, today);
  projectHistory(state, ordered, today);
  projectBlock(state, seedFitness, ordered, today);
  return state;
}

function field<T>(
  prev: Field<T> | null,
  value: T,
  lastUpdated: IsoDate,
  source: Field<T>['source'],
): Field<T> {
  const next: Field<T> = { ...prev, value, lastUpdated, source };
  return next;
}

function projectRecovery(state: UserState, events: EngineEvent[], today: IsoDate): void {
  const r = state.recovery;

  const hrv60 = signalSeries(events, 'hrvLnRmssd', today, 60);
  if (hrv60.length >= 7) {
    const values = hrv60.map((s) => s.value);
    r.hrvBaseline60d = field(r.hrvBaseline60d, round(mean(values), 3), today, 'derived');
    r.hrvBaselineSD = field(r.hrvBaselineSD, round(sd(values), 3), today, 'derived');
    const hrv7 = rolling7dMean(events, 'hrvLnRmssd', today)!;
    r.hrv7d = field(r.hrv7d, round(hrv7, 3), today, 'device-raw');

    // Consecutive days (ending today) with the rolling 7d mean strictly below
    // baseline − 0.75 SD (I5; sustained-days convention).
    const threshold =
      r.hrvBaseline60d.value - CONSTANTS.HRV_FLAG_SD * r.hrvBaselineSD.value;
    let run = 0;
    for (let back = 0; back < 30; back++) {
      const m = rolling7dMean(events, 'hrvLnRmssd', addDays(today, -back));
      if (m !== undefined && m < threshold) run++;
      else break;
    }
    r.hrvDaysBelowThreshold = run;
  }

  const rhr60 = signalSeries(events, 'restingHr', today, 60);
  if (rhr60.length >= 7) {
    r.rhrBaseline60d = field(r.rhrBaseline60d, round(mean(rhr60.map((s) => s.value)), 1), today, 'derived');
    r.rhr7d = field(r.rhr7d, round(rolling7dMean(events, 'restingHr', today)!, 1), today, 'device-raw');
  }

  const sleep7 = signalSeries(events, 'sleepDurationHours', today, 7);
  if (sleep7.length > 0) {
    r.sleepMean7d = field(r.sleepMean7d, round(mean(sleep7.map((s) => s.value)), 2), today, 'device-raw');
    const last = sleep7[sleep7.length - 1]!;
    r.sleepPriorNight = field(r.sleepPriorNight, last.value, last.date, 'device-raw');
    r.sleepDebtRolling = field(
      r.sleepDebtRolling,
      round(sleep7.reduce((s, x) => s + Math.max(0, SLEEP_NEED_HOURS - x.value), 0), 1),
      today,
      'derived',
    );
  }
  const midpoint14 = signalSeries(events, 'sleepMidpointClockTime', today, 14);
  if (midpoint14.length >= 5) {
    r.sleepMidpointSD14d = field(r.sleepMidpointSD14d, round(sd(midpoint14.map((s) => s.value)), 0), today, 'derived');
  }

  // Latest subjective report within 3 days drives soreness; pain reports stay
  // active for the 48h tissue-caution window (convention, user-approved).
  const subjectives = events.filter((e) => e.type === 'subjective');
  const recent = subjectives.filter((e) => daysBetween(day(e.occurredAt), today) <= 3);
  const latestSoreness = [...recent].reverse().find((e) => e.soreness !== undefined);
  if (latestSoreness) {
    r.subjectiveSoreness = field(r.subjectiveSoreness, latestSoreness.soreness!, day(latestSoreness.occurredAt), 'user-reported');
  }
  const painReports = subjectives.filter(
    (e) => e.pain !== undefined && daysBetween(day(e.occurredAt), today) <= 2,
  );
  if (painReports.length > 0 || subjectives.length > 0) {
    state.recovery.activePain = painReports.map((e) => ({
      site: e.pain!.site,
      score0to10: e.pain!.score,
      altersMovement: e.altersMovement ?? false,
      reportedAt: day(e.occurredAt),
    }));
  }

  // Illness flags from onset/resolved event pairs.
  const illnessEvents = events.filter((e) => e.type === 'illness');
  if (illnessEvents.length > 0) {
    const flags: UserState['recovery']['illnessFlags'] = [];
    for (const e of illnessEvents) {
      if (e.phase === 'onset') {
        flags.push({ onset: day(e.occurredAt), systemic: e.systemic, symptoms: e.symptoms, resolved: null });
      } else {
        const open = [...flags].reverse().find((f) => f.resolved === null);
        if (open) {
          if (e.phase === 'resolved') open.resolved = day(e.occurredAt);
          else open.systemic = open.systemic || e.systemic;
        }
      }
    }
    r.illnessFlags = flags;
  }
}

function projectLoadAndTissue(state: UserState, events: EngineEvent[], today: IsoDate): void {
  const activities = events.filter((e): e is ActivityEvent => e.type === 'activity');
  if (activities.length === 0) return;

  // Daily sRPE-minute totals per pillar, then a daily EWMA scaled to weekly units (§3).
  const firstDay = day(activities[0]!.occurredAt);
  const acute: Record<Pillar, number> = { ...state.load.acute };
  const chronic: Record<Pillar, number> = { ...state.load.chronic };
  const dailyEwmaAcute: Record<Pillar, number> = Object.fromEntries(
    PILLARS.map((p) => [p, state.load.acute[p] / 7]),
  ) as Record<Pillar, number>;
  const dailyEwmaChronic: Record<Pillar, number> = Object.fromEntries(
    PILLARS.map((p) => [p, state.load.chronic[p] / 7]),
  ) as Record<Pillar, number>;

  for (let d = firstDay; d <= today; d = addDays(d, 1)) {
    const dayLoad: Record<Pillar, number> = Object.fromEntries(PILLARS.map((p) => [p, 0])) as Record<
      Pillar,
      number
    >;
    for (const a of activities.filter((x) => day(x.occurredAt) === d)) {
      for (const p of PILLARS) dayLoad[p] += a.pillarLoad[p] ?? 0;
    }
    for (const p of PILLARS) {
      dailyEwmaAcute[p] = ACUTE_ALPHA * dayLoad[p] + (1 - ACUTE_ALPHA) * dailyEwmaAcute[p];
      dailyEwmaChronic[p] = CHRONIC_ALPHA * dayLoad[p] + (1 - CHRONIC_ALPHA) * dailyEwmaChronic[p];
    }
  }
  for (const p of PILLARS) {
    acute[p] = round(dailyEwmaAcute[p] * 7, 0);
    chronic[p] = round(dailyEwmaChronic[p] * 7, 0);
  }
  state.load.acute = acute;
  state.load.chronic = chronic;

  // Tissue recency + accumulated 7-day load per channel.
  for (const c of CHANNELS) {
    const touching = activities.filter((a) => (a.tissueLoad[c] ?? 0) > 0);
    if (touching.length === 0) continue;
    const lastTouch = day(touching[touching.length - 1]!.occurredAt);
    state.tissue[c] = {
      daysSinceLastExposure: daysBetween(lastTouch, today),
      recentLoad: round(
        touching
          .filter((a) => daysBetween(day(a.occurredAt), today) <= 7)
          .reduce((s, a) => s + (a.tissueLoad[c] ?? 0), 0),
        0,
      ),
    };
  }

  // Most recent unplanned activity, classified into tissue channels (§6).
  const unplanned = activities.filter((a) => !a.planned);
  if (unplanned.length > 0) {
    const last = unplanned[unplanned.length - 1]!;
    state.load.lastUnplannedActivity = {
      date: day(last.occurredAt),
      sRPE: last.sRPE,
      tissueChannels: (Object.keys(last.tissueLoad) as TissueChannel[]).filter(
        (c) => (last.tissueLoad[c] ?? 0) > 0,
      ),
    };
  }
}

function projectFitness(state: UserState, events: EngineEvent[]): void {
  for (const e of events) {
    if (e.type !== 'fitness-measurement' && e.type !== 'retest') continue;
    const metric: FitnessMetric = e.metric;
    const when = day(e.occurredAt);
    const source = e.source as Field<number>['source'];
    if (metric === 'maxStrength') {
      const pattern: StrengthPattern | undefined = e.type === 'fitness-measurement' ? e.pattern : undefined;
      if (!pattern) continue;
      const prev = state.fitness.maxStrength[pattern];
      state.fitness.maxStrength[pattern] = {
        ...field(prev, e.value, when, source),
        ...(e.typicalError !== undefined ? { typicalError: e.typicalError } : {}),
      };
    } else {
      const prev = state.fitness[metric];
      state.fitness[metric] = {
        ...field(prev, e.value, when, source),
        ...(e.typicalError !== undefined ? { typicalError: e.typicalError } : {}),
      };
    }
  }
}

const LEVER_UNIT_MAP: Record<string, keyof UserState['levers']> = {
  homeSBP7d: 'homeSBP7d',
  homeDBP7d: 'homeDBP7d',
  apoB: 'apoB',
  lpa: 'lpa',
  hba1c: 'hba1c',
  fastingInsulin: 'fastingInsulin',
  waistCm: 'waistCm',
};

function projectLevers(state: UserState, events: EngineEvent[], today: IsoDate): void {
  let alcohol7d = 0;
  let sawAlcohol = false;
  for (const e of events) {
    if (e.type !== 'lever-measurement') continue;
    const when = day(e.occurredAt);
    if (e.lever === 'alcoholUnits') {
      sawAlcohol = true;
      if (daysBetween(when, today) <= 7) alcohol7d += e.value;
      continue;
    }
    const key = LEVER_UNIT_MAP[e.lever];
    if (!key) continue;
    const source = e.source as Field<number>['source'];
    if (key === 'lpa') {
      state.levers.lpa = {
        value: e.value,
        lastUpdated: when,
        source,
        ...(e.typicalError !== undefined ? { typicalError: e.typicalError } : {}),
      };
    } else if (key !== 'alcoholThreshold7d' && key !== 'alcoholUnits7d') {
      const prev = state.levers[key] as Field<number>;
      (state.levers[key] as Field<number>) = {
        ...field(prev, e.value, when, source),
        ...(e.typicalError !== undefined ? { typicalError: e.typicalError } : {}),
      };
    }
  }
  if (sawAlcohol) {
    state.levers.alcoholUnits7d = field(state.levers.alcoholUnits7d, round(alcohol7d, 1), today, 'user-reported');
  }
}

function projectHistory(state: UserState, events: EngineEvent[], today: IsoDate): void {
  const injuries = events.filter((e) => e.type === 'injury');
  for (const e of injuries) {
    const recurrenceCount = e.recurrenceOf
      ? (state.history.injuries.find((i) => i.site === e.site)?.recurrenceCount ?? 0) + 1
      : 0;
    state.history.injuries.push({
      site: e.site,
      date: day(e.occurredAt),
      severity: e.severity,
      recurrenceCount,
      resolved: e.resolved,
      ...(e.note !== undefined ? { note: e.note } : {}),
    });
  }

  for (const e of events) {
    if (e.type !== 'interruption') continue;
    const end = e.endDate ?? today;
    state.history.interruptions.push({
      startDate: e.startDate,
      cause: e.cause,
      durationDays: daysBetween(e.startDate, end),
    });
  }

  // Learned adherence: completion rate per slot from activity vs missed events.
  const done = new Map<Slot, number>();
  const missed = new Map<Slot, number>();
  for (const e of events) {
    if (e.type === 'activity' && e.planned && e.plannedSlot) {
      done.set(e.plannedSlot, (done.get(e.plannedSlot) ?? 0) + 1);
    }
    if (e.type === 'missed-session') {
      missed.set(e.plannedSlot, (missed.get(e.plannedSlot) ?? 0) + 1);
    }
  }
  for (const slot of new Set([...done.keys(), ...missed.keys()])) {
    const d = done.get(slot) ?? 0;
    const m = missed.get(slot) ?? 0;
    state.history.adherenceBySlot[slot] = round(d / (d + m), 2);
  }
}

function projectBlock(
  state: UserState,
  seedFitness: UserState['fitness'],
  events: EngineEvent[],
  today: IsoDate,
): void {
  const starts = events.filter((e) => e.type === 'block-start');
  const lastStart = starts[starts.length - 1];
  if (lastStart) {
    const metric = lastStart.metricUnderTest;
    // Baseline is the metric's value AT block start: the seed value overlaid
    // with measurements taken before registration — never the retest itself.
    const preStart = events.filter(
      (e) =>
        e.type === 'fitness-measurement' &&
        e.metric === metric &&
        e.occurredAt <= lastStart.occurredAt,
    );
    const lastPreStart = preStart[preStart.length - 1];
    // Baseline resolution order: last pre-start measurement, then the value
    // recorded on the block-start event itself (what the threshold was
    // validated against), then the seed. Registration is refused upstream
    // when no baseline exists at all, so the final fallback is unreachable
    // for events written by the adapters.
    const seedMaxStrengthValues = Object.values(seedFitness.maxStrength)
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .map((f) => f.value);
    const baselineAtStart =
      lastPreStart && lastPreStart.type === 'fitness-measurement' && metric !== 'maxStrength'
        ? lastPreStart.value
        : lastStart.baselineValue !== undefined
          ? lastStart.baselineValue
          : metric === 'maxStrength'
            ? mean(seedMaxStrengthValues.length > 0 ? seedMaxStrengthValues : [0])
            : seedFitness[metric]?.value ?? 0;
    state.block = {
      activePillar: lastStart.pillar,
      startDate: day(lastStart.occurredAt),
      plannedWeeks: lastStart.plannedWeeks,
      preRegisteredThreshold: lastStart.preRegisteredThreshold,
      metricUnderTest: metric,
      baselineAtStart: round(baselineAtStart, 2),
      status: 'active',
      pendingRetest: null,
    };
  }
  if (!state.block) return;

  // An interruption of ramp length overlapping the block marks it interrupted.
  const blockStart = state.block.startDate;
  const interrupted = state.history.interruptions.some(
    (i) =>
      i.durationDays >= CONSTANTS.INTERRUPTION_RAMP_MIN_DAYS &&
      addDays(i.startDate, i.durationDays) >= blockStart &&
      i.startDate <= today,
  );
  if (interrupted && daysBetween(blockStart, today) >= 0) {
    const overlapsBlock = state.history.interruptions.some(
      (i) => i.durationDays >= CONSTANTS.INTERRUPTION_RAMP_MIN_DAYS && i.startDate >= blockStart,
    );
    if (overlapsBlock) state.block.status = 'interrupted';
  }

  const blockId = lastStart?.id;
  const retests = events.filter(
    (e) => e.type === 'retest' && (blockId === undefined || e.blockId === blockId),
  );
  const lastRetest = retests[retests.length - 1];
  if (lastRetest && lastRetest.type === 'retest' && day(lastRetest.occurredAt) >= blockStart) {
    state.block.pendingRetest = {
      value: lastRetest.value,
      unit: lastRetest.unit,
      ...(lastRetest.typicalError !== undefined ? { typicalError: lastRetest.typicalError } : {}),
      measuredAt: day(lastRetest.occurredAt),
    };
  }
}
