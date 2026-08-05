/**
 * Device sync — pulls raw signals from Oura and activities from Strava into
 * the event log. Raw signals only (I4): composite scores never cross this
 * boundary. Idempotent: adapter events carry deterministic ids
 * (oura_<day>_<signal>, strava_<id>), so overlapping windows never duplicate.
 *
 * GET  -> which providers are configured (no secrets echoed).
 * POST -> pull the last 30 days from every configured provider.
 */
import { NextResponse } from 'next/server';
import { OuraClient, StravaClient } from '@peakspan/adapters';
import { appendEvent, readEvents, todayIso } from '../../../lib/data';

export const dynamic = 'force-dynamic';

function providers() {
  return {
    oura: Boolean(process.env.OURA_TOKEN),
    strava: Boolean(
      process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REFRESH_TOKEN,
    ),
  };
}

export async function GET() {
  return NextResponse.json({ providers: providers() });
}

export async function POST() {
  const p = providers();
  if (!p.oura && !p.strava) {
    return NextResponse.json(
      {
        error:
          'No sync providers configured. Set OURA_TOKEN and/or STRAVA_CLIENT_ID + ' +
          'STRAVA_CLIENT_SECRET + STRAVA_REFRESH_TOKEN — see DEPLOY.md.',
      },
      { status: 400 },
    );
  }

  const today = todayIso();
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400_000).toISOString().slice(0, 10);
  const existing = new Set((await readEvents()).map((e) => e.id));
  const errors: string[] = [];
  let ouraAdded = 0;
  let stravaAdded = 0;

  if (p.oura) {
    try {
      const events = await new OuraClient(process.env.OURA_TOKEN!).pullSleep(start, today);
      for (const ev of events) {
        if (existing.has(ev.id)) continue;
        await appendEvent(ev);
        existing.add(ev.id);
        ouraAdded++;
      }
    } catch (err) {
      errors.push(`Oura: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (p.strava) {
    try {
      const after = Math.floor((Date.parse(`${today}T00:00:00Z`) - 30 * 86400_000) / 1000);
      const client = new StravaClient(
        process.env.STRAVA_CLIENT_ID!,
        process.env.STRAVA_CLIENT_SECRET!,
        process.env.STRAVA_REFRESH_TOKEN!,
      );
      const events = await client.pullSince(after);
      for (const ev of events) {
        if (existing.has(ev.id)) continue;
        await appendEvent(ev);
        existing.add(ev.id);
        stravaAdded++;
      }
    } catch (err) {
      errors.push(`Strava: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    added: { oura: ouraAdded, strava: stravaAdded },
    window: { start, end: today },
    ...(errors.length ? { errors } : {}),
  });
}
