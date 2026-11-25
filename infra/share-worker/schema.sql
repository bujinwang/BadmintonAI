-- Plan-B share service: an index of what exists, not a copy of it.
-- Blobs live in R2; this database only knows where and how big.

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,               -- device id (v1) / Apple user id (later)
  match_id     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);

CREATE TABLE IF NOT EXISTS assets (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                 -- closed set, see ASSET_NAMES in index.ts
  key        TEXT NOT NULL,                 -- R2 object key
  bytes      INTEGER NOT NULL,              -- 0 until the upload is confirmed
  sha256     TEXT,                          -- from the client, so the manifest can be trusted
  PRIMARY KEY (session_id, name)
);

CREATE TABLE IF NOT EXISTS shares (
  token      TEXT PRIMARY KEY,              -- 128-bit hex; the link IS this token
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER                        -- set to kill the link; media dies with it
);

CREATE INDEX IF NOT EXISTS idx_shares_session ON shares(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner, created_at DESC);
