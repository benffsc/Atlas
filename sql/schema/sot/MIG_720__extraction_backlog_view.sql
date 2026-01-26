\echo '=== MIG_720: Extraction Backlog View ==='

-- Summary view for dashboard (simpler version)
CREATE OR REPLACE VIEW trapper.v_extraction_backlog_summary AS
SELECT
  'google_maps' as source_type,
  'classification' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.google_map_entries
WHERE ai_classification IS NULL

UNION ALL

SELECT
  'sot_requests' as source_type,
  'attribute_extraction' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.sot_requests
WHERE (
  (summary IS NOT NULL AND LENGTH(summary) > 20)
  OR (notes IS NOT NULL AND LENGTH(notes) > 20)
  OR (internal_notes IS NOT NULL AND LENGTH(internal_notes) > 20)
)
AND NOT EXISTS (
  SELECT 1 FROM trapper.extraction_status es
  WHERE es.source_table = 'sot_requests'
  AND es.source_record_id = request_id::text
  AND es.last_extracted_at > NOW() - INTERVAL '7 days'
)

UNION ALL

SELECT
  'sot_appointments' as source_type,
  'attribute_extraction' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.sot_appointments
WHERE medical_notes IS NOT NULL
AND LENGTH(medical_notes) > 20
AND NOT EXISTS (
  SELECT 1 FROM trapper.extraction_status es
  WHERE es.source_table = 'sot_appointments'
  AND es.source_record_id = appointment_id::text
  AND es.last_extracted_at > NOW() - INTERVAL '7 days'
)

UNION ALL

SELECT
  'web_intake_submissions' as source_type,
  'attribute_extraction' as extraction_type,
  COUNT(*) as pending_count
FROM trapper.web_intake_submissions
WHERE (
  (situation_description IS NOT NULL AND LENGTH(situation_description) > 20)
  OR (medical_description IS NOT NULL AND LENGTH(medical_description) > 20)
)
AND NOT EXISTS (
  SELECT 1 FROM trapper.extraction_status es
  WHERE es.source_table = 'web_intake_submissions'
  AND es.source_record_id = submission_id::text
  AND es.last_extracted_at > NOW() - INTERVAL '7 days'
);

COMMENT ON VIEW trapper.v_extraction_backlog_summary IS
'Summary of extraction backlog by source. Similar to geocoding queue summary.';

-- Function to queue appointments for extraction (the big one - 50k records)
CREATE OR REPLACE FUNCTION trapper.queue_appointment_extraction(
  p_limit INTEGER DEFAULT 5000,
  p_priority INTEGER DEFAULT 50
)
RETURNS INTEGER AS $$
DECLARE
  v_queued INTEGER := 0;
BEGIN
  INSERT INTO trapper.extraction_queue (
    source_table, source_record_id, entity_type, entity_id,
    trigger_reason, priority
  )
  SELECT
    'sot_appointments', appointment_id::text, 'cat', cat_id,
    'backfill', p_priority
  FROM trapper.sot_appointments a
  WHERE medical_notes IS NOT NULL
  AND LENGTH(medical_notes) > 20
  AND cat_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.extraction_status es
    WHERE es.source_table = 'sot_appointments'
    AND es.source_record_id = a.appointment_id::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM trapper.extraction_queue eq
    WHERE eq.source_table = 'sot_appointments'
    AND eq.source_record_id = a.appointment_id::text
    AND eq.completed_at IS NULL
  )
  LIMIT p_limit
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_queued = ROW_COUNT;
  RETURN v_queued;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.queue_appointment_extraction IS
'Queues clinic appointments for AI extraction. Run multiple times to queue all 50k.
Example: SELECT trapper.queue_appointment_extraction(10000, 50);';

\echo 'Created v_extraction_backlog_summary and queue_appointment_extraction()'
