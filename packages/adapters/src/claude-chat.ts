/**
 * Claude-backed chat and memory distillation (I2c: explanation on demand).
 * Lives behind its own subpath like ./claude: the engine and store never
 * import this file, so no LLM can enter the decision path (I2). The model is
 * given no tools — it structurally cannot write events, and the system prompt
 * forbids it from prescribing training.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ChatClient, ChatContext, DistillInput, MemoryDistiller } from './chat';

/** Exported as a constant so tests can assert the guardrails never regress. */
export const CHAT_SYSTEM_PROMPT = `You are the explanation surface of Peakspan, a training-decision app whose
prescriptions come from a deterministic engine, never from you.

Hard rules, no exceptions:
- Never prescribe, generate, or modify workouts, sets, reps, intensity, modality, or rest.
  If asked for a workout or a plan change, explain what the standing plan says and why, and
  point the user at the Plan page. The engine decides; you explain.
- Never claim to have logged, saved, changed, or scheduled anything. You have no tools and
  cannot write data. To log an activity the user should use the Log page.
- Ground every answer in the provided context: the state summary, today's decision, the
  durable memory, and the conversation. If the context does not contain the answer, say so
  rather than guessing.
- "No change detected" is the system working, not a failure: most weeks the right output is
  the standing plan, and signals below their smallest detectable change are noise.
- No moralizing about missed sessions, and no streak talk.

Be concise, concrete, and honest about uncertainty and measurement error.`;

export class ClaudeChatClient implements ChatClient {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model = 'claude-opus-5',
  ) {}

  async reply(context: ChatContext): Promise<string> {
    const system = [
      CHAT_SYSTEM_PROMPT,
      context.memory ? `Durable memory (distilled from past conversations):\n${context.memory}` : null,
      `Current state:\n${context.stateSummary}`,
      `Today's decision:\n${context.decisionSummary}`,
    ]
      .filter((s): s is string => s !== null)
      .map((text) => ({ type: 'text' as const, text }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system,
      messages: context.turns.map((t) => ({ role: t.role, content: t.content })),
    });
    if (response.stop_reason === 'refusal') {
      return 'I can’t help with that request.';
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (!text) {
      throw new Error('Chat reply failed: no text content returned');
    }
    return text;
  }
}

const DistilledMemorySchema = z.object({
  memory: z
    .string()
    .describe('The full replacement durable-memory document, markdown bullets, ~400 words max'),
});

const DISTILL_SYSTEM = `You maintain the durable-memory document for a training app's chat assistant.
Given the prior memory and a conversation transcript, rewrite the document wholesale.

Keep: stable facts about the user, stated preferences, decisions made in conversation,
open questions, and corrections to earlier memory. Merge duplicates, drop chit-chat.
Stay under roughly 400 words — compress older material before dropping it.

Never store workout prescriptions, programming advice, or set/rep/intensity schemes,
even if they appear in the transcript: prescriptions belong to the engine, and memory
must not smuggle them into future conversations.`;

export class ClaudeMemoryDistiller implements MemoryDistiller {
  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model = 'claude-opus-5',
  ) {}

  async distill(input: DistillInput): Promise<string> {
    const transcript = input.transcript
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n\n');
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      system: DISTILL_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Prior memory:\n${input.priorMemory ?? '(none yet)'}\n\nTranscript:\n${transcript}`,
        },
      ],
      output_config: { format: zodOutputFormat(DistilledMemorySchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error('Memory distillation failed: no structured output returned');
    }
    return parsed.memory;
  }
}
