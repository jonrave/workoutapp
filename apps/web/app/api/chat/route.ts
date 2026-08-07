/**
 * POST /api/chat — one chat turn (I2c: explanation on demand). Persists the
 * user message, assembles read-only context (state + decision + memory),
 * gets the reply, persists it, and schedules distillation after the response.
 *
 * Guardrail: this route imports no event constructors and never calls
 * appendEvent — chat cannot write engine events. The model gets no tools.
 */
import { NextResponse, after } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getChatStore } from '../../../lib/data';
import { assembleChatContext, getChatClient, runDistillation } from '../../../lib/chat';

const bodySchema = z.object({
  conversationId: z.string().nullable(),
  text: z.string().min(1),
});

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  const chat = await getChatStore();
  let conversationId = body.conversationId;
  if (!conversationId) {
    conversationId = `conv_${randomUUID()}`;
    const title = body.text.length > 60 ? `${body.text.slice(0, 60)}…` : body.text;
    await chat.createConversation({ id: conversationId, title, createdAt: new Date().toISOString() });
  }

  const userMessage = {
    id: `msg_${randomUUID()}`,
    conversationId,
    role: 'user' as const,
    content: body.text,
    createdAt: new Date().toISOString(),
  };
  await chat.appendMessage(userMessage);

  const history = await chat.readMessages(conversationId);
  const context = await assembleChatContext(history.map((m) => ({ role: m.role, content: m.content })));
  const client = await getChatClient();

  let replyText: string;
  try {
    replyText = await client.reply(context);
  } catch (err) {
    return NextResponse.json(
      { error: `Chat reply failed: ${String(err)}`, conversationId, messages: [userMessage] },
      { status: 502 },
    );
  }

  const assistantMessage = {
    id: `msg_${randomUUID()}`,
    conversationId,
    role: 'assistant' as const,
    content: replyText,
    createdAt: new Date().toISOString(),
  };
  await chat.appendMessage(assistantMessage);

  // Distill after the response is sent — the reply never waits on memory.
  const id = conversationId;
  after(() => runDistillation(id));

  return NextResponse.json({ conversationId, messages: [userMessage, assistantMessage] });
}
