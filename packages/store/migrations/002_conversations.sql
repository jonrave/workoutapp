-- Persistent conversation memory: full transcripts + versioned distilled memory.
-- Same append-only philosophy as the event log: all three tables are INSERT-only.
-- Chat is I2(c) "explanation on demand"; nothing here feeds the decision path.

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

-- Distilled durable memory: one whole document per version, never edited in
-- place. The latest version is what gets injected into new conversations; the
-- history is the audit trail of what the assistant "remembered" and when.
CREATE TABLE IF NOT EXISTS memory_versions (
  version                 integer PRIMARY KEY,
  content                 text NOT NULL,
  source_conversation_id  text REFERENCES conversations (id),
  covers_messages_through timestamptz NOT NULL,
  created_at              timestamptz NOT NULL
);

-- Run as a privileged role; the application role (peakspan_app) gets inserts
-- and reads only, matching 001_init.sql.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'peakspan_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON conversations, conversation_messages, memory_versions FROM peakspan_app;
    GRANT SELECT, INSERT ON conversations, conversation_messages, memory_versions TO peakspan_app;
  END IF;
END $$;
