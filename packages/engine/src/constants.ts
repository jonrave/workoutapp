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
