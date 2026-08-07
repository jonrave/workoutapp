/**
 * Chat + memory distillation interfaces (I2c: explanation on demand). A chat
 * model may explain the standing plan, the decision trace, and the data — it
 * never chooses sets, reps, intensity, modality, or rest, and nothing it says
 * enters the event log or the engine. The stubs keep the whole flow working
 * offline; the Claude implementations live in ./claude-chat behind their own
 * subpath so the SDK never enters the default import graph.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Everything the chat model is given. Assembled by the app layer, read-only. */
export interface ChatContext {
  /** Deterministic prose summary of the current UserState. */
  stateSummary: string;
  /** Deterministic prose rendering of today's Decision (I2b). */
  decisionSummary: string;
  /** Latest distilled durable-memory document, or null before the first one. */
  memory: string | null;
  /** The current conversation including the newest user turn. */
  turns: ChatTurn[];
}

export interface ChatClient {
  reply(context: ChatContext): Promise<string>;
}

export interface DistillInput {
  priorMemory: string | null;
  transcript: ChatTurn[];
}

/** Returns the full replacement memory document, not a diff. */
export interface MemoryDistiller {
  distill(input: DistillInput): Promise<string>;
}

/**
 * Deterministic offline chat: grounds every reply in the decision summary it
 * was given, so the demo shows real context flowing without an API key.
 */
export class StubChatClient implements ChatClient {
  async reply(context: ChatContext): Promise<string> {
    const lastUser = [...context.turns].reverse().find((t) => t.role === 'user');
    const memoryNote = context.memory
      ? 'Durable memory is active — see the memory panel for exactly what is stored.'
      : 'No durable memory yet — it builds up as we talk.';
    return [
      `You asked: "${lastUser?.content ?? ''}"`,
      '',
      `Today's decision: ${context.decisionSummary}`,
      '',
      memoryNote,
      '',
      '(Offline stub reply — set ANTHROPIC_API_KEY for real answers.)',
    ].join('\n');
  }
}

/**
 * Deterministic offline distiller: keeps the prior memory verbatim and adds
 * one bullet per new user turn. Crude on purpose — the point is the interface
 * and the version chain, not the summarization.
 */
export class StubMemoryDistiller implements MemoryDistiller {
  async distill(input: DistillInput): Promise<string> {
    const bullets = input.transcript
      .filter((t) => t.role === 'user')
      .map((t) => `- Asked: ${t.content.slice(0, 120)}`);
    const prior = input.priorMemory?.trim();
    return [prior, ...bullets].filter(Boolean).join('\n');
  }
}
