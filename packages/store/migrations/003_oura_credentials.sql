-- Oura OAuth credentials. One row, updated in place on every refresh: this
-- table is deliberately NOT append-only. Oura refresh tokens are single use,
-- so only the newest pair is live and keeping dead tokens around is pure
-- attack surface. The sync job persists the rotated pair here before making
-- any data request and aborts the run if the write fails.

CREATE TABLE IF NOT EXISTS oura_credentials (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
