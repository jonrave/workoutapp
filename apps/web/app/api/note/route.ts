/**
 * POST /api/note — free-text → persistent memory in one step. The raw note is
 * always appended verbatim (a NoteEvent), and the structured events parsed
 * from it (I2a) are appended alongside, each validated and linked back via
 * `parsedFrom`. With ANTHROPIC_API_KEY set the Claude parser structures the
 * note; otherwise the deterministic stub keeps the flow working offline.
 *
 * The response tells the user exactly what was recorded, so parsing stays
 * visible even though there is no confirmation step.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  StubNoteParser,
  emptyParsedNote,
  noteToEvents,
  validateEvent,
  type NoteParser,
} from '@peakspan/adapters';
import type { EngineEvent } from '@peakspan/engine';
import { appendEvent, todayIso } from '../../../lib/data';

const bodySchema = z.object({
  text: z.string().min(3).max(10_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

async function getParser(): Promise<NoteParser> {
  if (process.env.ANTHROPIC_API_KEY) {
    const { ClaudeNoteParser } = await import('@peakspan/adapters/claude');
    return new ClaudeNoteParser();
  }
  return new StubNoteParser();
}

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
  const date = body.date ?? todayIso();

  // Parsing may fail (model error, offline); the note itself must still be
  // remembered — persistence of the raw text never depends on the parser.
  const parser = await getParser();
  let parsed;
  try {
    parsed = await parser.parseNote(body.text, date);
  } catch {
    parsed = emptyParsedNote('Saved as a raw note; parsing was unavailable.');
  }

  const { note, events } = noteToEvents(body.text, parsed, date);
  const recorded: Array<{ type: string; label: string }> = [];
  const skipped: string[] = [];

  try {
    validateEvent(note);
    await appendEvent(note);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  for (const event of events) {
    try {
      validateEvent(event);
      await appendEvent(event);
      recorded.push({ type: event.type, label: describe(event) });
    } catch (err) {
      // One implausible extraction must not lose the rest; the raw note is
      // already in the log either way.
      skipped.push(`${event.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    noteId: note.id,
    summary: parsed.summary,
    confidence: parsed.confidence,
    recorded,
    ...(skipped.length ? { skipped } : {}),
  });
}

function describe(event: EngineEvent): string {
  switch (event.type) {
    case 'activity':
      return `${event.modality} · ${event.durationMinutes} min · sRPE ${event.sRPE}`;
    case 'subjective': {
      const parts: string[] = [];
      if (event.soreness !== undefined) parts.push(`soreness ${event.soreness}/10`);
      if (event.pain) parts.push(`${event.pain.site} pain ${event.pain.score}/10`);
      return parts.join(', ') || 'check-in';
    }
    case 'illness':
      return `${event.phase}${event.systemic ? ' (systemic)' : ''}`;
    case 'injury':
      return `${event.site} · ${event.severity}`;
    case 'lever-measurement':
      return `${event.lever} = ${event.value} ${event.unit}`;
    case 'recovery-signal':
      return `sleep ${event.value} h`;
    default:
      return event.type;
  }
}
