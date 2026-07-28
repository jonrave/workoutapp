/**
 * POST /api/parse — free-text → DRAFT activity (I2a). The draft is returned
 * to the user for confirmation; only the confirmed event is ever appended
 * (via /api/events). With ANTHROPIC_API_KEY set the Claude parser is used;
 * otherwise the deterministic stub keeps the flow working offline.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { StubActivityParser, type ActivityParser } from '@peakspan/adapters';

const bodySchema = z.object({ text: z.string().min(3), date: z.string() });

async function getParser(): Promise<ActivityParser> {
  if (process.env.ANTHROPIC_API_KEY) {
    const { ClaudeActivityParser } = await import('@peakspan/adapters/claude');
    return new ClaudeActivityParser();
  }
  return new StubActivityParser();
}

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
  const parser = await getParser();
  const draft = await parser.parse(body.text, body.date);
  return NextResponse.json(draft);
}
