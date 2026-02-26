-- MIG_2531: Intake-Request Field Unification
--
-- Problem: Intake form captures structured data that gets dumped into text fields:
-- - cat_name, cat_description, feeding_situation → situation_description (text dump)
-- - count_confidence, colony_duration → custom_fields JSONB (not normalized)
--
-- Solution:
-- 1. Add missing structured columns to ops.intake_submissions
-- 2. Add corresponding columns to ops.requests (if missing)
-- 3. Update conversion function to map structured fields
-- 4. Backfill from custom_fields JSONB where possible
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2531: Intake-Request Field Unification'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Add missing structured columns to ops.intake_submissions
-- ============================================================================

\echo '1. Adding structured columns to ops.intake_submissions...'

-- Cat identification fields (currently dumped into situation_description)
ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS cat_name TEXT,
ADD COLUMN IF NOT EXISTS cat_description TEXT,
ADD COLUMN IF NOT EXISTS feeding_situation TEXT;

-- Confidence/duration fields (currently in custom_fields JSONB)
ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS count_confidence TEXT
  CHECK (count_confidence IS NULL OR count_confidence IN ('exact', 'good_estimate', 'rough_guess', 'unknown'));

ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS colony_duration TEXT
  CHECK (colony_duration IS NULL OR colony_duration IN ('under_1_month', '1_to_6_months', '6_to_24_months', 'over_2_years', 'unknown'));

-- Additional kitten fields
ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS kitten_behavior TEXT,
ADD COLUMN IF NOT EXISTS kitten_contained TEXT,
ADD COLUMN IF NOT EXISTS mom_present TEXT,
ADD COLUMN IF NOT EXISTS mom_fixed TEXT;

-- Feeding details (normalized)
ALTER TABLE ops.intake_submissions
ADD COLUMN IF NOT EXISTS feeding_frequency TEXT
  CHECK (feeding_frequency IS NULL OR feeding_frequency IN ('daily', 'few_times_week', 'occasionally', 'rarely')),
ADD COLUMN IF NOT EXISTS feeding_duration TEXT
  CHECK (feeding_duration IS NULL OR feeding_duration IN ('just_started', 'few_weeks', 'few_months', 'over_year'));

\echo '   Added: cat_name, cat_description, feeding_situation'
\echo '   Added: count_confidence, colony_duration'
\echo '   Added: kitten_behavior, kitten_contained, mom_present, mom_fixed'
\echo '   Added: feeding_frequency, feeding_duration'

-- ============================================================================
-- 2. Add corresponding columns to ops.requests
-- ============================================================================

\echo ''
\echo '2. Adding corresponding columns to ops.requests...'

-- Cat identification (for single-cat requests)
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS cat_name TEXT,
ADD COLUMN IF NOT EXISTS cat_description TEXT;

-- Confidence/duration fields
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS count_confidence TEXT
  CHECK (count_confidence IS NULL OR count_confidence IN ('exact', 'good_estimate', 'rough_guess', 'unknown'));

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS colony_duration TEXT
  CHECK (colony_duration IS NULL OR colony_duration IN ('under_1_month', '1_to_6_months', '6_to_24_months', 'over_2_years', 'unknown'));

-- Kitten tracking
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS has_kittens BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS kitten_count INTEGER,
ADD COLUMN IF NOT EXISTS kitten_age_estimate TEXT,
ADD COLUMN IF NOT EXISTS kitten_behavior TEXT,
ADD COLUMN IF NOT EXISTS mom_present TEXT;

-- Feeding info
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS is_being_fed BOOLEAN,
ADD COLUMN IF NOT EXISTS feeder_name TEXT,
ADD COLUMN IF NOT EXISTS feeding_frequency TEXT;

-- Medical tracking
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS has_medical_concerns BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS medical_description TEXT;

-- Handleability and fixed status
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS handleability TEXT
  CHECK (handleability IS NULL OR handleability IN ('friendly_carrier', 'shy_handleable', 'unhandleable_trap', 'unknown', 'some_friendly', 'all_unhandleable'));

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS fixed_status TEXT
  CHECK (fixed_status IS NULL OR fixed_status IN ('none_fixed', 'some_fixed', 'most_fixed', 'all_fixed', 'unknown'));

-- Property/access tracking
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS is_property_owner BOOLEAN,
ADD COLUMN IF NOT EXISTS has_property_access BOOLEAN,
ADD COLUMN IF NOT EXISTS access_notes TEXT;

-- Eartip observations
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS eartip_count_observed INTEGER;

\echo '   Added request columns to match intake structure'

-- ============================================================================
-- 3. Backfill from custom_fields JSONB
-- ============================================================================

\echo ''
\echo '3. Backfilling from custom_fields JSONB...'

-- Backfill count_confidence from custom_fields
UPDATE ops.intake_submissions
SET count_confidence = (custom_fields->>'count_confidence')::TEXT
WHERE custom_fields ? 'count_confidence'
  AND count_confidence IS NULL;

