/**
 * Postgres conversation + memory store. Append-only by construction: all three
 * tables take INSERTs only — see migrations/002_conversations.sql, which also
 * revokes UPDATE and DELETE from the application role. Distilled memory is
 * versioned, never overwritten.
 */
import pg from 'pg';
import { ImmutabilityViolation } from './log';
import type {
  ConversationMeta,
  ConversationStore,
  MemoryStore,
  MemoryVersion,
  StoredChatMessage,
} from './conversations';

/**
 * Idempotent copy of migrations/002_conversations.sql (kept in sync by
 * conversations.test.ts). Embedded so a fresh deployment self-migrates on
 * first touch, matching PostgresEventLog.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations (id),
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_messages_conv_idx
  ON conversation_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS memory_versions (
  version                 integer PRIMARY KEY,
  content                 text NOT NULL,
  source_conversation_id  text REFERENCES conversations (id),
  covers_messages_through timestamptz NOT NULL,
  created_at              timestamptz NOT NULL
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'peakspan_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON conversations, conversation_messages, memory_versions FROM peakspan_app;
    GRANT SELECT, INSERT ON conversations, conversation_messages, memory_versions TO peakspan_app;
  END IF;
END $$;
`;

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date | string;
}

interface MemoryRow {
  version: number;
  content: string;
  source_conversation_id: string | null;
  covers_messages_through: Date | string;
  created_at: Date | string;
}

const toMessage = (r: MessageRow): StoredChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  createdAt: iso(r.created_at),
});

const toMemory = (r: MemoryRow): MemoryVersion => ({
  version: r.version,
  content: r.content,
  sourceConversationId: r.source_conversation_id,
  coversMessagesThrough: iso(r.covers_messages_through),
  createdAt: iso(r.created_at),
});

export class PostgresConversationStore implements ConversationStore, MemoryStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: pg.Pool) {}

  static fromConnectionString(connectionString: string): PostgresConversationStore {
    return new PostgresConversationStore(new pg.Pool({ connectionString }));
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

  async createConversation(meta: ConversationMeta): Promise<void> {
    await this.ensureSchema();
    const inserted = await this.pool.query(
      `INSERT INTO conversations (id, title, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [meta.id, meta.title, meta.createdAt],
    );
    if (inserted.rowCount === 0) {
      throw new ImmutabilityViolation(`Conversation ${meta.id} already exists`);
    }
  }

  async listConversations(): Promise<ConversationMeta[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT id, title, created_at FROM conversations ORDER BY created_at DESC, id DESC',
    );
    return result.rows.map((r: { id: string; title: string; created_at: Date | string }) => ({
      id: r.id,
      title: r.title,
      createdAt: iso(r.created_at),
    }));
  }

  async appendMessage(message: StoredChatMessage): Promise<void> {
    await this.ensureSchema();
    const inserted = await this.pool.query(
      `INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [message.id, message.conversationId, message.role, message.content, message.createdAt],
    );
    if (inserted.rowCount === 0) {
      throw new ImmutabilityViolation(
        `Message ${message.id} already exists; the transcript is append-only`,
      );
    }
  }

  async readMessages(conversationId: string): Promise<StoredChatMessage[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT id, conversation_id, role, content, created_at
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at, id`,
      [conversationId],
    );
    return result.rows.map(toMessage);
  }

  async searchMessages(query: string, limit = 50): Promise<StoredChatMessage[]> {
    await this.ensureSchema();
    // Escape LIKE wildcards so the user's query is a literal substring.
    const escaped = query.replace(/([%_\\])/g, '\\$1');
    const result = await this.pool.query(
      `SELECT id, conversation_id, role, content, created_at
       FROM conversation_messages
       WHERE content ILIKE '%' || $1 || '%'
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [escaped, limit],
    );
    return result.rows.map(toMessage);
  }

  async currentMemory(): Promise<MemoryVersion | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT version, content, source_conversation_id, covers_messages_through, created_at
       FROM memory_versions ORDER BY version DESC LIMIT 1`,
    );
    const row = result.rows[0] as MemoryRow | undefined;
    return row ? toMemory(row) : null;
  }

  async appendMemoryVersion(version: Omit<MemoryVersion, 'version'>): Promise<MemoryVersion> {
    await this.ensureSchema();
    const insert = () =>
      this.pool.query(
        `INSERT INTO memory_versions
           (version, content, source_conversation_id, covers_messages_through, created_at)
         SELECT COALESCE(MAX(version), 0) + 1, $1, $2, $3, $4 FROM memory_versions
         RETURNING version, content, source_conversation_id, covers_messages_through, created_at`,
        [
          version.content,
          version.sourceConversationId,
          version.coversMessagesThrough,
          version.createdAt,
        ],
      );
    let result;
    try {
      result = await insert();
    } catch (err) {
      // Two concurrent distillations can race to the same version number; the
      // primary key catches it and one retry resolves it.
      if ((err as { code?: string }).code !== '23505') throw err;
      result = await insert();
    }
    return toMemory(result.rows[0] as MemoryRow);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
