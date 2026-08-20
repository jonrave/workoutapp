/**
 * Oura adapter — raw signals only (I4). Composite scores (readiness,
 * sleep score, activity score) are deliberately never mapped: they may be
 * stored/displayed by the app layer but carry zero weight in the engine.
 */
import type { RecoverySignalEvent } from '@peakspan/engine';
import { defaultContext, recoverySignal, type EventContext } from './manual';
import { StaticTokenAuth, type OuraAuth } from './oura-auth';

/** Subset of an Oura daily payload we consume. Unknown/composite keys are ignored. */
export interface OuraDaily {
  day: string;
  /** rMSSD in ms; converted to ln rMSSD (the engine's HRV unit, I4). */
  average_hrv?: number;
  resting_heart_rate?: number;
  total_sleep_duration_seconds?: number;
  /** ISO timestamp of mid-sleep. */
  sleep_midpoint?: string;
  sleep_efficiency_pct?: number;
  temperature_deviation?: number;
  /** Present in Oura payloads; NEVER mapped (I4). */
  readiness_score?: number;
  sleep_score?: number;
  activity_score?: number;
}

export function mapOuraDaily(raw: OuraDaily, ctx: EventContext = defaultContext): RecoverySignalEvent[] {
  const occurredAt = `${raw.day}T07:00:00Z`;
  const events: RecoverySignalEvent[] = [];
  const push = (signal: RecoverySignalEvent['signal'], value: number) =>
    events.push(recoverySignal({ signal, value, occurredAt, source: 'device-raw' }, ctx));

  if (raw.average_hrv !== undefined && raw.average_hrv > 0) {
    push('hrvLnRmssd', Math.round(Math.log(raw.average_hrv) * 1000) / 1000);
  }
  if (raw.resting_heart_rate !== undefined) push('restingHr', raw.resting_heart_rate);
  if (raw.total_sleep_duration_seconds !== undefined) {
    push('sleepDurationHours', Math.round((raw.total_sleep_duration_seconds / 3600) * 100) / 100);
  }
  if (raw.sleep_midpoint !== undefined) {
    const d = new Date(raw.sleep_midpoint);
    push('sleepMidpointClockTime', d.getUTCHours() * 60 + d.getUTCMinutes());
  }
  if (raw.sleep_efficiency_pct !== undefined) push('sleepEfficiencyPct', raw.sleep_efficiency_pct);
  if (raw.temperature_deviation !== undefined) push('temperatureDeviation', raw.temperature_deviation);
  // readiness_score / sleep_score / activity_score intentionally dropped (I4).
  return events;
}

/* ------------------------------------------------------------------ */
/* Oura API v2                                                         */
/* ------------------------------------------------------------------ */

/**
 * Subset of an Oura API v2 `/usercollection/sleep` document we consume.
 * `readiness`/scores are present in real payloads and never mapped (I4).
 */
export interface OuraSleepDocV2 {
  day: string;
  /** Average overnight rMSSD in ms. */
  average_hrv?: number | null;
  lowest_heart_rate?: number | null;
  /** Seconds. */
  total_sleep_duration?: number | null;
  bedtime_start?: string;
  bedtime_end?: string;
  /** e.g. 'long_sleep' | 'late_nap' — naps are skipped for nightly signals. */
  type?: string;
}

function midSleepMinutes(startIso: string, endIso: string): number | null {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const mid = new Date((a + b) / 2);
  let m = mid.getHours() * 60 + mid.getMinutes();
  // Normalize so 23:00 (1380) and 03:00 (180 -> 1620) sit on one scale for SD.
  if (m < 720) m += 1440;
  return m;
}

