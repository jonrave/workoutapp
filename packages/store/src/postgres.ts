/**
 * Postgres event log. Append-only by construction: the events table takes
 * INSERTs only, and pre-registered thresholds live in their own INSERT-only
 * table (I10) — see migrations/001_init.sql, which also revokes UPDATE and
 * DELETE from the application role.
 */
import pg from 'pg';
import type { EngineEvent } from '@peakspan/engine';
import { ImmutabilityViolation, type EventLog } from './log';

export class PostgresEventLog implements EventLog {
  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string): PostgresEventLog {
    return new PostgresEventLog(new pg.Pool({ connectionString }));
  }

  async append(event: EngineEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO events (id, type, occurred_at, recorded_at, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type, event.occurredAt, event.recordedAt, JSON.stringify(event)],
      );
      if (inserted.rowCount === 0) {
        throw new ImmutabilityViolation(
          `Event ${event.id} already exists; the log is append-only — record a superseding event instead`,
        );
      }
      if (event.type === 'block-start') {
        // INSERT-only table: a second registration for the same block violates
        // the primary key, and the app role has no UPDATE/DELETE grants (I10).
        await client.query(
          `INSERT INTO pre_registered_thresholds
             (block_event_id, metric, direction, value, unit, registered_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            event.id,
            event.preRegisteredThreshold.metric,
            event.preRegisteredThreshold.direction,
            event.preRegisteredThreshold.value,
            event.preRegisteredThreshold.unit,
            event.preRegisteredThreshold.registeredAt,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async read(sinceRecordedAt?: string): Promise<EngineEvent[]> {
    const result = sinceRecordedAt
      ? await this.pool.query(
          'SELECT payload FROM events WHERE recorded_at > $1 ORDER BY recorded_at, id',
          [sinceRecordedAt],
        )
      : await this.pool.query('SELECT payload FROM events ORDER BY recorded_at, id');
    return result.rows.map((r: { payload: EngineEvent }) => r.payload);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
