/** GET /api/chat/search?q= — case-insensitive substring search over all messages. */
import { NextResponse } from 'next/server';
import { getChatStore } from '../../../../lib/data';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: 'Missing query parameter q' }, { status: 400 });
  }
  const chat = await getChatStore();
  return NextResponse.json(await chat.searchMessages(q));
}
