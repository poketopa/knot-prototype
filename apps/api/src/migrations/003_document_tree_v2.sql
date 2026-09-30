CREATE TABLE IF NOT EXISTS document_domains (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS document_tree_documents (
  id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  domain_id UUID NOT NULL,
  title TEXT NOT NULL,
  overview TEXT,
  recording_id UUID NOT NULL,
  recording_started_at TIMESTAMPTZ NOT NULL,
  transcript_artifact_id UUID NOT NULL,
  analysis_artifact_id UUID NOT NULL,
  latest_snapshot_id UUID,
  latest_version INTEGER NOT NULL DEFAULT 0,
  legacy_document_id UUID,
  legacy_contribution_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, id, latest_snapshot_id),
  UNIQUE (user_id, legacy_contribution_id),
  FOREIGN KEY (user_id, domain_id) REFERENCES document_domains(user_id, id),
  FOREIGN KEY (user_id, recording_id) REFERENCES recordings(user_id, id),
  FOREIGN KEY (user_id, transcript_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, analysis_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, legacy_document_id) REFERENCES domain_documents(user_id, id),
  FOREIGN KEY (user_id, legacy_contribution_id) REFERENCES document_contributions(user_id, id)
);

CREATE TABLE IF NOT EXISTS document_tree_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  document_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  body JSONB NOT NULL,
  recording_id UUID NOT NULL,
  transcript_artifact_id UUID NOT NULL,
  analysis_artifact_id UUID NOT NULL,
  legacy_snapshot_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, document_id, version),
  UNIQUE (user_id, id, document_id),
  FOREIGN KEY (user_id, document_id) REFERENCES document_tree_documents(user_id, id),
  FOREIGN KEY (user_id, recording_id) REFERENCES recordings(user_id, id),
  FOREIGN KEY (user_id, transcript_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, analysis_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, legacy_snapshot_id) REFERENCES document_snapshots(user_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'document_tree_documents_latest_snapshot_fk'
  ) THEN
    ALTER TABLE document_tree_documents
      ADD CONSTRAINT document_tree_documents_latest_snapshot_fk
      FOREIGN KEY (user_id, latest_snapshot_id, id)
      REFERENCES document_tree_snapshots(user_id, id, document_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS document_domains_name_idx
  ON document_domains(user_id, normalized_name);

CREATE INDEX IF NOT EXISTS document_tree_documents_domain_idx
  ON document_tree_documents(user_id, domain_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS document_tree_documents_recording_idx
  ON document_tree_documents(user_id, recording_id);
