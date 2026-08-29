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
import {
  aerobicSessionFromStream,
  mapStravaActivity,
  OuraClient,
  StravaClient,
  stravaEnvironment,
} from '@peakspan/adapters';
import { appendEvent, latestCalibration, readEvents, todayIso } from '../../../lib/data';

export const dynamic = 'force-dynamic';

function providers() {
  return {
    oura: Boolean(process.env.OURA_TOKEN),
    strava: Boolean(
      process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REFRESH_TOKEN,
    ),
  };
}

/**
 * GET normally reports configuration. Vercel cron jobs can only issue GETs,
 * so a request carrying the `x-vercel-cron` header (or `?run=1`) runs the
 * sync instead — same idempotent pull, safe on any schedule.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get('x-vercel-cron') !== null || url.searchParams.get('run') === '1') {
    return runSync();
  }
  return NextResponse.json({ providers: providers() });
}

export async function POST() {
  return runSync();
}

async function runSync() {
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
  let streamsComputed = 0;

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
      const raws = await client.pullRawSince(after);
      for (const raw of raws) {
        const ev = mapStravaActivity(raw);
        if (!ev) continue;
        if (!existing.has(ev.id)) {
          await appendEvent(ev);
          existing.add(ev.id);
          stravaAdded++;
        }
        // Aerobic ledger: raw HR streams for modalities with a personal band
        // calibration (I9 — no calibration, no band math; device zone labels
        // never cross this boundary). Deterministic id keeps re-syncs
        // idempotent.
        const aerobicId = `aerobic_${ev.id}`;
        if (existing.has(aerobicId)) continue;
        const calibration = await latestCalibration(ev.modality);
        if (!calibration) continue;
        const stream = await client.pullStreams(raw.id);
        if (!stream) continue;
        const session = aerobicSessionFromStream({
          stream,
          modality: ev.modality,
          calibration,
          occurredAt: ev.occurredAt,
          activityId: ev.id,
          environment: stravaEnvironment(raw),
        });
        await appendEvent(session);
        existing.add(aerobicId);
        streamsComputed++;
      }
    } catch (err) {
      errors.push(`Strava: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    added: { oura: ouraAdded, strava: stravaAdded, aerobicSessions: streamsComputed },
    window: { start, end: today },
    ...(errors.length ? { errors } : {}),
  });
}
