/**
 * The section 4 decision cascade, one exported pure function per layer so each
 * is independently testable (§10 Step 3). Strict order is composed in
 * decide.ts; the first layer that fires determines the shape of the output.
 */
import { CONSTANTS } from './constants';
import {
  acwrCaution,
  activeConstraint,
  activeSystemicIllness,
  daysBetween,
  dayOfWeek,
  effectiveWeeklyBudget,
  HIGH_VELOCITY_CHANNELS,
  hrvFlagStatus,
  illnessRamp,
  interruptionRamp,
  marginalRanking,
  PILLAR_CHANNELS,
  planFloorAudit,
  PLYO_MARKER,
  sdc,
  upcomingConstraint,
} from './derive';
import type {
  GateResult,
  LeverSurface,
  MarginalAllocation,
  MedicalStop,
  RationaleCode,
  RetestEvaluation,
  SessionPrescription,
} from './types/decision';
import type { IsoDate } from './types/field';
import type {
  Pillar,
  PlannedSession,
  TissueChannel,
  UserState,
} from './types/state';

/* ------------------------------------------------------------------ */
/* Layer 0 — medical red flags                                         */
/* ------------------------------------------------------------------ */

export function layer0Medical(state: UserState): MedicalStop | null {
  if (state.recovery.medicalRedFlags.length === 0) return null;
  return {
    reasons: [...state.recovery.medicalRedFlags],
    instruction: 'stop-training-seek-care',
  };
}

/* ------------------------------------------------------------------ */
/* Layer 1 — injury and illness gate                                   */
/* ------------------------------------------------------------------ */

export interface Layer1Result {
  gates: GateResult[];
  /** Systemic illness: full stop, no training content. */
  fullStop: boolean;
  rationale: RationaleCode[];
}

