-- MIG_2515: Data Quality Monitoring
-- Creates views, tables, and functions for automated data quality tracking
-- Part of CHUNK 21: Data Quality Monitoring

-- ============================================================================
-- 1. Daily health metrics view
-- ============================================================================
CREATE OR REPLACE VIEW ops.v_data_quality_metrics AS
SELECT
  NOW()::date as metric_date,

  -- Entity counts
  (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) as active_cats,
  (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) as active_people,
  (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL) as active_places,

  -- Data quality flags
  (SELECT COUNT(*) FROM sot.cats WHERE data_quality = 'garbage' AND merged_into_cat_id IS NULL) as garbage_cats,
  (SELECT COUNT(*) FROM sot.cats WHERE data_quality = 'needs_review' AND merged_into_cat_id IS NULL) as needs_review_cats,

  -- Duplicate checks (places with same formatted_address)
  (SELECT COUNT(*) FROM (
    SELECT formatted_address FROM sot.places
    WHERE merged_into_place_id IS NULL AND formatted_address IS NOT NULL
    GROUP BY formatted_address HAVING COUNT(*) > 1
  ) d) as duplicate_place_groups,

  -- FK integrity: appointments pointing to merged people
  (SELECT COUNT(*) FROM ops.appointments a
   JOIN sot.people p ON a.person_id = p.person_id
   WHERE p.merged_into_person_id IS NOT NULL) as fk_to_merged_people,

  -- FK integrity: appointments pointing to merged places
  (SELECT COUNT(*) FROM ops.appointments a
   JOIN sot.places p ON a.inferred_place_id = p.place_id
   WHERE p.merged_into_place_id IS NOT NULL) as fk_to_merged_places,

  -- Linking coverage
  (SELECT COUNT(*) FROM sot.cats WHERE shelterluv_animal_id IS NOT NULL AND merged_into_cat_id IS NULL) as cats_with_sl_id,
  (SELECT COUNT(*) FROM sot.cats WHERE clinichq_animal_id IS NOT NULL AND merged_into_cat_id IS NULL) as cats_with_chq_id,
  (SELECT COUNT(*) FROM sot.cat_place WHERE needs_verification = FALSE) as verified_cat_place_links,
  (SELECT COUNT(*) FROM sot.cat_place WHERE needs_verification = TRUE OR needs_verification IS NULL) as unverified_cat_place_links,

  -- Verification progress
  (SELECT COUNT(*) FROM sot.person_place WHERE is_staff_verified = TRUE) as verified_person_place,
  (SELECT COUNT(*) FROM sot.person_place WHERE is_staff_verified = FALSE OR is_staff_verified IS NULL) as unverified_person_place,

  -- Google Maps linking
  (SELECT COUNT(*) FROM ops.google_map_entries WHERE linked_place_id IS NOT NULL) as gm_linked,
  (SELECT COUNT(*) FROM ops.google_map_entries WHERE linked_place_id IS NULL) as gm_unlinked,

  -- Request stats
  (SELECT COUNT(*) FROM sot.requests WHERE status = 'new') as requests_new,
  (SELECT COUNT(*) FROM sot.requests WHERE status = 'working') as requests_working,
  (SELECT COUNT(*) FROM sot.requests WHERE status = 'paused') as requests_paused,
  (SELECT COUNT(*) FROM sot.requests WHERE status = 'completed') as requests_completed,

  -- Intake stats
  (SELECT COUNT(*) FROM ops.web_intake_submissions WHERE status = 'pending') as intakes_pending,
  (SELECT COUNT(*) FROM ops.web_intake_submissions WHERE status = 'converted') as intakes_converted,
  (SELECT COUNT(*) FROM ops.web_intake_submissions WHERE status = 'declined') as intakes_declined,

  -- Skeleton people (minimal data)
  (SELECT COUNT(*) FROM sot.people
   WHERE merged_into_person_id IS NULL
   AND (first_name IS NULL OR last_name IS NULL)
   AND display_name IS NOT NULL) as skeleton_people,

  -- People without identifiers
  (SELECT COUNT(*) FROM sot.people p
   WHERE p.merged_into_person_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5
   )) as people_without_identifiers,

  -- Appointments without place
  (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_id IS NULL) as appointments_without_place,

  -- Cats without any relationships
  (SELECT COUNT(*) FROM sot.cats c
   WHERE c.merged_into_cat_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id)
   AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id)
  ) as orphan_cats;

COMMENT ON VIEW ops.v_data_quality_metrics IS 'Daily snapshot of data quality metrics for monitoring';

-- ============================================================================
-- 2. Alert conditions view
-- ============================================================================
CREATE OR REPLACE VIEW ops.v_data_quality_alerts AS
-- Duplicate places
SELECT
  'duplicate_places' as alert_type,
  'CRITICAL' as severity,
  count as count,
  'Duplicate place groups detected (same formatted_address)' as message,
  NOW() as checked_at
FROM (
  SELECT COUNT(*) as count FROM (
    SELECT formatted_address FROM sot.places
    WHERE merged_into_place_id IS NULL AND formatted_address IS NOT NULL
    GROUP BY formatted_address HAVING COUNT(*) > 1
  ) d
) x
WHERE count > 0

UNION ALL

-- FK integrity - appointments to merged people
SELECT
  'fk_merged_people' as alert_type,
  'HIGH' as severity,
  COUNT(*) as count,
  'Appointments pointing to merged people' as message,
  NOW() as checked_at
FROM ops.appointments a
JOIN sot.people p ON a.person_id = p.person_id
WHERE p.merged_into_person_id IS NOT NULL
HAVING COUNT(*) > 0

UNION ALL

