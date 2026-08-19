/**
 * Readiness gate: per-day join of the two Oura endpoints that carry the five
 * gate fields, plus the renderers for the two flat artifacts and the
 * idempotent event planner.
 *
 * Field sources (Oura API v2):
 *   readiness score        daily_readiness  data[].score          (observation only, I4)
 *   resting HR (bpm)       sleep            data[].lowest_heart_rate
 *   average HRV (ms)       sleep            data[].average_hrv
 *   temperature deviation  daily_readiness  data[].temperature_deviation (deg C)
 *   total sleep duration   sleep            data[].total_sleep_duration  (seconds)
 *
 * A day with no record from either endpoint is a real fact ("not worn or not
 * synced") and is rendered as an explicit row, never silently omitted: after
 * the fact a reader cannot distinguish a missing row from a missing day.
 *
 * The readiness score is a vendor composite. It is surfaced in the artifacts
 * as a stored observation and is deliberately never emitted as an engine
 * event and never used in any computation here (I4).
 */
import type { EngineEvent, RecoverySignalEvent } from '@peakspan/engine';
import { defaultContext, recoverySignal, type EventContext } from './manual';
import type { OuraDailyReadinessDocV2, OuraSleepDocV2 } from './oura';

/**
 * Gate tunables. The two reference lines are personal empirical values
 * derived from the user's own history; they are NOT validated clinical
 * cutoffs and must never be promoted to `evidence`.
 */
export const GATE_TUNABLES = {
  /** convention: personal resting-HR reference line (bpm) from the user's own history. */
  RHR_REFERENCE_BPM: 46,
  /** convention: personal overnight-HRV reference line (ms rMSSD) from the user's own history. */
  HRV_REFERENCE_MS: 72,
  /** convention: rows shown in gate_current.md. */
  CURRENT_WINDOW_DAYS: 14,
  /** convention: rows kept in gate_series.csv for trend work. */
  SERIES_WINDOW_DAYS: 180,
  /** convention: staleness banner threshold, hours between generated_at and the end of the newest recorded day. */
  STALE_AFTER_HOURS: 36,
} as const;

export interface GateDay {
  day: string;
  /** False when neither endpoint returned a record for this date. */
  present: boolean;
  score: number | null;
  rhrBpm: number | null;
  hrvMs: number | null;
  temperatureDeviation: number | null;
  sleepHours: number | null;
}

function isNightlySleep(doc: OuraSleepDocV2): boolean {
  return !doc.type || doc.type === 'long_sleep' || doc.type === 'sleep';
}

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400_000).toISOString().slice(0, 10);
}

/**
 * Join sleep and readiness documents into one row per calendar day over
 * [endDay - windowDays + 1, endDay]. When a day has several nightly sleep
 * periods the longest one wins (deterministic, independent of API order).
 */
export function buildGateDays(
  sleepDocs: OuraSleepDocV2[],
  readinessDocs: OuraDailyReadinessDocV2[],
  endDay: string,
  windowDays: number,
): GateDay[] {
  const sleepByDay = new Map<string, OuraSleepDocV2>();
  for (const doc of sleepDocs) {
    if (!isNightlySleep(doc)) continue;
    const prev = sleepByDay.get(doc.day);
    if (!prev || (doc.total_sleep_duration ?? 0) > (prev.total_sleep_duration ?? 0)) {
      sleepByDay.set(doc.day, doc);
    }
  }
  const readinessByDay = new Map(readinessDocs.map((d) => [d.day, d]));

  const days: GateDay[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const day = addDays(endDay, -i);
    const sleep = sleepByDay.get(day);
    const readiness = readinessByDay.get(day);
    if (!sleep && !readiness) {
      days.push({
        day,
        present: false,
        score: null,
        rhrBpm: null,
        hrvMs: null,
        temperatureDeviation: null,
        sleepHours: null,
      });
      continue;
    }
    days.push({
      day,
      present: true,
      score: readiness?.score ?? null,
      rhrBpm: sleep?.lowest_heart_rate ?? null,
      hrvMs: sleep?.average_hrv ?? null,
      temperatureDeviation: readiness?.temperature_deviation ?? null,
      sleepHours:
        sleep?.total_sleep_duration != null
          ? Math.round((sleep.total_sleep_duration / 3600) * 100) / 100
          : null,
    });
  }
  return days;
}

const fmt = (v: number | null, digits = 1): string => (v == null ? '' : v.toFixed(digits));

/**
 * Age used by the staleness banner: hours from the END of the newest
 * recorded day (its midnight UTC rollover, the earliest moment that day is
 * complete) to generated_at. A record for yesterday rendered this morning is
 * therefore a few hours old, not ~30.
 */
export function newestRecordAgeHours(days: GateDay[], generatedAt: string): number | null {
  const newest = [...days].reverse().find((d) => d.present);
  if (!newest) return null;
  const dayEnd = Date.parse(`${newest.day}T00:00:00Z`) + 86400_000;
  return (Date.parse(generatedAt) - dayEnd) / 3600_000;
}

