\echo '=== MIG_721: Fix Extraction Backlog View ==='

-- The backlog view was checking extraction_status, but scripts use entity_attributes
-- to track what's been processed. Fix the view to check correctly.

CREATE OR REPLACE VIEW trapper.v_extraction_backlog_summary AS
-- Google Maps classification (uses ai_classification column directly)
SELECT
  'google_maps' as source_type,
  'classification' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.google_map_entries
WHERE ai_classification IS NULL

UNION ALL

-- Requests: check entity_attributes with source_system='request_notes'
SELECT
  'sot_requests' as source_type,
  'attribute_extraction' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.sot_requests r
WHERE (
  (summary IS NOT NULL AND LENGTH(summary) > 20)
  OR (notes IS NOT NULL AND LENGTH(notes) > 20)
  OR (internal_notes IS NOT NULL AND LENGTH(internal_notes) > 20)
)
AND NOT EXISTS (
  SELECT 1 FROM trapper.entity_attributes ea
  WHERE ea.source_system = 'request_notes'
  AND ea.source_record_id = r.request_id::text
)

UNION ALL

-- Appointments: check entity_attributes with source_system='clinichq'
SELECT
  'sot_appointments' as source_type,
  'attribute_extraction' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.sot_appointments a
WHERE medical_notes IS NOT NULL
AND LENGTH(medical_notes) > 20
AND NOT EXISTS (
  SELECT 1 FROM trapper.entity_attributes ea
  WHERE ea.source_system = 'clinichq'
  AND ea.source_record_id = a.appointment_id::text
)

UNION ALL

-- Intake submissions: check entity_attributes with source_system='intake_notes'
SELECT
  'web_intake_submissions' as source_type,
  'attribute_extraction' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.web_intake_submissions s
WHERE (
  (situation_description IS NOT NULL AND LENGTH(situation_description) > 20)
  OR (medical_description IS NOT NULL AND LENGTH(medical_description) > 20)
)
AND NOT EXISTS (
  SELECT 1 FROM trapper.entity_attributes ea
  WHERE ea.source_system = 'intake_notes'
  AND ea.source_record_id = s.submission_id::text
);

COMMENT ON VIEW trapper.v_extraction_backlog_summary IS
'Summary of extraction backlog by source. Checks entity_attributes to track processed records.';

\echo 'Fixed v_extraction_backlog_summary to check entity_attributes instead of extraction_status'
