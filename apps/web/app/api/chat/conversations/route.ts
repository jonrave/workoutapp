/** GET /api/chat/conversations — all conversations, newest first. */
import { NextResponse } from 'next/server';
import { getChatStore } from '../../../../lib/data';

export async function GET() {
  const chat = await getChatStore();
  return NextResponse.json(await chat.listConversations());
}
