import { NextResponse } from 'next/server';
import { currentDecision } from '../../../lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { decision } = await currentDecision();
  return NextResponse.json(decision);
}