export function layer1Gates(state: UserState, date: IsoDate): Layer1Result {
  const gates: GateResult[] = [];
  const rationale: RationaleCode[] = [];
  const r = state.recovery;

  // Systemic illness: hard block, no optimization inside this layer.
  if (activeSystemicIllness(r)) {
    gates.push({
      gate: 'systemic-illness',
      blockedChannels: [],
      substitution: null,
      trigger: { code: 'systemic-illness-active' },
    });
    return { gates, fullStop: true, rationale };
  }
  if (r.illnessFlags.some((f) => !f.systemic && f.resolved === null)) {
    rationale.push({ code: 'illness-monitor', params: { systemic: false } });
  }

  // §6 post-illness return ramp.
  const illness = illnessRamp(r, date);
  if (illness) {
    gates.push({
      gate: 'post-illness-ramp',
      blockedChannels: [],
      substitution: null,
      trigger: {
        code: 'post-illness-ramp',
        params: {
          stage: illness.stage,
          illnessDurationDays: illness.illnessDurationDays,
          daysSinceResolved: illness.daysSinceResolved,
        },
      },
    });
  }

  // §6 per-pillar interruption return ramp.
  const interruption = interruptionRamp(state.history, date);
  if (interruption) {
    gates.push({
      gate: 'interruption-ramp',
      blockedChannels: [],
      substitution: null,
      trigger: {
        code: 'interruption-ramp',
        params: {
          week: interruption.week,
          interruptionDays: interruption.interruptionDays,
          connectiveLimited: interruption.connectiveLimited,
        },
      },
    });
  }

  // Pain: >3/10 or altered movement blocks the pattern with substitution;
  // sub-threshold pain on a loaded/recurrent high-velocity channel gets the
  // tissue-caution convention (user-approved 2026-07-28).
  for (const pain of r.activePain) {
    const channel = pain.site as TissueChannel;
    const isKnownChannel = channel in state.tissue;
    if (pain.score0to10 > CONSTANTS.PAIN_BLOCK_THRESHOLD || pain.altersMovement) {
      gates.push({
        gate: 'pain-block',
        blockedChannels: isKnownChannel ? [channel] : [],
        substitution: null, // filled with a concrete swap by Layer 5
        trigger: {
          code: 'pain-above-threshold',
          params: { site: pain.site, score: pain.score0to10, altersMovement: pain.altersMovement },
        },
      });
      continue;
    }
    if (isKnownChannel && HIGH_VELOCITY_CHANNELS.includes(channel)) {
      const recurrent = state.history.injuries.some(
        (inj) => inj.site === channel && inj.recurrenceCount >= 1,
      );
      const loaded =
        state.tissue[channel].recentLoad >= CONSTANTS.TISSUE_CAUTION_RECENT_LOAD;
      if (recurrent || loaded) {
        gates.push({
          gate: 'tissue-caution',
          blockedChannels: [channel],
          substitution: null,
          trigger: {
            code: 'tissue-caution',
            params: {
              site: channel,
              score: pain.score0to10,
              recurrenceHistory: recurrent,
              recentLoad: state.tissue[channel].recentLoad,
            },
          },
        });
      }
    }
  }

  // Hard unplanned activity yesterday: following-day suppression (§6).
  const unplanned = state.load.lastUnplannedActivity;
  const suppressed =
    unplanned !== null &&
    unplanned.sRPE >= CONSTANTS.HARD_UNPLANNED_SRPE &&
    daysBetween(unplanned.date, date) === 1;
  if (suppressed) {
    gates.push({
      gate: 'unplanned-activity-suppression',
      blockedChannels: unplanned.tissueChannels.filter((c) =>
        c !== 'upperPush' && c !== 'upperPull' && c !== 'shoulderOverhead',
      ),
      substitution: null,
      trigger: {
        code: 'hard-unplanned-yesterday',
        params: { sRPE: unplanned.sRPE, date: unplanned.date },
      },
    });
  }

  // Plyometric / max-velocity block (§4 Layer 1): sleep <6h prior night,
  // active HRV flag, tissue window after hard high-velocity exposure, or
  // connective-limited interruption ramp.
  const hrv = hrvFlagStatus(r);
  const plyoTriggers: RationaleCode[] = [];
  let plyoChannels: TissueChannel[] = [];
  if (r.sleepPriorNight.value < CONSTANTS.PLYO_SLEEP_MIN_HOURS) {
    plyoTriggers.push({ code: 'sleep-under-6h', params: { hours: r.sleepPriorNight.value } });
    plyoChannels = HIGH_VELOCITY_CHANNELS;
  }
  if (hrv.active) {
    plyoTriggers.push({
      code: 'hrv-flag-active',
      params: {
        hrv7d: r.hrv7d.value,
        threshold: Math.round(hrv.threshold * 100) / 100,
        sustainedDays: r.hrvDaysBelowThreshold,
      },
    });
    plyoChannels = HIGH_VELOCITY_CHANNELS;
  }
  if (suppressed) {
    const hv = unplanned!.tissueChannels.filter((c) => HIGH_VELOCITY_CHANNELS.includes(c));
    if (hv.length > 0) {
      plyoTriggers.push({ code: 'post-exposure-tissue-window', params: { channels: hv.join(',') } });
      plyoChannels = [...new Set([...plyoChannels, ...hv])];
    }
  }
  if (illness || interruption?.noPlyo) {
    plyoTriggers.push({ code: illness ? 'post-illness-no-plyo' : 'interruption-connective-ramp' });
    plyoChannels = HIGH_VELOCITY_CHANNELS;
  }
  if (plyoTriggers.length > 0) {
    gates.push({
      gate: 'plyometric-block',
      blockedChannels: plyoChannels,
      substitution: null,
      trigger: plyoTriggers[0]!,
    });
    rationale.push(...plyoTriggers);
  }

  // Deep-flag deload (convention, user-approved): intervals become Z2 this week.
  if (hrv.deep) {
    gates.push({
      gate: 'deload',
      blockedChannels: [],
      substitution: null,
      trigger: {
        code: 'deep-hrv-flag-deload',
        params: { hrv7d: r.hrv7d.value, sustainedDays: r.hrvDaysBelowThreshold },
      },
    });
  }

  return { gates, fullStop: false, rationale };
}

/* ------------------------------------------------------------------ */
/* Layer 2 — non-training lever escalation (I6: never touches budget)  */
/* ------------------------------------------------------------------ */

export interface Layer2Result {
  surfaces: LeverSurface[];
  /** §5 sleep lever: any increase in training load is blocked while <7h. */
  sleepLoadCap: GateResult | null;
  rationale: RationaleCode[];
}

