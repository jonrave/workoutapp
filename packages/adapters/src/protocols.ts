/**
 * Guided measurement protocols (§8): the app runs the protocol so the input is
 * valid by construction. Each returns EngineEvents via the manual adapter.
 */
import type { FitnessMeasurementEvent, IsoDate, LeverMeasurementEvent } from '@peakspan/engine';
import { defaultContext, fitnessMeasurement, leverMeasurement, type EventContext } from './manual';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * CMJ weekly protocol: exactly 5 jumps, median reported (§8: "weekly, median
 * of 5"), typicalError from the §8 default (~4%).
 */
export function cmjMedianOfFive(
  jumpsCm: number[],
  date: IsoDate,
  ctx: EventContext = defaultContext,
): FitnessMeasurementEvent {
  if (jumpsCm.length !== 5) {
    throw new Error(`CMJ protocol requires exactly 5 jumps, got ${jumpsCm.length}`);
  }
  if (jumpsCm.some((j) => j <= 0 || j > 100)) {
    throw new Error('CMJ jump heights must be in (0, 100] cm');
  }
  return fitnessMeasurement(
    {
      metric: 'cmjHeight',
      value: Math.round(median(jumpsCm) * 10) / 10,
      unit: 'cm',
      occurredAt: `${date}T08:00:00Z`,
      source: 'measured-field',
    },
    ctx,
  );
}

export interface BpSitting {
  /** Readings in the order taken; the first of each sitting is discarded (§5 protocol). */
  readings: Array<{ sbp: number; dbp: number }>;
}

export interface BpDay {
  date: IsoDate;
  morning: BpSitting;
  evening: BpSitting;
}

/**
 * Home BP 7-day protocol (§5): morning and evening sittings, discard the first
 * reading of each sitting, average the rest; the lever value is the mean over
 * all sitting means. Requires at least 5 complete days of the 7 (convention).
 */
export function homeBpProtocol(
  days: BpDay[],
  ctx: EventContext = defaultContext,
): { sbp: LeverMeasurementEvent; dbp: LeverMeasurementEvent } {
  if (days.length < 5 || days.length > 7) {
    throw new Error(`BP protocol requires 5-7 days of readings, got ${days.length}`);
  }
  const sittingMeans: Array<{ sbp: number; dbp: number }> = [];
  for (const day of days) {
    for (const sitting of [day.morning, day.evening]) {
      if (sitting.readings.length < 2) {
        throw new Error(
          `Each sitting needs at least 2 readings (the first is discarded); ${day.date} has ${sitting.readings.length}`,
        );
      }
      const kept = sitting.readings.slice(1);
      sittingMeans.push({
        sbp: kept.reduce((s, r) => s + r.sbp, 0) / kept.length,
        dbp: kept.reduce((s, r) => s + r.dbp, 0) / kept.length,
      });
    }
  }
  const mean = (k: 'sbp' | 'dbp') =>
    Math.round((sittingMeans.reduce((s, m) => s + m[k], 0) / sittingMeans.length) * 10) / 10;
  const occurredAt = `${days[days.length - 1]!.date}T20:00:00Z`;
  return {
    sbp: leverMeasurement(
      { lever: 'homeSBP7d', value: mean('sbp'), unit: 'mmHg', occurredAt, source: 'measured-field' },
      ctx,
    ),
    dbp: leverMeasurement(
      { lever: 'homeDBP7d', value: mean('dbp'), unit: 'mmHg', occurredAt, source: 'measured-field' },
      ctx,
    ),
  };
}
