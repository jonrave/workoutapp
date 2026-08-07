/**
 * GET /api/chat/memory — the current distilled-memory version (transparency:
 * the user can always see exactly what the assistant remembers).
 * POST — distill now, on demand, from a given conversation.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getChatStore } from '../../../../lib/data';
import { runDistillation } from '../../../../lib/chat';

export async function GET() {
  const chat = await getChatStore();
  return NextResponse.json(await chat.currentMemory());
}

const bodySchema = z.object({ conversationId: z.string() });

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
  await runDistillation(body.conversationId);
  const chat = await getChatStore();
  return NextResponse.json(await chat.currentMemory());
}