-- FK integrity - appointments to merged places
SELECT
  'fk_merged_places' as alert_type,
  'HIGH' as severity,
  COUNT(*) as count,
  'Appointments pointing to merged places' as message,
  NOW() as checked_at
FROM ops.appointments a
JOIN sot.places p ON a.inferred_place_id = p.place_id
WHERE p.merged_into_place_id IS NOT NULL
HAVING COUNT(*) > 0

UNION ALL

-- SL ID gap - cats with identifier but no column value
SELECT
  'sl_id_gap' as alert_type,
  'MEDIUM' as severity,
  COUNT(*) as count,
  'Cats with ShelterLuv identifier but no shelterluv_animal_id column value' as message,
  NOW() as checked_at
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND c.shelterluv_animal_id IS NULL
  AND EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'shelterluv_animal_id')
HAVING COUNT(*) > 0

UNION ALL

-- High orphan cat count
SELECT
  'orphan_cats' as alert_type,
  'MEDIUM' as severity,
  COUNT(*) as count,
  'Cats without any place or person relationships' as message,
  NOW() as checked_at
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id)
  AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id)
HAVING COUNT(*) > 1000

UNION ALL

-- Stale pending intakes (> 7 days)
SELECT
  'stale_intakes' as alert_type,
  'MEDIUM' as severity,
  COUNT(*) as count,
  'Intake submissions pending for more than 7 days' as message,
  NOW() as checked_at
FROM ops.web_intake_submissions
WHERE status = 'pending'
  AND created_at < NOW() - INTERVAL '7 days'
HAVING COUNT(*) > 0

UNION ALL

-- Low verification rate
SELECT
  'low_verification' as alert_type,
  'LOW' as severity,
  unverified as count,
  'Person-place relationships awaiting verification' as message,
  NOW() as checked_at
FROM (
  SELECT
    COUNT(*) FILTER (WHERE is_staff_verified = FALSE OR is_staff_verified IS NULL) as unverified
  FROM sot.person_place
) x
WHERE unverified > 10000;

COMMENT ON VIEW ops.v_data_quality_alerts IS 'Active data quality alerts based on threshold conditions';

-- ============================================================================
-- 3. Historical metrics table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.data_quality_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  metrics JSONB NOT NULL,
  alerts JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_date)
);

COMMENT ON TABLE ops.data_quality_history IS 'Historical snapshots of data quality metrics for trend analysis';

CREATE INDEX IF NOT EXISTS idx_data_quality_history_date ON ops.data_quality_history(metric_date DESC);

-- ============================================================================
-- 4. Function to snapshot metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.snapshot_data_quality_metrics()
RETURNS JSONB AS $$
DECLARE
  v_metrics JSONB;
  v_alerts JSONB;
  v_result JSONB;
BEGIN
  -- Get current metrics
  SELECT to_jsonb(m.*) INTO v_metrics
  FROM ops.v_data_quality_metrics m;

  -- Get current alerts
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb) INTO v_alerts
  FROM ops.v_data_quality_alerts a;

  -- Upsert into history
  INSERT INTO ops.data_quality_history (metric_date, metrics, alerts)
  VALUES (CURRENT_DATE, v_metrics, v_alerts)
  ON CONFLICT (metric_date) DO UPDATE
  SET metrics = EXCLUDED.metrics,
      alerts = EXCLUDED.alerts,
      created_at = NOW();

  -- Return combined result
  v_result := jsonb_build_object(
    'metric_date', CURRENT_DATE,
    'metrics', v_metrics,
    'alerts', v_alerts,
    'snapshot_at', NOW()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.snapshot_data_quality_metrics IS 'Captures current data quality metrics and alerts, stores in history table';

-- ============================================================================
-- 5. Function to get metrics trend
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.get_data_quality_trend(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  metric_date DATE,
  active_cats INTEGER,
  active_people INTEGER,
  active_places INTEGER,
  garbage_cats INTEGER,
  needs_review_cats INTEGER,
  verified_person_place INTEGER,
  alert_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    h.metric_date,
    (h.metrics->>'active_cats')::INTEGER,
    (h.metrics->>'active_people')::INTEGER,
    (h.metrics->>'active_places')::INTEGER,
    (h.metrics->>'garbage_cats')::INTEGER,
    (h.metrics->>'needs_review_cats')::INTEGER,
    (h.metrics->>'verified_person_place')::INTEGER,
    COALESCE(jsonb_array_length(h.alerts), 0)::INTEGER
  FROM ops.data_quality_history h
  WHERE h.metric_date >= CURRENT_DATE - p_days
  ORDER BY h.metric_date DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.get_data_quality_trend IS 'Returns data quality metrics trend over specified number of days';

-- ============================================================================
-- 6. Quick health check function
-- ============================================================================
CREATE OR REPLACE FUNCTION ops.check_data_quality_health()
RETURNS JSONB AS $$
DECLARE
  v_alerts JSONB;
  v_critical_count INTEGER;
  v_high_count INTEGER;
  v_status TEXT;
BEGIN
  -- Get current alerts
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb) INTO v_alerts
  FROM ops.v_data_quality_alerts a;

  -- Count by severity
  SELECT
    COUNT(*) FILTER (WHERE severity = 'CRITICAL'),
    COUNT(*) FILTER (WHERE severity = 'HIGH')
  INTO v_critical_count, v_high_count
  FROM ops.v_data_quality_alerts;

  -- Determine status
  IF v_critical_count > 0 THEN
    v_status := 'critical';
  ELSIF v_high_count > 0 THEN
    v_status := 'warning';
  ELSE
    v_status := 'healthy';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'critical_count', v_critical_count,
    'high_count', v_high_count,
    'total_alerts', jsonb_array_length(v_alerts),
    'alerts', v_alerts,
    'checked_at', NOW()
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.check_data_quality_health IS 'Quick health check returning status and active alerts';
