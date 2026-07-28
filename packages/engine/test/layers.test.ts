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
  layer6NoiseGate,
} from '../src/layers';
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
    s.levers.homeSBP7d.value = 133;
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