export function layer2Levers(state: UserState, date: IsoDate): Layer2Result {
  const surfaces: LeverSurface[] = [];
  const rationale: RationaleCode[] = [];
  const L = state.levers;
  const r = state.recovery;
  let sleepLoadCap: GateResult | null = null;

  const push = (
    lever: LeverSurface['lever'],
    priority: LeverSurface['priority'],
    trigger: RationaleCode,
  ) => surfaces.push({ lever, priority, trainingPlanUnchanged: true, trigger });

  if (L.homeSBP7d !== null && L.homeSBP7d.value >= CONSTANTS.SBP_FLAG) {
    push('bloodPressure', 'highest-non-emergent', {
      code: 'sbp-flag',
      params: { sbp7d: L.homeSBP7d.value },
    });
    if (daysBetween(L.homeSBP7d.lastUpdated, date) >= CONSTANTS.LEVER_ESCALATION_DAYS) {
      rationale.push({
        code: 'lever-unaddressed-escalation',
        params: { lever: 'bloodPressure', daysOutstanding: daysBetween(L.homeSBP7d.lastUpdated, date) },
      });
    }
  }

  if (r.sleepMean7d.value < CONSTANTS.SLEEP_LEVER_HOURS) {
    push('sleepDuration', 'standard', {
      code: 'sleep-under-7h',
      params: { mean7d: r.sleepMean7d.value },
    });
    sleepLoadCap = {
      gate: 'sleep-load-cap',
      blockedChannels: [],
      substitution: null,
      trigger: { code: 'sleep-load-cap', params: { mean7d: r.sleepMean7d.value } },
    };
  }
  if (r.sleepMidpointSD14d.value > CONSTANTS.SLEEP_MIDPOINT_SD_LIMIT_MIN) {
    push('sleepTimingVariance', 'standard', {
      code: 'sleep-midpoint-variance',
      params: { sd14d: r.sleepMidpointSD14d.value },
    });
  }
  if (L.alcoholUnits7d !== null && L.alcoholUnits7d.value > L.alcoholThreshold7d) {
    push('alcohol', 'standard', {
      code: 'alcohol-over-threshold',
      params: { units: L.alcoholUnits7d.value, threshold: L.alcoholThreshold7d },
    });
  }
  if (L.waistCm !== null && L.waistCm.value > CONSTANTS.WAIST_FLAG_CM) {
    push('centralAdiposity', 'standard', { code: 'waist-flag', params: { cm: L.waistCm.value } });
  }
  const lpaHigh = L.lpa !== null && L.lpa.value > CONSTANTS.LPA_HIGH;
  if (
    L.apoB !== null &&
    (L.apoB.value > CONSTANTS.APOB_FLAG ||
      (L.apoB.value > CONSTANTS.APOB_FLAG_WITH_RISK && lpaHigh))
  ) {
    push('apoB', 'standard', { code: 'apob-flag', params: { apoB: L.apoB.value } });
  }
  if (L.lpa === null) {
    push('lpaNeverMeasured', 'standard', { code: 'lpa-never-measured' });
  }
  if (
    (L.hba1c !== null && L.hba1c.value > CONSTANTS.HBA1C_FLAG) ||
    (L.fastingInsulin !== null && L.fastingInsulin.value > CONSTANTS.INSULIN_FLAG)
  ) {
    push('metabolic', 'standard', { code: 'metabolic-out-of-range' });
  }

  // Staleness prompting (§5): lastUpdated past its cadence.
  const staleness: Array<[string, string]> = [];
  for (const [field, cadence] of Object.entries(CONSTANTS.STALENESS_DAYS)) {
    const f = (L as unknown as Record<string, { lastUpdated?: string } | null>)[field];
    if (f?.lastUpdated && daysBetween(f.lastUpdated, date) > cadence) {
      staleness.push([field, f.lastUpdated]);
    }
  }
  if (staleness.length > 0) {
    push('staleness', 'standard', {
      code: 'lever-stale',
      params: { fields: staleness.map(([f]) => f).join(',') },
    });
  }

  return { surfaces, sleepLoadCap, rationale };
}

/* ------------------------------------------------------------------ */
/* Layer 3 — pillar floors                                             */
/* ------------------------------------------------------------------ */

export interface Layer3Result {
  floorsOnly: boolean;
  budget: number;
  /** Pillars whose floor the standing plan does not structurally carry (§4: protect every floor before optimizing anything). */
  deficits: Pillar[];
  /** Weekly session count the plan carries per pillar. */
  sessionsByPillar: Record<Pillar, number>;
  rationale: RationaleCode[];
}

