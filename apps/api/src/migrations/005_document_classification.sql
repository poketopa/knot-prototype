CREATE TABLE IF NOT EXISTS document_classification_requests (
  user_id UUID NOT NULL REFERENCES users(id),
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS document_classification_changes (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  request_id UUID NOT NULL,
  document_id UUID NOT NULL,
  from_domain_id UUID NOT NULL,
  to_domain_id UUID NOT NULL,
  from_domain_name TEXT NOT NULL,
  to_domain_name TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, request_id) REFERENCES document_classification_requests(user_id, request_id),
  FOREIGN KEY (user_id, document_id) REFERENCES document_tree_documents(user_id, id),
  FOREIGN KEY (user_id, from_domain_id) REFERENCES document_domains(user_id, id),
  FOREIGN KEY (user_id, to_domain_id) REFERENCES document_domains(user_id, id)
);

CREATE INDEX IF NOT EXISTS document_classification_changes_document_idx
  ON document_classification_changes(user_id, document_id, created_at DESC);
