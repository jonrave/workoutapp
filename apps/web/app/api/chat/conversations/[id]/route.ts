/** GET /api/chat/conversations/:id — one conversation's messages, chronological. */
import { NextResponse } from 'next/server';
import { getChatStore } from '../../../../../lib/data';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChatStore();
  return NextResponse.json(await chat.readMessages(id));
}