export function layer3Floors(state: UserState, date: IsoDate): Layer3Result {
  const budget = effectiveWeeklyBudget(state.profile, date);
  const floorsOnly = budget <= CONSTANTS.FLOORS_ONLY_BUDGET_MIN;
  const rationale: RationaleCode[] = floorsOnly
    ? [
        {
          code: 'floors-only-budget',
          params: {
            budget,
            floors: `strength ${CONSTANTS.STRENGTH_FLOOR_SESSIONS}x/wk >=${CONSTANTS.STRENGTH_FLOOR_HARD_SETS} hard sets/pattern; vo2 ${CONSTANTS.VO2_FLOOR_SESSIONS}x interval; z2 remainder; power ${CONSTANTS.POWER_FLOOR_MIN_PER_WEEK}min; mobility habit`,
          },
        },
      ]
    : [];
  // Structural audit: losing a pillar costs far more than gaining one is
  // worth. A plan that drops a floor is flagged regardless of budget.
  const audit = planFloorAudit(state);
  if (audit.deficits.length > 0) {
    rationale.push({
      code: 'floor-deficit',
      params: { pillars: audit.deficits.join(','), floors: audit.deficits.map((p) => `${p} needs ${CONSTANTS.FLOOR_SESSIONS[p]}x/wk`).join('; ') },
    });
  }
  return {
    floorsOnly,
    budget,
    deficits: audit.deficits,
    sessionsByPillar: audit.sessionsByPillar,
    rationale,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 4 — marginal allocation of residual budget                    */
/* ------------------------------------------------------------------ */

export interface Layer4Result {
  reallocated: boolean;
  /** Full per-pillar marginal-value ranking, always computed, provenance-labeled (§11). */
  marginal: MarginalAllocation[];
  rationale: RationaleCode[];
}

/**
 * §4 Layer 4. The ranking is always computed and reported —
 * `marginalValue = healthSlope × responseRate × (1 − hazard)` — but budget
 * only moves when the response term is this user's own identifiable data:
 *
 * - No pillar `estimated` (I8): ranking rows carry `basis: population-prior`,
 *   nothing reallocates, and the decision says so.
 * - A pillar is `estimated` but its CI includes zero: the response is not
 *   distinguishable from no-response above measurement noise (the I3 discipline
 *   applied to the §7 estimate) — still no reallocation.
 * - Otherwise: shift REALLOCATION_CAP of the weekly budget toward the
 *   highest-marginal-value identifiable pillar, taken from the lowest-ranked
 *   pillar. Floors are reserved before this layer, so the donor's floor is
 *   untouched (§4: later layers only allocate what earlier layers leave).
 */
export function layer4Marginal(state: UserState): Layer4Result {
  const marginal = marginalRanking(state);
  const rationale: RationaleCode[] = [];

  const identifiable = marginal.filter((m) => {
    if (m.basis !== 'estimated') return false;
    const t = state.trainability[m.pillar];
    return t.state === 'estimated' && t.ciLow > 0;
  });

  if (!marginal.some((m) => m.basis === 'estimated')) {
    rationale.push({ code: 'trainability-not-yet-identifiable' });
    return { reallocated: false, marginal, rationale };
  }
  if (identifiable.length === 0) {
    rationale.push({ code: 'estimated-response-includes-zero' });
    return { reallocated: false, marginal, rationale };
  }

  const winner = identifiable[0]!; // marginal is sorted descending
  const donor = [...marginal].reverse().find((m) => m.pillar !== winner.pillar)!;
  winner.deltaShareOfBudget = CONSTANTS.REALLOCATION_CAP;
  donor.deltaShareOfBudget = -CONSTANTS.REALLOCATION_CAP;
  rationale.push({
    code: 'marginal-reallocation',
    params: {
      toward: winner.pillar,
      from: donor.pillar,
      share: CONSTANTS.REALLOCATION_CAP,
      marginalValue: winner.marginalValue,
    },
  });
  return { reallocated: true, marginal, rationale };
}

/* ------------------------------------------------------------------ */
/* Layer 5 — session selection                                         */
/* ------------------------------------------------------------------ */

export interface Layer5Context {
  fullStop: boolean;
  gates: GateResult[];
  sleepLoadCap: boolean;
  floorsOnly: boolean;
  budget: number;
}

export interface Layer5Result {
  sessions: SessionPrescription[] | null;
  /** True when selection changed something vs the standing plan for a selection-layer reason. */
  restructured: boolean;
  modifiedByGates: boolean;
  /** Free-day floor suggestion — informational, never a plan change (does not trip the noise gate). */
  freeSession: SessionPrescription | null;
  rationale: RationaleCode[];
}

function tissueExposureFor(p: PlannedSession, includesPlyo: boolean): TissueChannel[] {
  const channels: TissueChannel[] = [];
  if (p.pillar === 'maxStrength' || p.modality === 'lift') {
    channels.push('axialCompression', 'kneeExtensor', 'hipExtensor', 'upperPush', 'upperPull');
  }
  if (p.modality === 'run') {
    channels.push('calfAchillesHighVelocity', 'kneeExtensor', 'hipExtensor');
  }
  if (includesPlyo) channels.push('connectiveHighVelocity');
  return [...new Set(channels)];
}

function toPrescription(
  p: PlannedSession,
  overrides: Partial<SessionPrescription> = {},
): SessionPrescription {
  const multiplier = CONSTANTS.MODALITY_MULTIPLIERS[p.modality] ?? 1;
  const includesPlyo = PLYO_MARKER.test(p.description);
  const base: SessionPrescription = {
    slot: p.slot,
    pillar: p.pillar,
    modality: p.modality,
    blocks: [{ name: p.description }],
    durationMinutes: p.durationMinutes,
    targetSRPE: p.targetSRPE,
    modalityMultiplier: multiplier,
    expectedCost: Math.round(p.targetSRPE * p.durationMinutes * multiplier),
    tissueExposure: tissueExposureFor(p, includesPlyo),
  };
  const merged = { ...base, ...overrides };
  merged.expectedCost = Math.round(
    merged.targetSRPE * merged.durationMinutes * merged.modalityMultiplier,
  );
  return merged;
}

/** Free-day floor top-up templates per pillar (conventions, §4 floor table). */
const FREE_SESSION_SPECS: Record<
  Pillar,
  { modality: PlannedSession['modality']; description: string; durationMinutes: number; targetSRPE: number }
> = {
  maxStrength: {
    modality: 'lift',
    description: 'Floor top-up: full-body strength, 4 hard sets on the least-recent patterns',
    durationMinutes: 40,
    targetSRPE: 7,
  },
  vo2max: {
    modality: 'run', // replaced with the first vo2CapableModality at build time (I9)
    description: 'Floor top-up: intervals 4x4min Z5, warmup/cooldown',
    durationMinutes: 40,
    targetSRPE: 8.5,
  },
  zone2: {
    modality: 'run',
    description: 'Floor top-up: continuous Z2 below LT1',
    durationMinutes: 45,
    targetSRPE: 4,
  },
  power: {
    modality: 'other',
    description: 'Floor top-up: jumps and throws, low volume, full recovery between efforts',
    durationMinutes: 15,
    targetSRPE: 6,
  },
  mobility: {
    modality: 'other',
    description: 'Floor top-up: hips/ankles ROM circuit',
    durationMinutes: 15,
    targetSRPE: 2,
  },
};

/**
 * Free-day suggestion: the most-behind pillar floor by acute (7-day EWMA)
 * load vs floor cost, respecting active gates. Fires only when something is
 * meaningfully behind (FREE_SESSION_DEFICIT_RATIO) — otherwise rest stands,
 * and a suggestion is never emitted just to fill a day (§1: novelty is not a
 * feature; §9: no mechanic that penalizes correct rest).
 */
function suggestFreeSession(
  state: UserState,
  ctx: Layer5Context,
  opts: { plyoBlocked: boolean; deloadActive: boolean; blockedChannels: Set<TissueChannel> },
  dow: string,
  rationale: RationaleCode[],
): SessionPrescription | null {
  if (ctx.sleepLoadCap) {
    // §5 sleep lever: any increase in training load is blocked. An extra
    // session on a rest day is exactly that increase.
    rationale.push({ code: 'free-session-withheld-sleep-cap' });
    return null;
  }
  const ranked = (Object.keys(FREE_SESSION_SPECS) as Pillar[])
    .map((p) => ({ p, ratio: state.load.acute[p] / (CONSTANTS.FLOOR_COST[p] || 1) }))
    .sort((a, b) => a.ratio - b.ratio);
  for (const { p, ratio } of ranked) {
    if (ratio >= CONSTANTS.FREE_SESSION_DEFICIT_RATIO) break; // nothing meaningfully behind
    if (p === 'power' && opts.plyoBlocked) continue;
    if (p === 'vo2max' && opts.deloadActive) continue;
    if (PILLAR_CHANNELS[p].some((c) => opts.blockedChannels.has(c))) continue;
    const spec = FREE_SESSION_SPECS[p];
    const modality =
      p === 'vo2max' ? state.profile.vo2CapableModalities[0] ?? spec.modality : spec.modality;
    if (p === 'vo2max' && !state.profile.vo2CapableModalities.includes(modality)) continue; // I9: no capable modality, no interval suggestion
    rationale.push({
      code: 'free-session-suggestion',
      params: { pillar: p, acuteLoad: Math.round(state.load.acute[p]), floorCost: CONSTANTS.FLOOR_COST[p]! },
    });
    return toPrescription({
      slot: `${dow}-morning` as PlannedSession['slot'],
      pillar: p,
      modality,
      description: spec.description,
      durationMinutes: spec.durationMinutes,
      targetSRPE: spec.targetSRPE,
    });
  }
  return null;
}

export function layer5Sessions(
  state: UserState,
  date: IsoDate,
  ctx: Layer5Context,
): Layer5Result {
  const rationale: RationaleCode[] = [];
  if (ctx.fullStop) {
    return { sessions: null, restructured: false, modifiedByGates: true, freeSession: null, rationale };
  }

  const dow = dayOfWeek(date);
  const plannedToday = state.standingPlan.weekStructure.filter((s) => s.slot.startsWith(dow));
  const first = plannedToday[0];
  const illnessGate = ctx.gates.find((g) => g.gate === 'post-illness-ramp');
  const interruptionGate = ctx.gates.find((g) => g.gate === 'interruption-ramp');
  const plyoGate = ctx.gates.find((g) => g.gate === 'plyometric-block');
  const painGates = ctx.gates.filter((g) => g.gate === 'pain-block');
  const cautionGates = ctx.gates.filter((g) => g.gate === 'tissue-caution');
  const suppressionGate = ctx.gates.find((g) => g.gate === 'unplanned-activity-suppression');
  const deloadGate = ctx.gates.find((g) => g.gate === 'deload');

  // §6 post-illness ramp overrides the standing session entirely.
  if (illnessGate) {
    const stage = illnessGate.trigger.params?.['stage'];
    const session =
      stage === 'easy-aerobic-only'
        ? toPrescription(
            {
              slot: first?.slot ?? `${dow}-morning`,
              pillar: 'zone2',
              modality: 'run',
              description: 'Post-illness ramp: easy aerobic only, well below LT1',
              durationMinutes: 35,
              targetSRPE: 3,
            },
            {},
          )
        : toPrescription(
            {
              slot: first?.slot ?? `${dow}-morning`,
              pillar: 'maxStrength',
              modality: 'lift',
              description:
                'Post-illness ramp: strength at ~50% volume, near-prior intensity; easy aerobic continues; no intervals, no plyometrics',
              durationMinutes: 40,
              targetSRPE: 6,
            },
            {},
          );
    return { sessions: [session], restructured: false, modifiedByGates: true, freeSession: null, rationale };
  }

  // §6 interruption return ramp overrides the standing session.
  if (interruptionGate) {
    const week = Number(interruptionGate.trigger.params?.['week'] ?? 1);
    const desc =
      week <= 1
        ? 'Return ramp week 1: easy Z2 volume + reduced-volume strength; no intervals, no plyometrics'
        : 'Return ramp week 2: volume rebuilt; one reduced interval session allowed (e.g. 3x3min); plyometrics not yet (connective ramps last)';
    const session = toPrescription({
      slot: first?.slot ?? `${dow}-morning`,
      pillar: week <= 1 ? 'zone2' : (first?.pillar ?? 'zone2'),
      modality: first?.modality === 'lift' ? 'lift' : 'run',
      description: desc,
      durationMinutes: Math.min(first?.durationMinutes ?? 45, 45),
      targetSRPE: week <= 1 ? 4 : Math.min(first?.targetSRPE ?? 5, 6),
    });
    return { sessions: [session], restructured: false, modifiedByGates: true, freeSession: null, rationale };
  }

  const strippedChannels = new Set<TissueChannel>([
    ...(plyoGate ? plyoGate.blockedChannels : []),
    ...cautionGates.flatMap((g) => g.blockedChannels),
  ]);

  if (plannedToday.length === 0) {
    const blockedChannels = new Set<TissueChannel>([
      ...strippedChannels,
      ...painGates.flatMap((g) => g.blockedChannels),
      ...(suppressionGate ? suppressionGate.blockedChannels : []),
    ]);
    const freeSession = suggestFreeSession(
      state,
      ctx,
      { plyoBlocked: plyoGate !== undefined, deloadActive: deloadGate !== undefined, blockedChannels },
      dow,
      rationale,
    );
    return { sessions: [], restructured: false, modifiedByGates: false, freeSession, rationale };
  }

  let modifiedByGates = false;
  let restructured = false;
  const constraint = activeConstraint(state.profile, date);
  let constraintApplied = false;
  let floorsCompressionApplied = false;

  const sessions = plannedToday.map((plannedRaw) => {
    let planned = plannedRaw;

    // I9 hard invariant: interval work only on a vo2-capable modality. The
    // standing plan is user-authored, so a violating session is corrected
    // here — substituted onto the primary capable modality, or converted to
    // Z2 when none is declared. SDC-exempt: this is a contract invariant,
    // not a signal response.
    if (planned.pillar === 'vo2max' && !state.profile.vo2CapableModalities.includes(planned.modality)) {
      const target = state.profile.vo2CapableModalities[0];
      if (target) {
        rationale.push({
          code: 'i9-modality-substituted',
          params: { slot: planned.slot, from: planned.modality, to: target },
        });
        planned = {
          ...planned,
          modality: target,
          description: `${planned.description} — moved off ${planned.modality} (interval work only on a VO2-capable modality, I9)`,
        };
      } else {
        rationale.push({ code: 'i9-no-capable-modality', params: { slot: planned.slot } });
        planned = {
          ...planned,
          pillar: 'zone2',
          targetSRPE: Math.min(planned.targetSRPE, 4),
          description: 'Continuous Z2 below LT1 (no VO2-capable modality declared; intervals withheld, I9)',
        };
      }
      modifiedByGates = true;
    }

    // Learned slot adherence (§3): a hard session sitting in a slot that
    // rarely completes gets a move suggestion — a surfaced recommendation,
    // never a silent plan change. Requires enough observations when the rate
    // was learned in-app; a seed-declared rate counts as established history.
    const adherenceRate = state.history.adherenceBySlot[planned.slot];
    const adherenceObs = state.history.adherenceObservations?.[planned.slot];
    if (
      adherenceRate !== undefined &&
      adherenceRate < CONSTANTS.ADHERENCE_FLAG_RATE &&
      planned.targetSRPE >= CONSTANTS.ADHERENCE_HARD_SRPE &&
      (adherenceObs === undefined || adherenceObs >= CONSTANTS.ADHERENCE_MIN_OBSERVATIONS)
    ) {
      rationale.push({
        code: 'low-adherence-slot',
        params: { slot: planned.slot, completionRate: adherenceRate },
      });
    }

    let session = toPrescription(planned);

    // Deload (deep HRV flag): intervals become Z2 for the week.
    if (deloadGate && session.pillar === 'vo2max') {
      session = toPrescription(
        { ...planned, pillar: 'zone2', description: 'Deload: planned intervals replaced with continuous Z2', targetSRPE: 4 },
        {},
      );
      modifiedByGates = true;
    }

    // Following-day suppression after a hard unplanned session (§6): lower-body
    // load and plyometrics come out; upper-emphasis substitution.
    if (suppressionGate && session.pillar === 'maxStrength') {
      session = toPrescription(
        {
          ...planned,
          description:
            'Upper-emphasis strength (following-day suppression after hard unplanned activity); no plyometric primer',
        },
        { tissueExposure: ['upperPush', 'upperPull', 'shoulderOverhead'] },
      );
      modifiedByGates = true;
    }

    // Pain block: swap the blocked pattern, keep the rest.
    for (const g of painGates) {
      const blocked = g.blockedChannels[0];
      if (blocked && session.tissueExposure.includes(blocked)) {
        session = {
          ...session,
          blocks: [
            {
              name: `Substitution: ${blocked} pattern removed (pain above 3/10); hinge-pattern lower work + upper accessory in its place`,
            },
          ],
          tissueExposure: session.tissueExposure.filter((c) => c !== blocked),
        };
        g.substitution = session;
        modifiedByGates = true;
      }
    }

    // Plyometric block and tissue caution: strip high-velocity exposure.
    if (strippedChannels.size > 0 && PLYO_MARKER.test(planned.description)) {
      session = {
        ...session,
        blocks: [
          {
            name: `${planned.description} — plyometric/max-velocity elements removed (${[...strippedChannels].join(', ')})`,
          },
        ],
        tissueExposure: session.tissueExposure.filter((c) => c !== 'connectiveHighVelocity'),
      };
      modifiedByGates = true;
    }

    // Declared constraints: restructure under equipment/time facts (SDC-exempt).
    if (constraint && (constraint.equipment || constraint.dailyMinutesCap)) {
      const cap = constraint.dailyMinutesCap ?? session.durationMinutes;
      session = {
        ...session,
        durationMinutes: Math.min(session.durationMinutes, cap),
        blocks: [
          {
            name: `${session.blocks[0]?.name ?? planned.description} — adapted to available equipment (${(constraint.equipment ?? state.profile.equipment).join(', ')})`,
          },
        ],
      };
      session.expectedCost = Math.round(
        session.targetSRPE * session.durationMinutes * session.modalityMultiplier,
      );
      constraintApplied = true;
    }

    // Floors-only budget: compress today's session.
    if (ctx.floorsOnly && session.durationMinutes > 40) {
      session = { ...session, durationMinutes: 40 };
      session.expectedCost = Math.round(
        session.targetSRPE * session.durationMinutes * session.modalityMultiplier,
      );
      floorsCompressionApplied = true;
    }

    // Tissue recency (Layer 5 selection input): trim same-day-loaded channels.
    const hot = session.tissueExposure.filter(
      (c) =>
        state.tissue[c].daysSinceLastExposure === 0 &&
        state.tissue[c].recentLoad >= CONSTANTS.TISSUE_RECENCY_ADJUST_LOAD,
    );
    if (hot.length > 0) {
      session = {
        ...session,
        blocks: [
          {
            name: `${session.blocks[0]?.name ?? planned.description} — reduced volume on ${hot.join(', ')} (loaded yesterday)`,
          },
        ],
      };
      restructured = true;
      rationale.push({ code: 'tissue-recency-adjustment', params: { channels: hot.join(',') } });
    }

    return session;
  });

  if (constraintApplied) {
    restructured = true;
    rationale.push({ code: 'declared-constraint-restructure', params: { note: constraint?.note ?? '' } });
  }

  // Forward planning for a declared upcoming constraint.
  const upcoming = upcomingConstraint(state.profile, date);
  if (upcoming) {
    restructured = true;
    rationale.push({
      code: 'forward-plan-constraint',
      params: {
        startDate: upcoming.startDate,
        plan: 'preserve Z2 volume + 1 interval run + daily mobility; strength paused for the constrained week (retained at zero dose for weeks)',
      },
    });
  }

  if (floorsCompressionApplied) {
    restructured = true;
    rationale.push({ code: 'floors-only-compression' });
  }

  return { sessions, restructured, modifiedByGates, freeSession: null, rationale };
}

/* ------------------------------------------------------------------ */
/* Layer 6 — noise gate                                                */
/* ------------------------------------------------------------------ */

export interface Layer6Result {
  outcome: 'changes-applied' | 'no-change-detected';
  rationale: RationaleCode[];
}

/**
 * I3: any change vs the standing plan must have a trigger that cleared its
 * SDC or be driven by a declared fact/gate. In this engine, layers only ever
 * modify the plan through gates and declared constraints (both SDC-exempt by
 * construction), so the gate reduces to: did anything actually change?
 */
export function layer6NoiseGate(modified: boolean): Layer6Result {
  return modified
    ? { outcome: 'changes-applied', rationale: [] }
    : {
        outcome: 'no-change-detected',
        rationale: [{ code: 'standing-plan-unchanged' }],
      };
}

/* ------------------------------------------------------------------ */
/* Retest evaluation (I10 + I3), outside the layer cascade             */
/* ------------------------------------------------------------------ */

export function evaluateRetest(state: UserState): RetestEvaluation | null {
  const block = state.block;
  if (!block || !block.pendingRetest) return null;
  if (block.status === 'interrupted') {
    return { verdict: 'block-interrupted' };
  }
  if (!block.preRegisteredThreshold) {
    return { verdict: 'refused-no-preregistration' };
  }
  const t = block.preRegisteredThreshold;
  const retest = block.pendingRetest;
  const typicalError =
    retest.typicalError ??
    (block.metricUnderTest !== 'maxStrength'
      ? state.fitness[block.metricUnderTest]?.typicalError ?? 0
      : 0);
  const sdcValue = sdc(typicalError);
  const delta = retest.value - block.baselineAtStart;
  const thresholdMet =
    t.direction === 'increase' ? retest.value >= t.value : retest.value <= t.value;
  const clearedSdc = Math.abs(delta) > sdcValue;
  const round = (n: number) => Math.round(n * 100) / 100;
  const common = { delta: round(delta), sdc: round(sdcValue), thresholdValue: t.value };
  if (!clearedSdc) {
    return thresholdMet
      ? { verdict: 'indeterminate-sub-sdc', ...common }
      : { verdict: 'no-change-detected', ...common };
  }
  return thresholdMet
    ? { verdict: 'success', ...common }
    : { verdict: 'threshold-not-met', ...common };
}

export { acwrCaution };
