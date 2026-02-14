-- MIG_237: Add handleability field to intake submissions
-- This field determines whether a cat can be brought in via carrier or needs trapping
-- Critical for Beacon colony analytics - helps understand cat behavior patterns

\echo '=== MIG_237: Adding handleability field to intake submissions ==='

-- Add handleability column
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS handleability TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.handleability IS
'Cat handleability assessment: friendly_carrier, shy_handleable, feral_trap, unknown, some_friendly (colony), all_feral (colony)';

-- Add source_system column for tracking intake origin
ALTER TABLE trapper.web_intake_submissions
ADD COLUMN IF NOT EXISTS source_system TEXT;

COMMENT ON COLUMN trapper.web_intake_submissions.source_system IS
'Specific source system (web_intake_receptionist, jotform_public, airtable_sync, etc.)';

-- Create index for handleability analysis (Beacon analytics)
CREATE INDEX IF NOT EXISTS idx_intake_handleability
ON trapper.web_intake_submissions(handleability)
WHERE handleability IS NOT NULL;

-- Create view for Beacon handleability analytics
CREATE OR REPLACE VIEW trapper.v_intake_handleability_stats AS
SELECT
  county,
  handleability,
  ownership_status,
  COUNT(*) as submission_count,
  COUNT(*) FILTER (WHERE has_medical_concerns) as medical_count,
  COUNT(*) FILTER (WHERE is_emergency) as emergency_count,
  AVG(cat_count_estimate) as avg_cat_count
FROM trapper.web_intake_submissions
WHERE handleability IS NOT NULL
GROUP BY county, handleability, ownership_status
ORDER BY county, submission_count DESC;

COMMENT ON VIEW trapper.v_intake_handleability_stats IS
'Beacon analytics: Handleability distribution by county and ownership type';

\echo '=== MIG_237 complete: handleability field added ==='
