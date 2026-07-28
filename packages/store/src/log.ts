/**
 * Append-only event log (contract Step 5). Corrections are new superseding
 * events; nothing is ever mutated or deleted. Pre-registered block thresholds
 * are immutable once written (I10) — enforced here and, in Postgres, by an
 * INSERT-only table.
 */
import type { EngineEvent } from '@peakspan/engine';

export interface EventLog {
  append(event: EngineEvent): Promise<void>;
  /** Events in append order, optionally only those recorded after `sinceRecordedAt`. */
  read(sinceRecordedAt?: string): Promise<EngineEvent[]>;
}

export class ImmutabilityViolation extends Error {}

export class InMemoryEventLog implements EventLog {
  private readonly events: EngineEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly registeredBlocks = new Set<string>();

  async append(event: EngineEvent): Promise<void> {
    if (this.ids.has(event.id)) {
      throw new ImmutabilityViolation(
        `Event ${event.id} already exists; the log is append-only — record a superseding event instead`,
      );
    }
    if (event.type === 'block-start') {
      // One registration per block; a threshold can never be re-registered (I10).
      if (this.registeredBlocks.has(event.id)) {
        throw new ImmutabilityViolation(`Block ${event.id} threshold is already registered (I10)`);
      }
      this.registeredBlocks.add(event.id);
    }
    this.ids.add(event.id);
    this.events.push(structuredClone(event));
  }

  async read(sinceRecordedAt?: string): Promise<EngineEvent[]> {
    const all = this.events.map((e) => structuredClone(e));
    return sinceRecordedAt ? all.filter((e) => e.recordedAt > sinceRecordedAt) : all;
  }
}
