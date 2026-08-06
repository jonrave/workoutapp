/**
 * Per-layer unit tests (§10 Step 3: every layer independently testable) plus
 * derive helpers. Fixture-level behavior is covered in fixtures.test.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSTANTS } from '../src/constants';
import {
  acwrCaution,
  dayOfWeek,
  daysBetween,
  hrvFlagStatus,
  illnessRamp,
  interruptionRamp,
  sdc,
} from '../src/derive';
import {
  evaluateRetest,
  layer0Medical,
  layer1Gates,
  layer2Levers,
  layer3Floors,
  layer4Marginal,
  layer6NoiseGate,
} from '../src/layers';
import { decide } from '../src/decide';
import type { UserState } from '../src/types/state';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const baseline = () =>
  JSON.parse(readFileSync(`${root}/fixtures/subjects/subject-a.json`, 'utf8')) as UserState;

describe('derive', () => {
  it('sdc = 2.77 × typicalError (I3)', () => {
    expect(sdc(2.1)).toBeCloseTo(5.817);
    expect(sdc(1)).toBeCloseTo(2.77);
  });

  it('date helpers', () => {
    expect(daysBetween('2026-07-26', '2026-07-27')).toBe(1);
    expect(dayOfWeek('2026-07-27')).toBe('mon');
    expect(dayOfWeek('2026-07-28')).toBe('tue');
  });

  it('HRV flag requires strictly-below and sustained ≥3 days (I5 + convention)', () => {
    const s = baseline();
    s.recovery.hrv7d.value = 4.13; // exactly at the line
    s.recovery.hrvDaysBelowThreshold = 5;
    expect(hrvFlagStatus(s.recovery).active).toBe(false);
    s.recovery.hrv7d.value = 4.1;
    s.recovery.hrvDaysBelowThreshold = 2; // not sustained
    expect(hrvFlagStatus(s.recovery).active).toBe(false);
    s.recovery.hrvDaysBelowThreshold = 3;
    expect(hrvFlagStatus(s.recovery).active).toBe(true);
    expect(hrvFlagStatus(s.recovery).deep).toBe(false);
  });

  it('deep flag needs depth, duration, RHR and soreness corroboration', () => {
    const s = baseline();
    s.recovery.hrv7d.value = 4.02;
    s.recovery.hrvDaysBelowThreshold = 8;
    s.recovery.rhr7d.value = 51.8;
    s.recovery.subjectiveSoreness.value = 5;
    expect(hrvFlagStatus(s.recovery).deep).toBe(true);
    s.recovery.subjectiveSoreness.value = 2; // no corroboration
    expect(hrvFlagStatus(s.recovery).deep).toBe(false);
  });

  it('illness ramp stages and interval prohibition scale from resolution date', () => {
    const s = baseline();
    s.recovery.illnessFlags = [
      { onset: '2026-07-21', systemic: true, symptoms: [], resolved: '2026-07-26' },
    ];
    expect(illnessRamp(s.recovery, '2026-07-27')).toMatchObject({
      stage: 'easy-aerobic-only',
      noIntervals: true,
    });
    expect(illnessRamp(s.recovery, '2026-07-30')?.stage).toBe('reduced-strength');
    expect(illnessRamp(s.recovery, '2026-08-15')).toBeNull(); // ramp over
  });

  it('interruption ramp fires only at ≥10 days and computes the return week', () => {
    const s = baseline();
    expect(interruptionRamp(s.history, '2026-07-27')).toBeNull(); // last = 6-day travel
    s.history.interruptions.push({ startDate: '2026-07-13', cause: 'family', durationDays: 14 });
    expect(interruptionRamp(s.history, '2026-07-27')).toMatchObject({
      week: 1,
      connectiveLimited: true,
      noPlyo: true,
    });
    expect(interruptionRamp(s.history, '2026-08-03')?.week).toBe(2);
  });

  it('ACWR is derived per pillar and only flags at the caution ratio', () => {
    const s = baseline();
    expect(acwrCaution(s)).toBeNull();
    s.load.acute.vo2max = 130; // vs chronic 105 → 1.24
    expect(acwrCaution(s)).toMatchObject({ pillar: 'vo2max' });
  });
});

describe('layer 0 — medical red flags', () => {
  it('any red flag stops the cascade with no training content', () => {
    const s = baseline();
    expect(layer0Medical(s)).toBeNull();
    s.recovery.medicalRedFlags = ['chest-pain'];
    expect(layer0Medical(s)).toMatchObject({ instruction: 'stop-training-seek-care' });
  });
});

describe('layer 1 — injury and illness gate', () => {
  it('systemic illness is a full stop; above-neck is not', () => {
    const s = baseline();
    s.recovery.illnessFlags = [
      { onset: '2026-07-27', systemic: true, symptoms: ['fever'], resolved: null },
    ];
    expect(layer1Gates(s, '2026-07-27').fullStop).toBe(true);
    s.recovery.illnessFlags[0]!.systemic = false;
    const r = layer1Gates(s, '2026-07-27');
    expect(r.fullStop).toBe(false);
    expect(r.gates).toHaveLength(0);
  });

  it('pain strictly above 3/10 blocks the pattern; altered movement blocks at any score', () => {
    const s = baseline();
    s.recovery.activePain = [
      { site: 'kneeExtensor', score0to10: 3, altersMovement: false, reportedAt: '2026-07-27' },
    ];
    expect(layer1Gates(s, '2026-07-27').gates.some((g) => g.gate === 'pain-block')).toBe(false);
    s.recovery.activePain[0]!.altersMovement = true;
    expect(layer1Gates(s, '2026-07-27').gates.some((g) => g.gate === 'pain-block')).toBe(true);
  });

  it('tissue caution fires for sub-threshold pain on a recurrent high-velocity site only', () => {
    const s = baseline();
    s.recovery.activePain = [
      { site: 'hamstringHighVelocity', score0to10: 1, altersMovement: false, reportedAt: '2026-07-27' },
    ];
    expect(layer1Gates(s, '2026-07-27').gates.some((g) => g.gate === 'tissue-caution')).toBe(true);
    // Same pain on a non-recurrent, lightly loaded upper channel: nothing fires.
    s.recovery.activePain = [
      { site: 'upperPush', score0to10: 1, altersMovement: false, reportedAt: '2026-07-27' },
    ];
    expect(layer1Gates(s, '2026-07-27').gates).toHaveLength(0);
  });
});

describe('layer 2 — levers (I6: plan untouched)', () => {
  it('every surface carries trainingPlanUnchanged: true', () => {
    const s = baseline();
    s.levers.homeSBP7d!.value = 133;
    s.recovery.sleepMean7d.value = 6.5;
    const r = layer2Levers(s, '2026-07-27');
    expect(r.surfaces.length).toBeGreaterThanOrEqual(2);
    expect(r.surfaces.every((x) => x.trainingPlanUnchanged === true)).toBe(true);
  });

  it('never-measured Lp(a) prompts once (§5)', () => {
    const s = baseline();
    s.levers.lpa = null;
    const r = layer2Levers(s, '2026-07-27');
    expect(r.surfaces.map((x) => x.lever)).toContain('lpaNeverMeasured');
  });
});

describe('layer 3 — floors', () => {
  it('floors-only at or below the budget threshold', () => {
    const s = baseline();
    expect(layer3Floors(s, '2026-07-27').floorsOnly).toBe(false);
    s.profile.temporaryConstraints = [
      { startDate: '2026-07-27', endDate: '2026-08-02', weeklyBudgetMinutes: 180 },
    ];
    expect(layer3Floors(s, '2026-07-27').floorsOnly).toBe(true);
  });
});

describe('layer 3 — plan floor audit (§4: protect every floor before optimizing)', () => {
  it('the baseline plan structurally carries every floor', () => {
    expect(layer3Floors(baseline(), '2026-07-27').deficits).toEqual([]);
  });

  it('a plan that drops a floor is flagged and fires layer 3', () => {
    const s = baseline();
    s.standingPlan.weekStructure = s.standingPlan.weekStructure.filter(
      (x) => x.pillar !== 'maxStrength',
    );
    const r = layer3Floors(s, '2026-07-27');
    expect(r.deficits).toContain('maxStrength');
    const d = decide(s, '2026-07-27');
    expect(d.firedLayer).toBe(3);
    expect(d.allocation?.floors.maxStrength.met).toBe(false);
    expect(d.rationale.map((c) => c.code)).toContain('floor-deficit');
  });
});

describe('layer 4 — marginal allocation (§4)', () => {
  it('always reports the ranking; population priors never move budget (I8)', () => {
    const r = layer4Marginal(baseline());
    expect(r.reallocated).toBe(false);
    expect(r.marginal).toHaveLength(5);
    expect(
      r.marginal.every((m) => m.basis === 'population-prior' && m.deltaShareOfBudget === 0),
    ).toBe(true);
    expect(r.rationale.map((c) => c.code)).toContain('trainability-not-yet-identifiable');
    // Under the convention priors, vo2max ranks first for this subject.
    expect(r.marginal[0]!.pillar).toBe('vo2max');
  });

  it('an identifiable positive response reallocates, capped at 15%', () => {
    const s = baseline();
    s.trainability.vo2max = {
      state: 'estimated',
      mean: 1.2,
      ciLow: 0.4,
      ciHigh: 2.0,
      blocksObserved: 3,
    };
    const r = layer4Marginal(s);
    expect(r.reallocated).toBe(true);
    expect(r.marginal.find((m) => m.pillar === 'vo2max')!.deltaShareOfBudget).toBe(
      CONSTANTS.REALLOCATION_CAP,
    );
    expect(r.marginal.filter((m) => m.deltaShareOfBudget < 0)).toHaveLength(1);
    expect(r.rationale.map((c) => c.code)).toContain('marginal-reallocation');
    expect(decide(s, '2026-07-27').firedLayer).toBe(4);
  });

  it('an estimate whose CI includes zero does not reallocate (the I3 discipline applied to §7)', () => {
    const s = baseline();
    s.trainability.vo2max = {
      state: 'estimated',
      mean: 0.3,
      ciLow: -0.2,
      ciHigh: 0.8,
      blocksObserved: 2,
    };
    const r = layer4Marginal(s);
    expect(r.reallocated).toBe(false);
    expect(r.rationale.map((c) => c.code)).toContain('estimated-response-includes-zero');
  });
});

describe('layer 5 — I9, adherence, multi-session days, free-day suggestion', () => {
  it('I9: intervals planned on a non-capable modality are moved to the primary capable one', () => {
    const s = baseline();
    s.standingPlan.weekStructure = s.standingPlan.weekStructure.map((x) =>
      x.pillar === 'vo2max' ? { ...x, modality: 'spinBike' as const } : x,
    );
    const d = decide(s, '2026-07-28'); // Tuesday: interval day
    expect(d.sessions?.[0]?.modality).toBe('run');
    expect(d.rationale.map((c) => c.code)).toContain('i9-modality-substituted');
    expect(d.noiseGate.outcome).toBe('changes-applied');
  });

  it('I9: with no capable modality declared, intervals are withheld and become Z2', () => {
    const s = baseline();
    s.profile.vo2CapableModalities = [];
    const d = decide(s, '2026-07-28');
    expect(d.sessions?.[0]?.pillar).toBe('zone2');
    expect(d.rationale.map((c) => c.code)).toContain('i9-no-capable-modality');
  });

  it('a hard session in a low-adherence slot gets a move suggestion, never a silent change (§3)', () => {
    const s = baseline();
    s.standingPlan.weekStructure = [
      ...s.standingPlan.weekStructure.filter((x) => !x.slot.startsWith('thu')),
      {
        slot: 'thu-evening',
        pillar: 'maxStrength',
        modality: 'lift',
        description: 'Lower emphasis: squat, hinge accessory',
        durationMinutes: 60,
        targetSRPE: 7,
      },
    ];
    const d = decide(s, '2026-07-30'); // Thursday: seed adherence 0.4
    expect(d.rationale.map((c) => c.code)).toContain('low-adherence-slot');
    expect(d.noiseGate.outcome).toBe('no-change-detected'); // suggestion only
  });

  it('every session on a two-session day is prescribed', () => {
    const s = baseline();
    s.standingPlan.weekStructure.push({
      slot: 'mon-evening',
      pillar: 'mobility',
      modality: 'other',
      description: 'Hips/ankles ROM circuit',
      durationMinutes: 15,
      targetSRPE: 2,
    });
    const d = decide(s, '2026-07-27');
    expect(d.sessions).toHaveLength(2);
  });

  it('free day: the most-behind floor is suggested and the noise gate stays quiet (§1)', () => {
    const d = decide(baseline(), '2026-07-31'); // Friday: nothing planned
    expect(d.sessions).toEqual([]);
    expect(d.freeSession?.pillar).toBe('vo2max'); // acute 95 vs floor cost 340
    expect(d.freeSession?.modality).toBe('run'); // I9: first capable modality
    expect(d.rationale.map((c) => c.code)).toContain('free-session-suggestion');
    expect(d.noiseGate.outcome).toBe('no-change-detected'); // a suggestion is not a plan change
  });

  it('free-day suggestion is withheld under the sleep load cap (§5)', () => {
    const s = baseline();
    s.recovery.sleepMean7d.value = 6.5;
    const d = decide(s, '2026-07-31');
    expect(d.freeSession).toBeNull();
    expect(d.rationale.map((c) => c.code)).toContain('free-session-withheld-sleep-cap');
  });

  it('nothing meaningfully behind → the rest day stands, no suggestion emitted (§9)', () => {
    const s = baseline();
    s.load.acute = { maxStrength: 560, vo2max: 340, zone2: 240, power: 84, mobility: 40 };
    const d = decide(s, '2026-07-31');
    expect(d.freeSession).toBeNull();
    expect(d.rationale.map((c) => c.code)).not.toContain('free-session-suggestion');
  });
});

describe('layer 6 — noise gate', () => {
  it('no modification renders the standing plan as no-change-detected (I3, §1)', () => {
    expect(layer6NoiseGate(false).outcome).toBe('no-change-detected');
    expect(layer6NoiseGate(true).outcome).toBe('changes-applied');
  });
});

describe('retest evaluation (I10 + I3)', () => {
  const withRetest = (value: number) => {
    const s = baseline();
    s.block!.pendingRetest = {
      value,
      unit: 'ml/kg/min',
      typicalError: 2.1,
      measuredAt: '2026-08-10',
    };
    return s;
  };

  it('refuses evaluation without a pre-registered threshold', () => {
    const s = withRetest(60);
    s.block!.preRegisteredThreshold = null;
    expect(evaluateRetest(s)?.verdict).toBe('refused-no-preregistration');
  });

  it('sub-SDC threshold pass is indeterminate — SDC governs (approved RA2)', () => {
    expect(evaluateRetest(withRetest(55.8))?.verdict).toBe('indeterminate-sub-sdc');
  });

  it('clear pass and clear miss', () => {
    expect(evaluateRetest(withRetest(58.6))?.verdict).toBe('success');
    expect(evaluateRetest(withRetest(54.0))?.verdict).toBe('no-change-detected');
  });

  it('interrupted block yields no outcome', () => {
    const s = withRetest(58.6);
    s.block!.status = 'interrupted';
    expect(evaluateRetest(s)?.verdict).toBe('block-interrupted');
  });
});

describe('constants hygiene (§11)', () => {
  it('SDC multiplier and reallocation cap match the contract', () => {
    expect(CONSTANTS.SDC_MULTIPLIER).toBe(2.77);
    expect(CONSTANTS.REALLOCATION_CAP).toBe(0.15);
  });
});
