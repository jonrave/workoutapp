/**
 * Chat context assembly + distillation orchestration (I2c: explanation on
 * demand). The state and decision summaries are deterministic renderings of
 * structures the engine already produced — the same I2b job labels.ts does.
 * This module deliberately imports no event constructors and never touches
 * appendEvent: chat can read everything and write nothing but chat.
 */
import type { Decision, Field, UserState } from '@peakspan/engine';
import type { ChatClient, ChatContext, ChatTurn, MemoryDistiller } from '@peakspan/adapters';
import { StubChatClient, StubMemoryDistiller } from '@peakspan/adapters';
import { currentDecision, getChatStore } from './data';
import {
  LAYER_NAMES,
  gateLabel,
  metricLabel,
  leverLabel,
  modalityLabel,
  pillarLabel,
  rationaleText,
  retestVerdictLabel,
  slotLabel,
  surfaceLabel,
  tissueLabel,
} from './labels';

/** Turns of the current conversation given to the model; older turns are covered by memory. */
const MAX_TURNS = 40;

const round = (n: number) => Math.round(n * 100) / 100;

function fieldText(f: Field<number> | null): string {
  if (!f) return 'never measured';
  return `${round(f.value)} (as of ${f.lastUpdated})`;
}

export function summarizeState(state: UserState): string {
  const p = state.profile;
  const r = state.recovery;
  const lines: string[] = [];

  lines.push(
    `Profile: age ${p.age}, ${p.sex}, training age ${p.trainingAgeYears}y, weekly budget ${p.weeklyBudgetMinutes} min. ` +
      `VO2-capable modalities (hard constraint I9): ${p.vo2CapableModalities.map(modalityLabel).join(', ')}.` +
      (p.hardConstraints.length > 0 ? ` Hard constraints: ${p.hardConstraints.join('; ')}.` : ''),
  );

  lines.push(
    `Recovery (7d means vs 60d baselines, I5): HRV ln rMSSD ${round(r.hrv7d.value)} vs baseline ${round(r.hrvBaseline60d.value)} (SD ${round(r.hrvBaselineSD.value)}, ${r.hrvDaysBelowThreshold} days below flag line); ` +
      `resting HR ${round(r.rhr7d.value)} vs ${round(r.rhrBaseline60d.value)} bpm; ` +
      `sleep ${round(r.sleepMean7d.value)}h 7d mean, ${round(r.sleepPriorNight.value)}h last night, midpoint SD ${round(r.sleepMidpointSD14d.value)} min; ` +
      `soreness ${r.subjectiveSoreness.value}/10.`,
  );
  const activeIllness = r.illnessFlags.filter((f) => f.resolved === null);
  if (activeIllness.length > 0) {
    lines.push(
      `Active illness: ${activeIllness.map((f) => `${f.symptoms.join('/')} since ${f.onset}${f.systemic ? ' (systemic)' : ''}`).join('; ')}.`,
    );
  }
  if (r.activePain.length > 0) {
    lines.push(
      `Active pain: ${r.activePain.map((a) => `${tissueLabel(String(a.site))} ${a.score0to10}/10${a.altersMovement ? ', alters movement' : ''}`).join('; ')}.`,
    );
  }

  const fitness: string[] = [];
  for (const key of ['vo2max', 'lt1Pace', 'peakPower', 'cmjHeight', 'rsi', 'almi', 'fmi', 'vat', 'romAsymmetry'] as const) {
    const f = state.fitness[key];
    if (f) fitness.push(`${metricLabel(key)} ${fieldText(f)}`);
  }
  const strength = Object.entries(state.fitness.maxStrength)
    .filter((e): e is [string, Field<number>] => e[1] !== null)
    .map(([pattern, f]) => `${pattern} e1RM ${fieldText(f)}`);
  if (fitness.length + strength.length > 0) {
    lines.push(`Fitness estimates: ${[...fitness, ...strength].join('; ')}. Unlisted metrics: never measured.`);
  }

  const levers: string[] = [];
  for (const key of ['homeSBP7d', 'homeDBP7d', 'apoB', 'lpa', 'hba1c', 'fastingInsulin', 'alcoholUnits7d', 'waistCm'] as const) {
    const f = state.levers[key];
    if (f) levers.push(`${leverLabel(key)} ${fieldText(f)}`);
  }
  lines.push(
    `Non-training levers (their own lane, I6): ${levers.length > 0 ? levers.join('; ') : 'none measured yet'}. Alcohol threshold ${state.levers.alcoholThreshold7d} units/7d.`,
  );

  lines.push(
    `Standing plan (last changed ${state.standingPlan.lastChanged}): ${state.standingPlan.weekStructure
      .map((s) => `${slotLabel(s.slot)} — ${s.description} (${pillarLabel(s.pillar)}, ${modalityLabel(s.modality)}, ${s.durationMinutes} min @ sRPE ${s.targetSRPE})`)
      .join('; ')}.`,
  );

  if (state.block) {
    const b = state.block;
    lines.push(
      `Active block: ${pillarLabel(b.activePillar)} since ${b.startDate}, ${b.plannedWeeks} weeks planned, metric ${metricLabel(b.metricUnderTest)} (baseline ${b.baselineAtStart}` +
        (b.preRegisteredThreshold
          ? `, pre-registered threshold ${b.preRegisteredThreshold.value} ${b.preRegisteredThreshold.unit}`
          : ', no pre-registered threshold') +
        `), status ${b.status}.`,
    );
  }

  const trainability = Object.entries(state.trainability)
    .map(([pillar, t]) =>
      t.state === 'estimated'
        ? `${pillarLabel(pillar)} estimated (${t.blocksObserved} blocks)`
        : `${pillarLabel(pillar)} not yet identifiable (${t.blocksObserved} blocks)`,
    )
    .join('; ');
  lines.push(`Trainability (I8): ${trainability}.`);

  if (state.history.interruptions.length > 0) {
    lines.push(
      `Interruption history: ${state.history.interruptions
        .map((i) => `${i.cause} ${i.startDate} (${i.durationDays}d)`)
        .join('; ')}.`,
    );
  }

  return lines.join('\n');
}

