-- Append-only event log + immutable pre-registered thresholds (contract Step 5, I10).

CREATE TABLE IF NOT EXISTS events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  payload     jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS events_recorded_at_idx ON events (recorded_at);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (type);

-- I10: written before the block runs, immutable thereafter. INSERT-only.
CREATE TABLE IF NOT EXISTS pre_registered_thresholds (
  block_event_id text PRIMARY KEY REFERENCES events (id),
  metric         text NOT NULL,
  direction      text NOT NULL CHECK (direction IN ('increase', 'decrease')),
  value          double precision NOT NULL,
  unit           text NOT NULL,
  registered_at  timestamptz NOT NULL
);

-- Run as a privileged role; the application role (peakspan_app) gets inserts
-- and reads only. Corrections to events are superseding events, never edits.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'peakspan_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON events FROM peakspan_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON pre_registered_thresholds FROM peakspan_app;
    GRANT SELECT, INSERT ON events, pre_registered_thresholds TO peakspan_app;
  END IF;
END $$;
