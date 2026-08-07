import { describe, expect, it } from 'vitest';
import { StubChatClient, StubMemoryDistiller, type ChatContext } from '../src/index';
import { CHAT_SYSTEM_PROMPT } from '../src/claude-chat';

const context = (overrides: Partial<ChatContext> = {}): ChatContext => ({
  stateSummary: 'Age 34, HRV stable, sleep 7.4h.',
  decisionSummary: 'No change detected — do the planned session.',
  memory: null,
  turns: [{ role: 'user', content: 'Why is nothing changing this week?' }],
  ...overrides,
});

describe('stub chat client', () => {
  it('is deterministic and grounds the reply in the decision summary', async () => {
    const client = new StubChatClient();
    const a = await client.reply(context());
    const b = await client.reply(context());
    expect(a).toBe(b);
    expect(a).toContain('No change detected — do the planned session.');
    expect(a).toContain('Why is nothing changing this week?');
  });

  it('says whether durable memory is active', async () => {
    const client = new StubChatClient();
    expect(await client.reply(context())).toContain('No durable memory yet');
    expect(await client.reply(context({ memory: '- Prefers mornings' }))).toContain(
      'Durable memory is active',
    );
  });
});

describe('stub memory distiller', () => {
  it('retains prior memory verbatim and reflects new user turns', async () => {
    const distiller = new StubMemoryDistiller();
    const result = await distiller.distill({
      priorMemory: '- Prefers morning sessions',
      transcript: [
        { role: 'user', content: 'How is my VO2max block going?' },
        { role: 'assistant', content: 'Retest is in two weeks.' },
      ],
    });
    expect(result).toContain('- Prefers morning sessions');
    expect(result).toContain('How is my VO2max block going?');
    expect(result).not.toContain('Retest is in two weeks.'); // assistant turns are not memorized
  });

  it('re-distilling the same conversation does not duplicate bullets', async () => {
    const distiller = new StubMemoryDistiller();
    const transcript = [{ role: 'user' as const, content: 'How is my VO2max block going?' }];
    const first = await distiller.distill({ priorMemory: null, transcript });
    const second = await distiller.distill({ priorMemory: first, transcript });
    expect(second).toBe(first);
  });

  it('starts from nothing when there is no prior memory', async () => {
    const distiller = new StubMemoryDistiller();
    const result = await distiller.distill({
      priorMemory: null,
      transcript: [{ role: 'user', content: 'Hello' }],
    });
    expect(result).toBe('- Asked: Hello');
  });
});

describe('chat guardrails (I2c / anti-features)', () => {
  it('the system prompt forbids prescribing training and claiming writes', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never prescribe/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/sets, reps, intensity, modality, or rest/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never claim to have logged/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/no moralizing/i);
  });
});
