CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  github_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ticket_hash TEXT,
  ticket_expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recordings (
  id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  title TEXT,
  metadata_hash TEXT NOT NULL,
  published_analysis_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, id, published_analysis_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID NOT NULL,
  user_id UUID NOT NULL,
  recording_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('wav', 'transcript', 'ai_raw', 'ai_analysis', 'ai_partial')),
  attempt_id TEXT,
  raw_content JSONB,
  storage_key TEXT,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length BIGINT NOT NULL CHECK (byte_length >= 0),
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  completed_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, recording_id, id),
  FOREIGN KEY (user_id, recording_id) REFERENCES recordings(user_id, id)
);

CREATE TABLE IF NOT EXISTS uploads (
  artifact_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  expected_sha256 TEXT NOT NULL,
  expected_byte_length BIGINT NOT NULL,
  receipt JSONB,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artifact_id),
  FOREIGN KEY (user_id, artifact_id) REFERENCES artifacts(user_id, id)
);

CREATE TABLE IF NOT EXISTS domain_documents (
  id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  latest_snapshot_id UUID,
  latest_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, id, latest_snapshot_id)
);

CREATE TABLE IF NOT EXISTS document_contributions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  document_id UUID NOT NULL,
  recording_id UUID NOT NULL,
  analysis_artifact_id UUID NOT NULL,
  section JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, document_id, recording_id),
  FOREIGN KEY (user_id, document_id) REFERENCES domain_documents(user_id, id),
  FOREIGN KEY (user_id, recording_id) REFERENCES recordings(user_id, id),
  FOREIGN KEY (user_id, analysis_artifact_id) REFERENCES artifacts(user_id, id)
);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  document_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  body JSONB NOT NULL,
  trigger_recording_id UUID NOT NULL,
  analysis_artifact_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, document_id, version),
  UNIQUE (user_id, id, document_id),
  FOREIGN KEY (user_id, document_id) REFERENCES domain_documents(user_id, id),
  FOREIGN KEY (user_id, trigger_recording_id) REFERENCES recordings(user_id, id),
  FOREIGN KEY (user_id, analysis_artifact_id) REFERENCES artifacts(user_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'domain_documents_latest_snapshot_fk'
  ) THEN
    ALTER TABLE domain_documents
      ADD CONSTRAINT domain_documents_latest_snapshot_fk
      FOREIGN KEY (user_id, latest_snapshot_id, id)
      REFERENCES document_snapshots(user_id, id, document_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS recording_publishes (
  user_id UUID NOT NULL,
  recording_id UUID NOT NULL,
  analysis_artifact_id UUID NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recording_id, analysis_artifact_id),
  FOREIGN KEY (user_id, recording_id) REFERENCES recordings(user_id, id),
  FOREIGN KEY (user_id, analysis_artifact_id) REFERENCES artifacts(user_id, id)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recording_id UUID,
  document_id UUID,
  version INTEGER,
  attempt_id TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT,
  payload_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS artifacts_recording_idx ON artifacts(user_id, recording_id);
CREATE INDEX IF NOT EXISTS document_contributions_doc_idx ON document_contributions(user_id, document_id, created_at);
CREATE INDEX IF NOT EXISTS document_snapshots_doc_idx ON document_snapshots(user_id, document_id, version);
CREATE INDEX IF NOT EXISTS events_received_idx ON events(user_id, received_at);
