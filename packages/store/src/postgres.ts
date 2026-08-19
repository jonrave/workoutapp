/**
 * Postgres event log. Append-only by construction: the events table takes
 * INSERTs only, and pre-registered thresholds live in their own INSERT-only
 * table (I10) — see migrations/001_init.sql, which also revokes UPDATE and
 * DELETE from the application role.
 */
import pg from 'pg';
import type { EngineEvent } from '@peakspan/engine';
import { ImmutabilityViolation, type EventLog } from './log';

// Re-exported here so the app layer keeps a single deferred postgres import.
export { PostgresConversationStore } from './postgres-conversations';
export { PostgresOuraCredentialStore } from './postgres-credentials';

/**
 * Idempotent copy of migrations/001_init.sql (kept in sync by
 * store.test.ts). Embedded so a fresh deployment self-migrates on first
 * touch: attaching a database is the only manual step. Safe to run on every
 * cold start — every statement is IF NOT EXISTS / conditional.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  payload     jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS events_recorded_at_idx ON events (recorded_at);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (type);

CREATE TABLE IF NOT EXISTS pre_registered_thresholds (
  block_event_id text PRIMARY KEY REFERENCES events (id),
  metric         text NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('increase', 'decrease')),
  value          double precision NOT NULL,
  unit           text NOT NULL,
  registered_at  timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'peakspan_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON events FROM peakspan_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON pre_registered_thresholds FROM peakspan_app;
    GRANT SELECT, INSERT ON events, pre_registered_thresholds TO peakspan_app;
  END IF;
END $$;
`;

export class PostgresEventLog implements EventLog {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string): PostgresEventLog {
    return new PostgresEventLog(new pg.Pool({ connectionString }));
  }

  /** Runs once per process; a failure resets so the next call retries. */
  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(SCHEMA_SQL)
        .then(() => undefined)
        .catch((err) => {
          this.schemaReady = null;
          throw err;
        });
    }
    return this.schemaReady;
  }

  async append(event: EngineEvent): Promise<void> {
    await this.ensureSchema();
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
    await this.ensureSchema();
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
