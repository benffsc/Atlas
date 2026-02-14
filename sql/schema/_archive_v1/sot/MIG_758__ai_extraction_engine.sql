\echo '=== MIG_758: AI Extraction Engine - Unified Extraction System ==='
\echo 'Creates triggers and functions for automatic extraction queueing'

-- ============================================================================
-- AI EXTRACTION ENGINE
-- ============================================================================
-- This migration establishes the centralized AI extraction system that:
-- 1. Automatically queues new/updated records for extraction
-- 2. Tracks ALL processed records (even those with no extractions)
-- 3. Provides skip reasons for debugging
-- 4. Supports tiered model selection (Haiku 3 → Haiku 4.5 → Sonnet)

-- ============================================================================
-- 1. ENHANCE EXTRACTION_STATUS TABLE
-- ============================================================================

-- Add skip_reason column to track why records have no extractions
ALTER TABLE trapper.extraction_status
ADD COLUMN IF NOT EXISTS skip_reason TEXT;

COMMENT ON COLUMN trapper.extraction_status.skip_reason IS
'Reason record was processed but no attributes extracted:
 - null: attributes were extracted
 - no_extractable_content: text too short or no relevant keywords
 - api_error: Claude API returned error
 - parse_error: Could not parse JSON response
 - model_refused: Model declined to extract (apologized instead)';

-- Add model_used column
ALTER TABLE trapper.extraction_status
ADD COLUMN IF NOT EXISTS model_used TEXT;

-- Add index for finding records that need re-extraction
CREATE INDEX IF NOT EXISTS idx_extraction_status_skip_reason
ON trapper.extraction_status(skip_reason) WHERE skip_reason IS NOT NULL;

-- ============================================================================
-- 2. EXTRACTION RULES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.ai_extraction_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL UNIQUE,
  source_table TEXT NOT NULL,
  entity_type TEXT NOT NULL,

  -- Keywords that indicate extractable content
  priority_keywords TEXT[] DEFAULT '{}',

  -- Keywords that trigger Sonnet escalation (critical for accuracy)
  sonnet_keywords TEXT[] DEFAULT '{}',

  -- Minimum text length to process
  min_text_length INT DEFAULT 20,

  -- Model preferences
  default_model TEXT DEFAULT 'claude-haiku-4-5-20251001',
  escalation_model TEXT DEFAULT 'claude-sonnet-4-20250514',
  budget_model TEXT DEFAULT 'claude-3-haiku-20240307',

  -- Processing settings
  is_active BOOLEAN DEFAULT true,
  priority INT DEFAULT 50,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.ai_extraction_rules IS
'Configuration for AI extraction by source table. Controls model selection,
keywords for prioritization, and Sonnet escalation triggers.';

-- Insert default rules
INSERT INTO trapper.ai_extraction_rules (
  rule_name, source_table, entity_type,
  priority_keywords, sonnet_keywords, min_text_length
) VALUES
(
  'clinic_appointments',
  'sot_appointments',
  'cat',
  ARRAY['feral', 'friendly', 'aggressive', 'scared', 'sweet', 'pregnant', 'lactating',
        'kitten', 'litter', 'FeLV', 'FIV', 'URI', 'disease', 'sick', 'colony'],
  ARRAY['recapture', 'recheck', 'eartip', 'already tipped', 'previously fixed',
        'litter of', 'kittens', 'pregnant', 'lactating', 'unfixed', 'intact',
        'years feeding', 'trap shy'],
  20
),
(
  'requests',
  'sot_requests',
  'place',
  ARRAY['colony', 'cats', 'kittens', 'feral', 'stray', 'feeding', 'trapping'],
  ARRAY['eartip', 'fixed', 'unfixed', 'litter', 'pregnant', 'hoarding', 'disease'],
  30
),
(
  'web_intakes',
  'web_intake_submissions',
  'place',
  ARRAY['colony', 'cats', 'stray', 'feral', 'feeding', 'kittens'],
  ARRAY['eartip', 'unfixed', 'pregnant', 'emergency', 'disease'],
  30
),
(
  'google_maps',
  'google_map_entries',
  'place',
  ARRAY['colony', 'cats', 'feeding', 'feral'],
  ARRAY['eartip', 'fixed', 'unfixed'],
  20
)
ON CONFLICT (rule_name) DO UPDATE SET
  priority_keywords = EXCLUDED.priority_keywords,
  sonnet_keywords = EXCLUDED.sonnet_keywords,
  updated_at = NOW();

