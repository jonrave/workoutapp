/**
 * Oura adapter — raw signals only (I4). Composite scores (readiness,
 * sleep score, activity score) are deliberately never mapped: they may be
 * stored/displayed by the app layer but carry zero weight in the engine.
 */
import type { RecoverySignalEvent } from '@peakspan/engine';
import { defaultContext, recoverySignal, type EventContext } from './manual';

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

/** Strava adapter: interface stub — real integration is deferred, not silently dropped. */
export interface StravaActivityRaw {
  id: number;
  type: string;
  moving_time_seconds: number;
  start_date: string;
  perceived_exertion?: number;
}