export function summarizeDecision(decision: Decision): string {
  const lines: string[] = [];
  lines.push(`Decided at layer ${decision.firedLayer} (${LAYER_NAMES[decision.firedLayer]}) for ${decision.date}.`);
  for (const r of decision.rationale) lines.push(`- ${rationaleText(r)}`);
  if (decision.medicalStop) {
    lines.push(`MEDICAL STOP: ${decision.medicalStop.reasons.join(', ')} — stop training and seek care.`);
  }
  if (decision.sessions === null) {
    lines.push('No training today (systemic illness gate).');
  } else if (decision.sessions.length === 0) {
    lines.push('Rest day: nothing on the standing plan today.');
  } else {
    lines.push(
      `Sessions: ${decision.sessions
        .map((s) => `${slotLabel(s.slot)} ${pillarLabel(s.pillar)} on ${modalityLabel(s.modality)}, ${s.durationMinutes} min (${s.blocks.map((b) => b.name).join('; ')})`)
        .join(' | ')}.`,
    );
  }
  for (const gate of decision.gates) {
    lines.push(
      `Gate: ${gateLabel(gate.gate)} — ${rationaleText(gate.trigger)}` +
        (gate.blockedChannels.length > 0 ? ` Blocked: ${gate.blockedChannels.map(tissueLabel).join(', ')}.` : ''),
    );
  }
  for (const s of decision.surfacedLevers) {
    lines.push(`Surfaced lever (outside the training budget): ${surfaceLabel(s.lever)} — ${rationaleText(s.trigger)}`);
  }
  if (decision.retest) {
    lines.push(`Retest verdict: ${retestVerdictLabel(decision.retest.verdict)}.`);
  }
  return lines.join('\n');
}

export async function assembleChatContext(turns: ChatTurn[]): Promise<ChatContext> {
  const [{ state, decision }, chat] = await Promise.all([currentDecision(), getChatStore()]);
  const memory = await chat.currentMemory();
  return {
    stateSummary: summarizeState(state),
    decisionSummary: summarizeDecision(decision),
    memory: memory?.content ?? null,
    turns: turns.slice(-MAX_TURNS),
  };
}

export async function getChatClient(): Promise<ChatClient> {
  if (process.env.ANTHROPIC_API_KEY) {
    const { ClaudeChatClient } = await import('@peakspan/adapters/claude-chat');
    return new ClaudeChatClient();
  }
  return new StubChatClient();
}

export async function getDistiller(): Promise<MemoryDistiller> {
  if (process.env.ANTHROPIC_API_KEY) {
    const { ClaudeMemoryDistiller } = await import('@peakspan/adapters/claude-chat');
    return new ClaudeMemoryDistiller();
  }
  return new StubMemoryDistiller();
}

/**
 * Distill one conversation's transcript into a new memory version. Failures
 * are logged and swallowed: a memory update must never fail a chat turn.
 */
export async function runDistillation(conversationId: string): Promise<void> {
  try {
    const chat = await getChatStore();
    const messages = await chat.readMessages(conversationId);
    if (messages.length === 0) return;
    const prior = await chat.currentMemory();
    const distiller = await getDistiller();
    const content = await distiller.distill({
      priorMemory: prior?.content ?? null,
      transcript: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    await chat.appendMemoryVersion({
      content,
      sourceConversationId: conversationId,
      coversMessagesThrough: messages[messages.length - 1]!.createdAt,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`Memory distillation failed for ${conversationId}:`, err);
  }
}
