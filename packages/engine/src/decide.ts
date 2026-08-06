/**
 * decide(state, date) -> Decision — the engine's single entry point.
 *
 * Pure function (I1): no I/O, no clock, no randomness; everything it needs is
 * in `state` and `date`. Layers evaluate in the strict §4 order; the first
 * layer that fires determines the shape of the output, later layers only
 * allocate what earlier layers leave available.
 */
import { CONSTANTS } from './constants';
import { acwrCaution } from './derive';
import {
  evaluateRetest,
  layer0Medical,
  layer1Gates,
  layer2Levers,
  layer3Floors,
  layer4Marginal,
  layer5Sessions,
  layer6NoiseGate,
} from './layers';
import type {
  AllocationReport,
  CascadeLayer,
  Decision,
  FloorAllocation,
  LayerTrace,
  MarginalAllocation,
  RationaleCode,
} from './types/decision';
import type { IsoDate } from './types/field';
import type { Pillar, UserState } from './types/state';

const PILLARS: Pillar[] = ['maxStrength', 'vo2max', 'zone2', 'power', 'mobility'];

function buildAllocation(
  budget: number,
  floorsOnly: boolean,
  deficits: Pillar[],
  marginal: MarginalAllocation[],
): AllocationReport {
  const floors = {} as Record<Pillar, FloorAllocation>;
  let reservedCost = 0;
  for (const p of PILLARS) {
    const cost = CONSTANTS.FLOOR_COST[p] ?? 0;
    floors[p] = {
      met: !deficits.includes(p),
      prescribedSessions: CONSTANTS.FLOOR_SESSIONS[p] ?? 0,
      reservedCost: Math.round(cost),
    };
    reservedCost += cost;
  }
  return {
    floors,
    residualBudgetCost: floorsOnly ? 0 : Math.max(0, Math.round(budget * 7 - reservedCost)),
    marginal,
  };
}

export function decide(state: UserState, date: IsoDate): Decision {
  const rationale: RationaleCode[] = [];
  const trace: LayerTrace[] = [];

  // Retest evaluation (I10 + I3) is independent of today's session cascade.
  const retest = evaluateRetest(state);
  if (state.block?.status === 'interrupted') {
    rationale.push({ code: 'block-interrupted', params: { pillar: state.block.activePillar } });
  }

  // §6: ACWR is a soft caution only; it may warn and may never hard-block.
  const caution = acwrCaution(state);
  if (caution) {
    rationale.push({
      code: 'acwr-soft-caution',
      params: { pillar: caution.pillar, ratio: caution.ratio },
    });
  }

  // Layer 0 — medical red flags: stop and seek care, no training content.
  const medicalStop = layer0Medical(state);
  trace.push({ layer: 0, fired: medicalStop !== null, codes: [] });
  if (medicalStop) {
    return {
      date,
      firedLayer: 0,
      trace,
      sessions: null,
      freeSession: null,
      medicalStop,
      gates: [],
      surfacedLevers: [],
      allocation: null,
      noiseGate: { outcome: 'no-change-detected', strippedChanges: [], appliedChanges: [] },
      retest,
      rationale: [...rationale, { code: 'medical-stop-seek-care' }],
    };
  }

  // Layer 1 — injury and illness gate.
  const l1 = layer1Gates(state, date);
  trace.push({ layer: 1, fired: l1.gates.length > 0, codes: l1.rationale });

  // Layer 2 — non-training lever escalation (I6: plan untouched).
  const l2 = layer2Levers(state, date);
  trace.push({ layer: 2, fired: l2.surfaces.length > 0, codes: l2.rationale });

  const gates = [...l1.gates, ...(l2.sleepLoadCap ? [l2.sleepLoadCap] : [])];

  // Layer 3 — pillar floors (budget compression + structural floor audit).
  const l3 = layer3Floors(state, date);
  trace.push({ layer: 3, fired: l3.floorsOnly || l3.deficits.length > 0, codes: l3.rationale });

  // Layer 4 — marginal allocation of what remains.
  const l4 = layer4Marginal(state);
  trace.push({ layer: 4, fired: l4.reallocated, codes: l4.rationale });

  // Layer 5 — session selection.
  const l5 = layer5Sessions(state, date, {
    fullStop: l1.fullStop,
    gates,
    sleepLoadCap: l2.sleepLoadCap !== null,
    floorsOnly: l3.floorsOnly,
    budget: l3.budget,
  });
  trace.push({ layer: 5, fired: l5.restructured, codes: l5.rationale });

  // Layer 6 — noise gate.
  const modified = l5.modifiedByGates || l5.restructured || l1.fullStop;
  const l6 = layer6NoiseGate(modified);
  trace.push({ layer: 6, fired: true, codes: l6.rationale });

  const firedLayer: CascadeLayer =
    l1.gates.length > 0
      ? 1
      : l2.surfaces.length > 0
        ? 2
        : l3.floorsOnly || l3.deficits.length > 0
          ? 3
          : l4.reallocated
            ? 4
            : l5.restructured
              ? 5
              : 6;

  rationale.push(
    ...l1.rationale,
    ...l2.rationale,
    ...l3.rationale,
    ...l4.rationale,
    ...l5.rationale,
    ...l6.rationale,
  );

  return {
    date,
    firedLayer,
    trace,
    sessions: l5.sessions,
    freeSession: l5.freeSession,
    medicalStop: null,
    gates,
    surfacedLevers: l2.surfaces,
    allocation: l1.fullStop
      ? null
      : buildAllocation(l3.budget, l3.floorsOnly, l3.deficits, l4.marginal),
    noiseGate: {
      outcome: l6.outcome,
      strippedChanges: [],
      appliedChanges: [],
    },
    retest,
    rationale,
  };
}
