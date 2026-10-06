ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check
  CHECK (kind IN ('wav', 'transcript', 'ai_raw', 'ai_analysis', 'ai_partial', 'meeting_summary', 'ai_comparison'));

CREATE TABLE IF NOT EXISTS recording_summary_preferences (
  user_id UUID NOT NULL,
  recording_id UUID NOT NULL,
  comparison_artifact_id UUID NOT NULL,
  selected_analysis_artifact_id UUID NOT NULL,
  rejected_analysis_artifact_id UUID NOT NULL,
  candidate_a_analysis_artifact_id UUID NOT NULL,
  candidate_b_analysis_artifact_id UUID NOT NULL,
  transcript_artifact_id UUID NOT NULL,
  selected_variant TEXT NOT NULL CHECK (selected_variant IN ('A', 'B')),
  first_variant TEXT NOT NULL CHECK (first_variant IN ('A', 'B')),
  reason TEXT NOT NULL CHECK (reason IN ('decisions_actions', 'accuracy', 'readability', 'other')),
  meeting_type TEXT NOT NULL CHECK (meeting_type IN ('multi_agenda', 'interview_feedback', 'introduction_sharing')),
  other_reason TEXT CHECK (other_reason IS NULL OR char_length(other_reason) <= 500),
  selection JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recording_id, comparison_artifact_id),
  UNIQUE (user_id, recording_id),
  FOREIGN KEY (user_id, recording_id) REFERENCES recordings(user_id, id),
  FOREIGN KEY (user_id, comparison_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, selected_analysis_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, rejected_analysis_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, candidate_a_analysis_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, candidate_b_analysis_artifact_id) REFERENCES artifacts(user_id, id),
  FOREIGN KEY (user_id, transcript_artifact_id) REFERENCES artifacts(user_id, id)
);

CREATE INDEX IF NOT EXISTS recording_summary_preferences_selected_idx
  ON recording_summary_preferences(user_id, selected_analysis_artifact_id);