/** Map one v2 sleep document to raw signal events. Naps produce nothing. */
export function mapOuraSleepDocV2(
  doc: OuraSleepDocV2,
  ctx: EventContext = defaultContext,
): RecoverySignalEvent[] {
  if (doc.type && doc.type !== 'long_sleep' && doc.type !== 'sleep') return [];
  const daily: OuraDaily = { day: doc.day };
  if (doc.average_hrv != null && doc.average_hrv > 0) daily.average_hrv = doc.average_hrv;
  if (doc.lowest_heart_rate != null) daily.resting_heart_rate = doc.lowest_heart_rate;
  if (doc.total_sleep_duration != null) daily.total_sleep_duration_seconds = doc.total_sleep_duration;
  const events = mapOuraDaily(daily, ctx);
  if (doc.bedtime_start && doc.bedtime_end) {
    const mid = midSleepMinutes(doc.bedtime_start, doc.bedtime_end);
    if (mid !== null) {
      events.push(
        recoverySignal(
          { signal: 'sleepMidpointClockTime', value: mid, occurredAt: `${doc.day}T07:00:00Z`, source: 'device-raw' },
          ctx,
        ),
      );
    }
  }
  return events;
}

/**
 * Deterministic ids (`oura_<day>_<signal>`) make pulls idempotent: syncing an
 * overlapping window twice can never duplicate a reading.
 */
export function withDeterministicOuraIds(events: RecoverySignalEvent[]): RecoverySignalEvent[] {
  return events.map((e) => ({ ...e, id: `oura_${e.occurredAt.slice(0, 10)}_${e.signal}` }));
}

/**
 * Subset of an Oura API v2 `/usercollection/daily_readiness` document we
 * consume. The readiness score and contributor subscores are vendor
 * composites: the score is pulled ONLY as a stored observation for the gate
 * artifacts and never becomes an engine event (I4). `temperature_deviation`
 * is the one raw value on this endpoint (degrees Celsius) and does map.
 */
export interface OuraDailyReadinessDocV2 {
  day: string;
  score?: number | null;
  /** Degrees Celsius deviation from personal baseline. */
  temperature_deviation?: number | null;
}

/**
 * Minimal Oura API v2 client. Accepts a static bearer token (a still-live
 * PAT) or an OuraAuth strategy (OAuth2 with single-use refresh rotation).
 * Network stays here at the adapter edge; the engine never sees it (I1).
 */
export class OuraClient {
  private readonly auth: OuraAuth;

  constructor(
    tokenOrAuth: string | OuraAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.auth = typeof tokenOrAuth === 'string' ? new StaticTokenAuth(tokenOrAuth) : tokenOrAuth;
  }

  /** Paged GET over one usercollection endpoint for a date window. */
  private async pullCollection<T>(collection: string, startDate: string, endDate: string): Promise<T[]> {
    const token = await this.auth.accessToken();
    const base = `https://api.ouraring.com/v2/usercollection/${collection}?start_date=${startDate}&end_date=${endDate}`;
    const docs: T[] = [];
    let url: string | null = base;
    while (url) {
      const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Oura API ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { data?: T[]; next_token?: string | null };
      docs.push(...(body.data ?? []));
      url = body.next_token ? `${base}&next_token=${body.next_token}` : null;
    }
    return docs;
  }

  /** Raw sleep period documents (naps included; callers filter). */
  async pullSleepDocs(startDate: string, endDate: string): Promise<OuraSleepDocV2[]> {
    return this.pullCollection<OuraSleepDocV2>('sleep', startDate, endDate);
  }

  /** Raw daily readiness documents (score kept as observation only, I4). */
  async pullDailyReadinessDocs(startDate: string, endDate: string): Promise<OuraDailyReadinessDocV2[]> {
    return this.pullCollection<OuraDailyReadinessDocV2>('daily_readiness', startDate, endDate);
  }

  async pullSleep(
    startDate: string,
    endDate: string,
    ctx: EventContext = defaultContext,
  ): Promise<RecoverySignalEvent[]> {
    const events: RecoverySignalEvent[] = [];
    for (const doc of await this.pullSleepDocs(startDate, endDate)) {
      events.push(...mapOuraSleepDocV2(doc, ctx));
    }
    return withDeterministicOuraIds(events);
  }
}
