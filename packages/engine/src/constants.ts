/**
 * Every tunable constant in the engine, in one place (contract §10 Step 3).
 *
 * Each constant is marked either
 *   `convention:` — a working value with no direct evidence base; expected to
 *                   be revisited, and the UI must be able to say so (§11), or
 *   `evidence:`   — carries a citation or a contract-section source.
 */
export const CONSTANTS = {
  /**
   * evidence: SDC = 1.96 * sqrt(2) * typicalError ≈ 2.77 * TE, the standard
   * smallest-detectable-change derivation (Hopkins, Sportscience 2000; contract I3).
   */
  SDC_MULTIPLIER: 2.77,

  /** evidence: contract I5 — flag when 7d mean < 60d baseline − 0.75 SD, sustained. */
  HRV_FLAG_SD: 0.75,
  /** convention: "sustained" = this many consecutive days strictly below the line (user-approved 2026-07-28). */
  HRV_FLAG_SUSTAINED_DAYS: 3,
  /** convention: deep-flag deload depth (user-approved 2026-07-28). */
  HRV_DEEP_FLAG_SD: 1.0,
  /** convention: deep-flag deload minimum duration in days. */
  HRV_DEEP_FLAG_DAYS: 7,
  /** convention: corroborating resting-HR elevation (bpm over 60d baseline) for the deep flag. */
  HRV_DEEP_FLAG_RHR_DELTA: 3,
  /** convention: corroborating subjective soreness (0–10) for the deep flag. */
  HRV_DEEP_FLAG_SORENESS: 4,

  /** evidence: contract §4 Layer 1 — joint pain strictly above this (0–10) blocks the pattern. */
  PAIN_BLOCK_THRESHOLD: 3,
  /** convention: tissue-caution — recent sRPE-minute load on a high-velocity channel at/above this makes reported pain there defer plyo/sprint work (user-approved 2026-07-28). */
  TISSUE_CAUTION_RECENT_LOAD: 200,
  /** convention: tissue-caution clears after this many hours pain-free. */
  TISSUE_CAUTION_PAINFREE_HOURS: 48,

  /** evidence: contract §4 Layer 1 — plyo/max-velocity blocked when prior-night sleep is below this (hours). */
  PLYO_SLEEP_MIN_HOURS: 6,

  /** evidence: contract §5 — sleep lever flags below this 7d mean (hours); any load increase blocked. */
  SLEEP_LEVER_HOURS: 7,
  /** evidence: contract §5 — sleep-midpoint 14d SD flag line (minutes). */
  SLEEP_MIDPOINT_SD_LIMIT_MIN: 60,
  /** evidence: contract §5 — home 7-day mean SBP flag line (mmHg); MRCT-graded lever. */
  SBP_FLAG: 130,
  /** evidence: contract §5 — ApoB flag line (mg/dL). */
  APOB_FLAG: 70,
  /** evidence: contract §5 — lower ApoB flag line when Lp(a) elevated or family history. */
  APOB_FLAG_WITH_RISK: 60,
  /** evidence: contract §5 — Lp(a) considered elevated above this (nmol/L). */
  LPA_HIGH: 50,
  /** evidence: contract §5 — waist flag (cm). */
  WAIST_FLAG_CM: 94,
  /** convention: HbA1c (%) and fasting insulin (µIU/mL) out-of-range lines for the metabolic surface. */
  HBA1C_FLAG: 5.7,
  INSULIN_FLAG: 10,
  /** convention: a flagged lever unaddressed for this many days escalates its salience (never its budget impact, I6). */
  LEVER_ESCALATION_DAYS: 14,
  /** convention: staleness prompt cadences per lever field, days (from §8 cadence table). */
  STALENESS_DAYS: {
    homeSBP7d: 90,
    homeDBP7d: 90,
    apoB: 365,
    hba1c: 365,
    fastingInsulin: 365,
    waistCm: 21,
  } as Record<string, number>,

  /** convention: §6 implements ACWR strictly as a soft caution at/above this acute:chronic ratio; it may never hard-block. */
  ACWR_CAUTION_RATIO: 1.2,
  /** convention: an unplanned activity at/above this sRPE counts as "hard" and suppresses the following day (§6). */
  HARD_UNPLANNED_SRPE: 7,

  /** evidence: contract §6 — 2–3 easy aerobic days after systemic symptoms resolve; we use 2 before strength reintroduction. */
  POST_ILLNESS_EASY_DAYS: 2,
  /** convention: no interval work within this many days after a systemic illness resolves (§6 "not in week 1 back"). */
  POST_ILLNESS_NO_INTERVAL_DAYS: 7,
  /** convention: an interruption at/above this many days triggers the §6 per-pillar return ramp. */
  INTERRUPTION_RAMP_MIN_DAYS: 10,
  /** evidence: contract §6 — connective tissue is the rate limiter after interruptions of ~2 weeks or more; high-velocity work ramps last. */
  INTERRUPTION_CONNECTIVE_DAYS: 14,
  /** convention: earliest return week for plyometric/high-impact work after a connective-limited interruption. */
  INTERRUPTION_PLYO_WEEK: 3,

  /** convention (§4 floor table): strength floor. */
  STRENGTH_FLOOR_SESSIONS: 2,
  STRENGTH_FLOOR_HARD_SETS: 4,
  /** convention (§4 floor table): one hard interval session per week holds VO2max for several weeks. */
  VO2_FLOOR_SESSIONS: 1,
  /** convention (§4 floor table): power floor, minutes per week across 2 short exposures. */
  POWER_FLOOR_MIN_PER_WEEK: 12,
  /** convention: weekly budget (minutes) at or below which only floors are programmed and Layer 4 allocates nothing. */
  FLOORS_ONLY_BUDGET_MIN: 200,
  /** evidence: contract §4 Layer 4 — cap any single reallocation at ~15% of weekly budget. */
  REALLOCATION_CAP: 0.15,

  /**
   * convention: weekly sRPE-minute cost reserved per pillar floor (I7 — cost
   * units, never minutes). Derived from the §4 floor table's working
   * prescriptions: strength 2×40min@7, vo2 1×40min@8.5, z2 1×60min@4,
   * power 12min@7 across 2 exposures, mobility 5×20min@2 at 0.2 weight.
   */
  FLOOR_COST: {
    maxStrength: 560,
    vo2max: 340,
    zone2: 240,
    power: 84,
    mobility: 40,
  } as Record<string, number>,
  /** convention: weekly session count the standing plan must carry per floor (power counts short plyo/primer exposures). */
  FLOOR_SESSIONS: {
    maxStrength: 2,
    vo2max: 1,
    zone2: 1,
    power: 2,
    mobility: 1,
  } as Record<string, number>,

  /** ---- §7 trainability estimation. All conventions (§11). ---- */
  /** convention: evaluable block retests required before a pillar's response is 'estimated' (§7 says "several"; we start acting at 2). */
  TRAINABILITY_MIN_BLOCKS: 2,
  /** convention: pseudo-observation weight of the population prior in the shrinkage mean (§7). */
  TRAINABILITY_PRIOR_WEIGHT: 2,
  /**
   * convention: population-prior response per completed block, in
   * SDC-normalized units (retest delta ÷ SDC). Deliberately coarse; the wide
   * prior SD below is the honest part (HERITAGE: individual VO2max response
   * ranges from near zero to large).
   */
  TRAINABILITY_PRIOR_RESPONSE: {
    maxStrength: 0.8,
    vo2max: 1.0,
    zone2: 0.9,
    power: 0.6,
    mobility: 0.7,
  } as Record<string, number>,
  /** convention: prior SD for the shrinkage interval, same SDC-normalized units. */
  TRAINABILITY_PRIOR_SD: 0.8,

  /** ---- §4 Layer 4 marginal-value terms. All conventions (§11). ---- */
  /** convention: healthSlopeAtCurrentPosition prior per pillar, unitless relative scale. */
  HEALTH_SLOPE_PRIOR: {
    vo2max: 1.0,
    zone2: 0.8,
    maxStrength: 0.7,
    power: 0.5,
    mobility: 0.25,
  } as Record<string, number>,
  /** convention: injuryHazardDelta prior per pillar, 0–1 share subtracted from marginal value. */
  INJURY_HAZARD_DELTA_PRIOR: {
    mobility: 0.02,
    zone2: 0.05,
    maxStrength: 0.1,
    vo2max: 0.15,
    power: 0.25,
  } as Record<string, number>,
  /** convention: hazard bump when a pillar loads a tissue channel with a recurrent injury on record. */
  INJURY_HAZARD_RECURRENCE_BUMP: 0.15,

  /** ---- Layer 5 free-day suggestion + slot adherence. All conventions (§11). ---- */
  /** convention: a free-day floor suggestion fires only when a pillar's acute (7d EWMA) load is below this share of its floor cost. */
  FREE_SESSION_DEFICIT_RATIO: 0.75,
  /** convention: learned slot completion rate below this triggers a move-the-session suggestion (§3: stop scheduling hard work there). */
  ADHERENCE_FLAG_RATE: 0.6,
  /** convention: outcomes observed on a slot before its learned rate drives suggestions (the SDC-analog for adherence data). */
  ADHERENCE_MIN_OBSERVATIONS: 4,
  /** convention: targetSRPE at/above this counts as "hard work" for slot-adherence suggestions. */
  ADHERENCE_HARD_SRPE: 7,

  /** convention: session cost multipliers per modality (I7: cost = sRPE × minutes × multiplier). */
  MODALITY_MULTIPLIERS: {
    run: 1.0,
    airBike: 0.95,
    spinBike: 0.9,
    row: 0.95,
    swim: 0.9,
    hike: 0.85,
    lift: 1.0,
    other: 1.0,
  } as Record<string, number>,

  /** convention: Layer 5 flags a same-day tissue-recency adjustment when a channel used today was loaded to at least this within the last day. */
  TISSUE_RECENCY_ADJUST_LOAD: 500,
  /** convention: a declared constraint starting within this many days triggers forward planning. */
  FORWARD_PLAN_HORIZON_DAYS: 14,
} as const;