-- ============================================================================
-- 3. AUTOMATIC QUEUEING TRIGGER FOR APPOINTMENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.trigger_queue_appointment_extraction()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue if medical_notes has content AND cat_id exists
  IF NEW.medical_notes IS NOT NULL
     AND LENGTH(NEW.medical_notes) > 20
     AND NEW.cat_id IS NOT NULL THEN
    -- Check if not already in queue or extraction_status
    IF NOT EXISTS (
      SELECT 1 FROM trapper.extraction_queue eq
      WHERE eq.source_table = 'sot_appointments'
        AND eq.source_record_id = NEW.appointment_id::TEXT
        AND eq.completed_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM trapper.extraction_status es
      WHERE es.source_table = 'sot_appointments'
        AND es.source_record_id = NEW.appointment_id::TEXT
    ) THEN
      INSERT INTO trapper.extraction_queue (
        source_table, source_record_id, entity_type, entity_id,
        trigger_reason, priority
      ) VALUES (
        'sot_appointments', NEW.appointment_id::TEXT, 'cat', NEW.cat_id,
        TG_OP, 50
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on sot_appointments
DROP TRIGGER IF EXISTS trg_queue_appointment_extraction ON trapper.sot_appointments;
CREATE TRIGGER trg_queue_appointment_extraction
  AFTER INSERT OR UPDATE OF medical_notes ON trapper.sot_appointments
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_queue_appointment_extraction();

-- ============================================================================
-- 4. AUTOMATIC QUEUEING TRIGGER FOR INTAKES
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.trigger_queue_intake_extraction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.situation_description IS NOT NULL
     AND LENGTH(NEW.situation_description) > 30
     AND NEW.place_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM trapper.extraction_queue eq
      WHERE eq.source_table = 'web_intake_submissions'
        AND eq.source_record_id = NEW.submission_id::TEXT
        AND eq.completed_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM trapper.extraction_status es
      WHERE es.source_table = 'web_intake_submissions'
        AND es.source_record_id = NEW.submission_id::TEXT
    ) THEN
      INSERT INTO trapper.extraction_queue (
        source_table, source_record_id, entity_type, entity_id,
        trigger_reason, priority
      ) VALUES (
        'web_intake_submissions', NEW.submission_id::TEXT, 'place', NEW.place_id,
        TG_OP, 40
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_queue_intake_extraction ON trapper.web_intake_submissions;
CREATE TRIGGER trg_queue_intake_extraction
  AFTER INSERT OR UPDATE OF situation_description ON trapper.web_intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trapper.trigger_queue_intake_extraction();

-- ============================================================================
-- 5. HELPER FUNCTION: CHECK IF RECORD NEEDS EXTRACTION
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.needs_extraction(
  p_source_table TEXT,
  p_source_record_id TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  -- Check if already processed
  IF EXISTS (
    SELECT 1 FROM trapper.extraction_status es
    WHERE es.source_table = p_source_table
      AND es.source_record_id = p_source_record_id
      AND es.needs_reextraction = false
  ) THEN
    RETURN false;
  END IF;

  -- Check if already queued
  IF EXISTS (
    SELECT 1 FROM trapper.extraction_queue eq
    WHERE eq.source_table = p_source_table
      AND eq.source_record_id = p_source_record_id
      AND eq.completed_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. HELPER FUNCTION: SHOULD USE SONNET
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.should_use_sonnet(
  p_text TEXT,
  p_source_table TEXT DEFAULT 'sot_appointments'
) RETURNS BOOLEAN AS $$
DECLARE
  v_keywords TEXT[];
  v_keyword TEXT;
BEGIN
  -- Get Sonnet keywords for this source table
  SELECT sonnet_keywords INTO v_keywords
  FROM trapper.ai_extraction_rules
  WHERE source_table = p_source_table AND is_active = true;

  IF v_keywords IS NULL THEN
    RETURN false;
  END IF;

  -- Check if any keyword matches
  FOREACH v_keyword IN ARRAY v_keywords LOOP
    IF p_text ~* v_keyword THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. VIEW: EXTRACTION ENGINE STATUS
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_ai_extraction_status AS
SELECT
  'Total records processed' as metric,
  COUNT(*)::TEXT as value
FROM trapper.extraction_status

UNION ALL

SELECT
  'Records with extractions',
  COUNT(*)::TEXT
FROM trapper.extraction_status
WHERE attributes_extracted > 0

UNION ALL

SELECT
  'Records skipped (no content)',
  COUNT(*)::TEXT
FROM trapper.extraction_status
WHERE attributes_extracted = 0

UNION ALL

SELECT
  'Pending in queue',
  COUNT(*)::TEXT
FROM trapper.extraction_queue
WHERE completed_at IS NULL

UNION ALL

SELECT
  'Active entity attributes',
  COUNT(*)::TEXT
FROM trapper.entity_attributes
WHERE superseded_at IS NULL

UNION ALL

SELECT
  'Appointments needing extraction',
  COUNT(*)::TEXT
FROM trapper.sot_appointments a
WHERE a.medical_notes IS NOT NULL
  AND LENGTH(a.medical_notes) > 20
  AND NOT EXISTS (
    SELECT 1 FROM trapper.extraction_status es
    WHERE es.source_table = 'sot_appointments'
      AND es.source_record_id = a.appointment_id::TEXT
  );

COMMENT ON VIEW trapper.v_ai_extraction_status IS
'Quick status view for the AI Extraction Engine';

-- ============================================================================
-- 8. GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT ON trapper.ai_extraction_rules TO PUBLIC;
GRANT SELECT ON trapper.v_ai_extraction_status TO PUBLIC;

\echo ''
\echo '=== MIG_758 Complete ==='
\echo 'AI Extraction Engine created:'
\echo '  - extraction_status enhanced with skip_reason and model_used'
\echo '  - ai_extraction_rules table for configurable extraction rules'
\echo '  - Automatic triggers for sot_appointments and web_intake_submissions'
\echo '  - Helper functions: needs_extraction(), should_use_sonnet()'
\echo '  - Status view: v_ai_extraction_status'
\echo ''
\echo 'New data will automatically queue for extraction!'
\echo ''
