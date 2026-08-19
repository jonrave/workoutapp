/**
 * Postgres implementation of the Oura credential store. Single row, upserted
 * transactionally: `save` resolves only after COMMIT, which is what lets the
 * sync job treat a resolved save as proof the rotated single-use refresh
 * token survives a crash. See migrations/003_oura_credentials.sql.
 */
import pg from 'pg';
import type { OuraCredentialStore, StoredOuraCredentials } from './credentials';

/**
 * Idempotent copy of migrations/003_oura_credentials.sql (kept in sync by
 * store.test.ts), embedded so a fresh deployment self-migrates on first
 * touch, matching PostgresEventLog.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS oura_credentials (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
`;

export class PostgresOuraCredentialStore implements OuraCredentialStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string): PostgresOuraCredentialStore {
    return new PostgresOuraCredentialStore(new pg.Pool({ connectionString }));
  }

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

  async load(): Promise<StoredOuraCredentials | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT access_token, refresh_token, expires_at FROM oura_credentials WHERE id = 1',
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as { access_token: string; refresh_token: string; expires_at: Date };
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at.getTime(),
    };
  }

  async save(credentials: StoredOuraCredentials): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO oura_credentials (id, access_token, refresh_token, expires_at, updated_at)
       VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE
         SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now()`,
      [credentials.accessToken, credentials.refreshToken, new Date(credentials.expiresAt)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
