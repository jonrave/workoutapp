/**
 * Oura readiness-gate sync. Run by the GitHub Actions cron (and by hand via
 * `npm run oura:sync`). One run:
 *
 *   1. authenticates (static OURA_TOKEN if set, else OAuth2 with single-use
 *      refresh rotation persisted to Postgres BEFORE any data request),
 *   2. pulls 180 days of sleep and daily_readiness documents,
 *   3. rewrites data/oura/gate_current.md and data/oura/gate_series.csv in
 *      full (the API is the source of truth; re-derivation over
 *      reconciliation),
 *   4. appends raw gate signals to the event log, idempotent on
 *      (day, signal), with revisions superseding via the projector's
 *      last-event-wins fold.
 *
 * Fails loudly (non-zero exit) on auth failure, credential persistence
 * failure, and an empty API response. The readiness score goes to the
 * artifacts only and never becomes an engine event (I4).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GATE_TUNABLES,
  OuraClient,
  OuraOAuth,
  StaticTokenAuth,
  buildGateDays,
  planGateEvents,
  renderGateCurrentMd,
  renderGateSeriesCsv,
  type OuraAuth,
} from '@peakspan/adapters';
import { ImmutabilityViolation } from '@peakspan/store';
import { PostgresEventLog, PostgresOuraCredentialStore } from '@peakspan/store/postgres';

function resolveAuth(): { auth: OuraAuth; credentialStore: PostgresOuraCredentialStore | null } {
  if (process.env.OURA_TOKEN) {
    return { auth: new StaticTokenAuth(process.env.OURA_TOKEN), credentialStore: null };
  }
  const { OURA_CLIENT_ID, OURA_CLIENT_SECRET, DATABASE_URL } = process.env;
  if (OURA_CLIENT_ID && OURA_CLIENT_SECRET && DATABASE_URL) {
    const store = PostgresOuraCredentialStore.fromConnectionString(DATABASE_URL);
    return { auth: new OuraOAuth(OURA_CLIENT_ID, OURA_CLIENT_SECRET, store), credentialStore: store };
  }
  throw new Error(
    'No Oura auth configured. Set OURA_TOKEN (still-live PAT), or OURA_CLIENT_ID + ' +
      'OURA_CLIENT_SECRET + DATABASE_URL for OAuth (seed credentials once with ' +
      'scripts/oura-auth-helper.ts).',
  );
}

async function main(): Promise<void> {
  const { auth, credentialStore } = resolveAuth();
  const outputDir = process.env.GATE_OUTPUT_DIR ?? 'data/oura';

  // Rotation happens here, before any data request; TokenPersistenceError
  // propagates and the run dies with a non-zero exit.
  await auth.accessToken();

  const generatedAt = new Date().toISOString();
  const endDay = generatedAt.slice(0, 10);
  const startDay = new Date(Date.parse(`${endDay}T00:00:00Z`) - (GATE_TUNABLES.SERIES_WINDOW_DAYS - 1) * 86400_000)
    .toISOString()
    .slice(0, 10);

  const client = new OuraClient(auth);
  const [sleepDocs, readinessDocs] = [
    await client.pullSleepDocs(startDay, endDay),
    await client.pullDailyReadinessDocs(startDay, endDay),
  ];
  if (sleepDocs.length === 0 && readinessDocs.length === 0) {
    throw new Error(
      `Oura returned zero records for ${startDay}..${endDay}. A ${GATE_TUNABLES.SERIES_WINDOW_DAYS}-day ` +
        'window with no data means auth, scope, or account trouble, not an empty life; refusing to ' +
        'write empty artifacts over good ones.',
    );
  }

  const seriesDays = buildGateDays(sleepDocs, readinessDocs, endDay, GATE_TUNABLES.SERIES_WINDOW_DAYS);
  const currentDays = seriesDays.slice(-GATE_TUNABLES.CURRENT_WINDOW_DAYS);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'gate_current.md'), renderGateCurrentMd(currentDays, generatedAt));
  await writeFile(path.join(outputDir, 'gate_series.csv'), renderGateSeriesCsv(seriesDays));
  console.log(`Wrote gate_current.md and gate_series.csv to ${outputDir} (window ${startDay}..${endDay})`);

  if (process.env.GATE_SKIP_INGEST === '1') {
    console.log('GATE_SKIP_INGEST=1: skipping event-log ingest.');
  } else {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for event-log ingest (or set GATE_SKIP_INGEST=1).');
    }
    const log = PostgresEventLog.fromConnectionString(process.env.DATABASE_URL);
    try {
      const planned = planGateEvents(await log.read(), seriesDays);
      let appended = 0;
      for (const event of planned) {
        try {
          await log.append(event);
          appended++;
        } catch (err) {
          // Benign race with another idempotent sync path (e.g. /api/sync)
          // inserting the same deterministic id between our read and append.
          if (!(err instanceof ImmutabilityViolation)) throw err;
        }
      }
      console.log(`Ingest: ${appended} event(s) appended (${planned.length} planned).`);
    } finally {
      await log.close();
    }
  }

  await credentialStore?.close();
}

main().catch((err) => {
  console.error(`oura-gate-sync failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
