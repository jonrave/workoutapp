/**
 * The Step 3 exit criterion: every user-approved scenario in
 * fixtures/scenarios.json must pass. `expected` asserts only the fields it
 * names; gate/lever assertions are subset semantics (extra gates the contract
 * also implies are not failures).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide';
import type { Decision } from '../src/types/decision';
import type { UserState } from '../src/types/state';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const subject = JSON.parse(
  readFileSync(`${root}/fixtures/subjects/subject-a.json`, 'utf8'),
) as UserState;
const spec = JSON.parse(readFileSync(`${root}/fixtures/scenarios.json`, 'utf8')) as {
  scenarios: Array<{
    id: string;
    family: string;
    date: string;
    overrides: Record<string, unknown>;
    expected: {
      firedLayer?: number;
      sessionsNull?: boolean;
      gates?: Array<{ gate: string; blockedChannels?: string[] }>;
      surfacedLevers?: string[];
      noiseGateOutcome?: string;
      retestVerdict?: string;
      rationaleIncludes?: string[];
    };
    notes: string;
  }>;
};

function merge<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = merge((base as Record<string, unknown> | undefined)?.[k], v);
  }
  return out as T;
}

describe('scenario fixtures (contract §10 step 2, user-approved 2026-07-28)', () => {
  it('covers exactly the 37 rows of scenarios.md', () => {
    const md = readFileSync(`${root}/fixtures/scenarios.md`, 'utf8');
    const mdIds = md
      .split('\n')
      .map((l) => /^\| ([A-Z]+[0-9]+) \|/.exec(l)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(spec.scenarios).toHaveLength(37);
    expect(new Set(mdIds)).toEqual(new Set(spec.scenarios.map((s) => s.id)));
  });

  for (const scenario of spec.scenarios) {
    it(`${scenario.id} — ${scenario.family}`, () => {
      const state = merge(subject, scenario.overrides);
      const decision: Decision = decide(state, scenario.date);
      const e = scenario.expected;

      if (e.firedLayer !== undefined) {
        expect(decision.firedLayer, 'firedLayer').toBe(e.firedLayer);
      }
      if (e.sessionsNull !== undefined) {
        expect(decision.sessions === null, 'sessions null').toBe(e.sessionsNull);
      }
      for (const g of e.gates ?? []) {
        const match = decision.gates.find((d) => d.gate === g.gate);
        expect(match, `gate ${g.gate} present`).toBeTruthy();
        for (const ch of g.blockedChannels ?? []) {
          expect(match!.blockedChannels, `gate ${g.gate} blocks ${ch}`).toContain(ch);
        }
      }
      for (const lever of e.surfacedLevers ?? []) {
        expect(
          decision.surfacedLevers.map((s) => s.lever),
          `lever ${lever} surfaced`,
        ).toContain(lever);
      }
      if (e.noiseGateOutcome !== undefined) {
        expect(decision.noiseGate.outcome, 'noise gate').toBe(e.noiseGateOutcome);
      }
      if (e.retestVerdict !== undefined) {
        expect(decision.retest?.verdict, 'retest verdict').toBe(e.retestVerdict);
      }
      for (const code of e.rationaleIncludes ?? []) {
        expect(
          decision.rationale.map((c) => c.code),
          `rationale ${code}`,
        ).toContain(code);
      }
    });
  }
});