-- Backfill colony_duration from custom_fields
UPDATE ops.intake_submissions
SET colony_duration = (custom_fields->>'colony_duration')::TEXT
WHERE custom_fields ? 'colony_duration'
  AND colony_duration IS NULL;

SELECT
  'count_confidence backfilled' as metric,
  COUNT(*) as count
FROM ops.intake_submissions WHERE count_confidence IS NOT NULL
UNION ALL
SELECT 'colony_duration backfilled', COUNT(*)
FROM ops.intake_submissions WHERE colony_duration IS NOT NULL;

-- ============================================================================
-- 4. Update intake-to-request conversion function
-- ============================================================================

\echo ''
\echo '4. Creating updated convert_intake_to_request function...'

CREATE OR REPLACE FUNCTION ops.convert_intake_to_request(
  p_submission_id UUID,
  p_converted_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_sub RECORD;
  v_request_id UUID;
  v_place_id UUID;
  v_requester_id UUID;
  v_priority TEXT;
BEGIN
  -- Fetch submission
  SELECT * INTO v_sub
  FROM ops.intake_submissions
  WHERE submission_id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found: %', p_submission_id;
  END IF;

  IF v_sub.converted_to_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'Submission already converted to request: %', v_sub.converted_to_request_id;
  END IF;

  -- Get place_id (from linked place or create new)
  v_place_id := v_sub.linked_place_id;

  -- Get requester person_id
  v_requester_id := v_sub.matched_person_id;

  -- Determine priority
  v_priority := CASE
    WHEN v_sub.is_emergency THEN 'urgent'
    WHEN v_sub.has_medical_concerns AND v_sub.medical_description ILIKE '%urgent%' THEN 'high'
    WHEN v_sub.triage_category = 'high_priority_tnr' THEN 'high'
    ELSE 'normal'
  END;

  -- Create request with ALL structured fields mapped
  INSERT INTO ops.requests (
    -- Core fields
    status,
    priority,
    summary,
    notes,
    -- Cat count fields
    estimated_cat_count,
    total_cats_reported,
    count_confidence,
    -- Cat identification
    cat_name,
    cat_description,
    -- Colony info
    colony_duration,
    -- Kitten fields
    has_kittens,
    kitten_count,
    kitten_age_estimate,
    kitten_behavior,
    mom_present,
    -- Feeding info
    is_being_fed,
    feeder_name,
    feeding_frequency,
    -- Medical
    has_medical_concerns,
    medical_description,
    -- Handleability
    handleability,
    fixed_status,
    eartip_count_observed,
    -- Property/access
    is_property_owner,
    has_property_access,
    access_notes,
    -- Links
    place_id,
    requester_person_id,
    -- Provenance
    source_system,
    source_record_id,
    source_created_at
  ) VALUES (
    'new',
    v_priority,
    -- Generate structured summary
    COALESCE(
      v_sub.cat_name,
      CASE
        WHEN v_sub.cat_count_estimate = 1 THEN 'Single cat'
        WHEN v_sub.cat_count_estimate <= 3 THEN v_sub.cat_count_estimate || ' cats'
        ELSE 'Colony (' || v_sub.cat_count_estimate || ' cats)'
      END
    ) || ' - ' || COALESCE(v_sub.cats_city, 'Unknown location'),
    v_sub.situation_description,
    -- Cat count
    COALESCE(v_sub.cats_needing_tnr, v_sub.cat_count_estimate),
    v_sub.cat_count_estimate,
    v_sub.count_confidence,
    -- Cat identification
    v_sub.cat_name,
    v_sub.cat_description,
    -- Colony info
    v_sub.colony_duration,
    -- Kitten fields
    COALESCE(v_sub.has_kittens, FALSE),
    v_sub.kitten_count,
    v_sub.kitten_age_estimate,
    v_sub.kitten_behavior,
    v_sub.mom_present,
    -- Feeding info
    COALESCE(v_sub.feeds_cat, v_sub.cats_being_fed, FALSE),
    v_sub.feeder_info,
    v_sub.feeding_frequency,
    -- Medical
    COALESCE(v_sub.has_medical_concerns, FALSE),
    v_sub.medical_description,
    -- Handleability
    v_sub.handleability::TEXT,
    v_sub.fixed_status::TEXT,
    v_sub.eartip_count_observed,
    -- Property/access
    v_sub.is_property_owner,
    v_sub.has_property_access,
    v_sub.access_notes,
    -- Links
    v_place_id,
    v_requester_id,
    -- Provenance
    'web_intake',
    p_submission_id::TEXT,
    v_sub.created_at
  )
  RETURNING request_id INTO v_request_id;

  -- Update submission with conversion info
  UPDATE ops.intake_submissions
  SET converted_to_request_id = v_request_id,
      converted_at = NOW(),
      converted_by = p_converted_by
  WHERE submission_id = p_submission_id;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.convert_intake_to_request(UUID, TEXT) IS
'Converts an intake submission to a request with FULL structured field mapping.
MIG_2531: Maps all intake fields to request columns instead of dumping to text.';

-- ============================================================================
-- 5. Create intake-request field mapping reference
-- ============================================================================

\echo ''
\echo '5. Creating field mapping reference view...'

CREATE OR REPLACE VIEW ops.v_intake_request_field_mapping AS
SELECT
  'Contact' as category,
  'first_name + last_name' as intake_field,
  'requester_person_id (via person matching)' as request_field,
  'Auto-linked via Data Engine' as notes
UNION ALL SELECT 'Contact', 'email', 'requester_person_id', 'Via person_identifiers'
UNION ALL SELECT 'Contact', 'phone', 'requester_person_id', 'Via person_identifiers'
UNION ALL SELECT 'Location', 'cats_address + city + zip', 'place_id (via place matching)', 'Auto-linked via geocoding'
UNION ALL SELECT 'Cat Count', 'cat_count_estimate', 'total_cats_reported', 'Total colony size'
UNION ALL SELECT 'Cat Count', 'cats_needing_tnr', 'estimated_cat_count', 'Cats still needing TNR'
UNION ALL SELECT 'Cat Count', 'count_confidence', 'count_confidence', 'Exact/estimate/guess/unknown'
UNION ALL SELECT 'Cat ID', 'cat_name', 'cat_name', 'For single-cat requests'
UNION ALL SELECT 'Cat ID', 'cat_description', 'cat_description', 'Color, markings, etc.'
UNION ALL SELECT 'Colony', 'colony_duration', 'colony_duration', 'How long cats observed'
UNION ALL SELECT 'Colony', 'fixed_status', 'fixed_status', 'None/some/most/all fixed'
UNION ALL SELECT 'Colony', 'eartip_count_observed', 'eartip_count_observed', 'Count of eartipped cats'
UNION ALL SELECT 'Colony', 'handleability', 'handleability', 'Friendly/shy/feral'
UNION ALL SELECT 'Kittens', 'has_kittens', 'has_kittens', 'Boolean flag'
UNION ALL SELECT 'Kittens', 'kitten_count', 'kitten_count', 'Number of kittens'
UNION ALL SELECT 'Kittens', 'kitten_age_estimate', 'kitten_age_estimate', 'Age in weeks'
UNION ALL SELECT 'Kittens', 'kitten_behavior', 'kitten_behavior', 'Socialization level'
UNION ALL SELECT 'Kittens', 'mom_present', 'mom_present', 'Yes/no/unknown'
UNION ALL SELECT 'Feeding', 'feeds_cat / cats_being_fed', 'is_being_fed', 'Boolean flag'
UNION ALL SELECT 'Feeding', 'feeder_info', 'feeder_name', 'Who feeds the cats'
UNION ALL SELECT 'Feeding', 'feeding_frequency', 'feeding_frequency', 'Daily/weekly/etc.'
UNION ALL SELECT 'Medical', 'has_medical_concerns', 'has_medical_concerns', 'Boolean flag'
UNION ALL SELECT 'Medical', 'medical_description', 'medical_description', 'Description of concern'
UNION ALL SELECT 'Access', 'is_property_owner', 'is_property_owner', 'Boolean'
UNION ALL SELECT 'Access', 'has_property_access', 'has_property_access', 'Boolean'
UNION ALL SELECT 'Access', 'access_notes', 'access_notes', 'Gate codes, etc.'
UNION ALL SELECT 'Notes', 'situation_description', 'notes', 'Free text notes'
ORDER BY category, intake_field;

COMMENT ON VIEW ops.v_intake_request_field_mapping IS
'Reference showing how intake submission fields map to request columns.
Use this to ensure consistent data capture across the intake-to-request flow.';

-- ============================================================================
-- 6. Summary
-- ============================================================================

\echo ''
\echo '6. Summary...'

SELECT
  'intake_submissions columns' as metric,
  COUNT(*) as count
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'intake_submissions'
UNION ALL
SELECT 'requests columns', COUNT(*)
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'requests';

\echo ''
\echo '=============================================='
\echo '  MIG_2531 Complete'
\echo '=============================================='
\echo ''
\echo 'Added structured columns to ops.intake_submissions:'
\echo '  - cat_name, cat_description, feeding_situation'
\echo '  - count_confidence, colony_duration'
\echo '  - kitten_behavior, kitten_contained, mom_present, mom_fixed'
\echo '  - feeding_frequency, feeding_duration'
\echo ''
\echo 'Added corresponding columns to ops.requests:'
\echo '  - cat_name, cat_description'
\echo '  - count_confidence, colony_duration'
\echo '  - has_kittens, kitten_count, kitten_age_estimate, etc.'
\echo '  - handleability, fixed_status'
\echo '  - is_being_fed, feeder_name, feeding_frequency'
\echo '  - has_medical_concerns, medical_description'
\echo '  - is_property_owner, has_property_access, access_notes'
\echo ''
\echo 'Updated: convert_intake_to_request() with full field mapping'
\echo 'Created: v_intake_request_field_mapping reference view'
\echo ''
\echo 'NEXT: Update API routes to use new structured columns'
\echo ''
