ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_check
  CHECK (kind IN ('wav', 'transcript', 'ai_raw', 'ai_analysis', 'ai_partial', 'meeting_summary'));