/** gate_current.md: generated_at first line, newest day first, explicit gap rows. */
export function renderGateCurrentMd(days: GateDay[], generatedAt: string): string {
  const lines: string[] = [`generated_at: ${generatedAt}`, ''];

  const age = newestRecordAgeHours(days, generatedAt);
  if (age === null) {
    lines.push(`STALE: no Oura records in the last ${days.length} days.`, '');
  } else if (age > GATE_TUNABLES.STALE_AFTER_HOURS) {
    const newest = [...days].reverse().find((d) => d.present)!;
    lines.push(
      `STALE: newest record (${newest.day}) is ${Math.floor(age)} hours older than generated_at.`,
      '',
    );
  }

  lines.push(
    '| date | oura score | rhr (bpm) | hrv (ms) | temp dev (C) | sleep (h) |',
    '|---|---|---|---|---|---|',
  );
  for (const d of [...days].reverse()) {
    lines.push(
      d.present
        ? `| ${d.day} | ${fmt(d.score, 0)} | ${fmt(d.rhrBpm, 0)} | ${fmt(d.hrvMs, 0)} | ${fmt(d.temperatureDeviation, 2)} | ${fmt(d.sleepHours, 2)} |`
        : `| ${d.day} | not worn or not synced | | | | |`,
    );
  }

  const latest = [...days].reverse().find((d) => d.present);
  lines.push('', 'Reference comparisons (personal convention lines, not clinical cutoffs):', '');
  if (latest && latest.rhrBpm != null) {
    const delta = latest.rhrBpm - GATE_TUNABLES.RHR_REFERENCE_BPM;
    lines.push(
      `- rhr ${latest.day}: ${latest.rhrBpm} bpm vs reference ${GATE_TUNABLES.RHR_REFERENCE_BPM} bpm (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`,
    );
  } else {
    lines.push('- rhr: no recent value to compare');
  }
  if (latest && latest.hrvMs != null) {
    const delta = latest.hrvMs - GATE_TUNABLES.HRV_REFERENCE_MS;
    lines.push(
      `- hrv ${latest.day}: ${latest.hrvMs} ms vs reference ${GATE_TUNABLES.HRV_REFERENCE_MS} ms (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`,
    );
  } else {
    lines.push('- hrv: no recent value to compare');
  }
  lines.push(
    '',
    'No pass/fail rule is encoded and no precedence between the two signals is',
    'defined; that adjudication is made by hand per session.',
    '',
  );
  return lines.join('\n');
}

/** gate_series.csv: oldest first; gap days carry an explicit status. */
export function renderGateSeriesCsv(days: GateDay[]): string {
  const lines = ['date,oura_score,rhr_bpm,hrv_ms,temp_dev_c,sleep_h,status'];
  for (const d of days) {
    lines.push(
      d.present
        ? `${d.day},${fmt(d.score, 0)},${fmt(d.rhrBpm, 0)},${fmt(d.hrvMs, 0)},${fmt(d.temperatureDeviation, 2)},${fmt(d.sleepHours, 2)},ok`
        : `${d.day},,,,,,not_worn_or_not_synced`,
    );
  }
  return lines.join('\n') + '\n';
}

/** The raw gate metrics that become engine events. The score never does (I4). */
const GATE_SIGNALS = [
  ['restingHr', (d: GateDay) => d.rhrBpm],
  ['hrvLnRmssd', (d: GateDay) => (d.hrvMs != null && d.hrvMs > 0 ? Math.round(Math.log(d.hrvMs) * 1000) / 1000 : null)],
  ['sleepDurationHours', (d: GateDay) => d.sleepHours],
  ['temperatureDeviation', (d: GateDay) => d.temperatureDeviation],
] as const;

/**
 * Plan the events a sync run should append, given everything already in the
 * log. Idempotent on (day, signal): an unchanged value plans nothing.
 *
 * Supersede policy (recorded decision): Oura revises overnight data after
 * initial sync, and the API is the source of truth, so a later value for a
 * date that already has an event SUPERSEDES the earlier one. The log stays
 * append-only: the revision is a new event with id
 * `oura_<day>_<signal>_rev<n>`, and the projector's last-event-of-day-wins
 * fold (store/src/project.ts) makes the newest revision effective while the
 * full history stays in the log.
 */
export function planGateEvents(
  existing: EngineEvent[],
  days: GateDay[],
  ctx: EventContext = defaultContext,
): RecoverySignalEvent[] {
  const byBaseId = new Map<string, { count: number; lastValue: number }>();
  for (const e of existing) {
    if (e.type !== 'recovery-signal') continue;
    const m = /^(oura_\d{4}-\d{2}-\d{2}_[A-Za-z]+?)(_rev\d+)?$/.exec(e.id);
    const base = m?.[1];
    if (!base) continue;
    const entry = byBaseId.get(base);
    if (entry) {
      entry.count += 1;
      entry.lastValue = e.value;
    } else {
      byBaseId.set(base, { count: 1, lastValue: e.value });
    }
  }

  const planned: RecoverySignalEvent[] = [];
  for (const d of days) {
    if (!d.present) continue;
    for (const [signal, pick] of GATE_SIGNALS) {
      const value = pick(d);
      if (value == null) continue;
      const baseId = `oura_${d.day}_${signal}`;
      const seen = byBaseId.get(baseId);
      if (seen && seen.lastValue === value) continue;
      const event = recoverySignal(
        { signal, value, occurredAt: `${d.day}T07:00:00Z`, source: 'device-raw' },
        ctx,
      );
      planned.push({ ...event, id: seen ? `${baseId}_rev${seen.count}` : baseId });
    }
  }
  return planned;
}
