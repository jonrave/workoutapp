/**
 * Provenance and measurement primitives.
 *
 * Every quantity the engine consumes carries where it came from, when it was
 * last updated, and how noisy it is. Invariant I3 (noise gate) and the
 * staleness rules of contract section 5 both read these fields.
 */

/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Timestamp, RFC 3339 / ISO 8601, e.g. `2026-07-27T06:40:00Z`. */
export type IsoDateTime = string;

/**
 * Where a value came from.
 *
 * Vendor composite scores (Oura Readiness, Whoop Recovery, Body Battery) are
 * deliberately not representable as a source: per invariant I4 they may be
 * stored and displayed by the app layer but never enter engine state.
 */
export type Provenance =
  /** Lab assay or supervised test: GXT, DEXA, bloods. */
  | 'measured-lab'
  /** Self-administered standardized protocol: CMJ median-of-5, home BP 7-day, lactate step. */
  | 'measured-field'
  /** Raw wearable signal: ln rMSSD, resting HR, sleep duration/midpoint/efficiency, temperature deviation (I4). */
  | 'device-raw'
  /** Manual entry: sRPE, soreness, alcohol units, pain scores. */
  | 'user-reported'
  /** Computed from other tracked values: e1RM from rep sets, EWMA loads. */
  | 'derived'
  /** Not this user's data. Wide interval by construction (I8). */
  | 'population-prior';

/**
 * Provenance wrapper for every tracked quantity.
 *
 * `typicalError` is expressed in the units of `value`. The smallest detectable
 * change is derived, never stored: `sdc = 2.77 * typicalError` (I3). A delta
 * that has not cleared its SDC is "no change detected" and may never trigger a
 * plan change.
 *
 * `lastUpdated` drives staleness prompting (section 5): a two-year-old lipid
 * panel is not current data. Refresh cadences live with the measurement
 * module, not here.
 */
export interface Field<T> {
  value: T;
  lastUpdated: IsoDate;
  source: Provenance;
  /**
   * Measurement noise, same units as `value`. Required in practice for any
   * quantity used as a change trigger (I3); optional in the type because some
   * fields (e.g. illness flags, categorical values) have no meaningful error.
   */
  typicalError?: number;
  note?: string;
}

/**
 * Per-pillar trainability estimate (I8, section 7).
 *
 * Defaults to `not-yet-identifiable` and must remain there until several
 * observed blocks support otherwise. Assuming the population mean applies to
 * this user is the error the whole system exists to avoid.
 */
export type TrainabilityEstimate =
  | {
      state: 'not-yet-identifiable';
      /** Completed, retested blocks observed for this pillar so far. */
      blocksObserved: number;
    }
  | {
      state: 'estimated';
      /** Expected fitness delta per unit of cumulative dose, pillar-specific units. */
      mean: number;
      ciLow: number;
      ciHigh: number;
      blocksObserved: number;
    };
