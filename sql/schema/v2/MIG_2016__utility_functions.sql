-- MIG_2016: Utility Functions for V2
--
-- Purpose: Create utility functions in proper V2 schemas
-- - Zone data coverage tracking
-- - Place condition recording
-- - Compatibility wrappers in trapper.*
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2016: Utility Functions'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. SOT.ZONE_DATA_COVERAGE TABLE
-- ============================================================================

\echo '1. Creating sot.zone_data_coverage...'

CREATE TABLE IF NOT EXISTS sot.zone_data_coverage (
  zone_id TEXT PRIMARY KEY,
  zone_name TEXT,

  -- Data source counts
  google_maps_entries INT DEFAULT 0,
  airtable_requests INT DEFAULT 0,
  clinic_appointments INT DEFAULT 0,
  intake_submissions INT DEFAULT 0,

  -- Coverage level (computed)
  coverage_level TEXT,  -- 'rich', 'moderate', 'sparse', 'gap'

  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sot.zone_data_coverage IS 'Tracks data coverage by service zone. Identifies data-rich areas vs gaps.';

\echo '   Created sot.zone_data_coverage'

-- ============================================================================
-- 2. SOT.REFRESH_ZONE_DATA_COVERAGE()
-- ============================================================================

\echo ''
\echo '2. Creating sot.refresh_zone_data_coverage()...'

CREATE OR REPLACE FUNCTION sot.refresh_zone_data_coverage()
RETURNS void AS $$
BEGIN
  -- Clear and rebuild
  DELETE FROM sot.zone_data_coverage;

  INSERT INTO sot.zone_data_coverage (
    zone_id, zone_name,
    google_maps_entries, airtable_requests,
    clinic_appointments, intake_submissions,
    coverage_level
  )
  SELECT
    COALESCE(p.service_zone, 'Unknown') as zone_id,
    COALESCE(p.service_zone, 'Unknown') as zone_name,
    COUNT(DISTINCT g.entry_id) as google_maps_entries,
    COUNT(DISTINCT r.request_id) FILTER (WHERE r.source_system = 'airtable') as airtable_requests,
    COUNT(DISTINCT a.appointment_id) as clinic_appointments,
    COUNT(DISTINCT wi.submission_id) as intake_submissions,
    CASE
      WHEN COUNT(DISTINCT g.entry_id) + COUNT(DISTINCT r.request_id) +
           COUNT(DISTINCT a.appointment_id) + COUNT(DISTINCT wi.submission_id) > 100 THEN 'rich'
      WHEN COUNT(DISTINCT g.entry_id) + COUNT(DISTINCT r.request_id) +
           COUNT(DISTINCT a.appointment_id) + COUNT(DISTINCT wi.submission_id) > 20 THEN 'moderate'
      WHEN COUNT(DISTINCT g.entry_id) + COUNT(DISTINCT r.request_id) +
           COUNT(DISTINCT a.appointment_id) + COUNT(DISTINCT wi.submission_id) > 0 THEN 'sparse'
      ELSE 'gap'
    END as coverage_level
  FROM sot.places p
  LEFT JOIN ops.google_map_entries g ON g.linked_place_id = p.place_id
  LEFT JOIN ops.requests r ON r.place_id = p.place_id
  LEFT JOIN sot.cat_place cpr ON cpr.place_id = p.place_id
  LEFT JOIN ops.appointments a ON a.cat_id = cpr.cat_id
  LEFT JOIN ops.intake_submissions wi ON wi.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
  GROUP BY COALESCE(p.service_zone, 'Unknown');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.refresh_zone_data_coverage IS 'Refresh zone data coverage statistics by scanning all data sources.';

\echo '   Created sot.refresh_zone_data_coverage()'

-- ============================================================================
-- 3. SOT.RECORD_PLACE_CONDITION()
-- ============================================================================

\echo ''
\echo '3. Creating sot.record_place_condition()...'

CREATE OR REPLACE FUNCTION sot.record_place_condition(
  p_place_id UUID,
  p_condition_type TEXT,
  p_valid_from DATE,
  p_valid_to DATE DEFAULT NULL,
  p_severity TEXT DEFAULT 'moderate',
  p_description TEXT DEFAULT NULL,
  p_peak_cat_count INT DEFAULT NULL,
  p_ecological_impact TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'staff_observation',
  p_source_system TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_recorded_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_new_id UUID;
  v_old_id UUID;
BEGIN
  -- Find existing active condition of same type
  SELECT condition_id INTO v_old_id
  FROM sot.place_conditions
  WHERE place_id = p_place_id
    AND condition_type = p_condition_type
    AND superseded_at IS NULL
    AND valid_to IS NULL;

  -- Insert new condition record
  INSERT INTO sot.place_conditions (
    place_id, condition_type, severity, valid_from, valid_to,
    description, peak_cat_count, ecological_impact,
    source_type, source_system, source_record_id, recorded_by
  ) VALUES (
    p_place_id, p_condition_type, p_severity, p_valid_from, p_valid_to,
    p_description, p_peak_cat_count, p_ecological_impact,
    p_source_type, p_source_system, p_source_record_id, p_recorded_by
  ) RETURNING condition_id INTO v_new_id;

  -- Supersede old condition if exists and new one replaces it
  IF v_old_id IS NOT NULL AND p_valid_to IS NOT NULL THEN
    UPDATE sot.place_conditions
    SET superseded_at = NOW(), superseded_by = v_new_id
    WHERE condition_id = v_old_id;
  END IF;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.record_place_condition IS 'Record a place condition with proper bitemporal handling. Automatically supersedes previous conditions of same type if needed.';

\echo '   Created sot.record_place_condition()'

-- ============================================================================
-- 4. SOT.GET_PLACE_FAMILY() - Place clustering function
-- ============================================================================

\echo ''
\echo '4. Creating sot.get_place_family()...'

CREATE OR REPLACE FUNCTION sot.get_place_family(p_place_id UUID)
RETURNS UUID[] AS $$
DECLARE
  v_family UUID[];
  v_parent_id UUID;
  v_lat NUMERIC;
  v_lng NUMERIC;
BEGIN
  -- Start with self
  v_family := ARRAY[p_place_id];

  -- Get place coordinates and parent
  SELECT parent_place_id, latitude, longitude
  INTO v_parent_id, v_lat, v_lng
  FROM sot.places p
  LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
  WHERE p.place_id = p_place_id;

  -- Add parent if exists
  IF v_parent_id IS NOT NULL THEN
    v_family := v_family || v_parent_id;
  END IF;

  -- Add children
  SELECT v_family || ARRAY_AGG(place_id) INTO v_family
  FROM sot.places
  WHERE parent_place_id = p_place_id
    AND merged_into_place_id IS NULL;

  -- Add siblings (same parent, if parent exists)
  IF v_parent_id IS NOT NULL THEN
    SELECT v_family || ARRAY_AGG(place_id) INTO v_family
    FROM sot.places
    WHERE parent_place_id = v_parent_id
      AND place_id != p_place_id
      AND merged_into_place_id IS NULL;
  END IF;

  -- Add co-located places (within 1m, different address)
  IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
    SELECT v_family || ARRAY_AGG(p2.place_id) INTO v_family
    FROM sot.places p2
    JOIN sot.addresses a2 ON a2.address_id = COALESCE(p2.sot_address_id, p2.address_id)
    WHERE p2.place_id != p_place_id
      AND p2.merged_into_place_id IS NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(a2.longitude, a2.latitude), 4326)::geography,
        1  -- 1 meter
      );
  END IF;

  -- Remove NULLs and duplicates
  SELECT ARRAY_AGG(DISTINCT x) INTO v_family
  FROM UNNEST(v_family) x
  WHERE x IS NOT NULL;

  RETURN COALESCE(v_family, ARRAY[p_place_id]);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.get_place_family IS 'Returns UUID[] of parent, children, siblings, and co-located places (within 1m). Use for cross-place aggregation instead of arbitrary distance radius.';

\echo '   Created sot.get_place_family()'

-- ============================================================================
-- 5. COMPATIBILITY WRAPPERS IN TRAPPER.*
-- ============================================================================

\echo ''
\echo '5. Creating compatibility wrappers in trapper.*...'

-- Compatibility view for zone_data_coverage
CREATE OR REPLACE VIEW trapper.zone_data_coverage AS
SELECT * FROM sot.zone_data_coverage;

-- Compatibility function wrappers
CREATE OR REPLACE FUNCTION trapper.refresh_zone_data_coverage()
RETURNS void AS $$
BEGIN
  PERFORM sot.refresh_zone_data_coverage();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.record_place_condition(
  p_place_id UUID,
  p_condition_type TEXT,
  p_valid_from DATE,
  p_valid_to DATE DEFAULT NULL,
  p_severity TEXT DEFAULT 'moderate',
  p_description TEXT DEFAULT NULL,
  p_peak_cat_count INT DEFAULT NULL,
  p_ecological_impact TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'staff_observation',
  p_source_system TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_recorded_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
BEGIN
  RETURN sot.record_place_condition(
    p_place_id, p_condition_type, p_valid_from, p_valid_to,
    p_severity, p_description, p_peak_cat_count, p_ecological_impact,
    p_source_type, p_source_system, p_source_record_id, p_recorded_by
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.get_place_family(p_place_id UUID)
RETURNS UUID[] AS $$
BEGIN
  RETURN sot.get_place_family(p_place_id);
END;
$$ LANGUAGE plpgsql;

\echo '   Created compatibility wrappers'

-- ============================================================================
-- 6. SOT.RUN_ALL_ENTITY_LINKING() - Master linking function
-- ============================================================================

\echo ''
\echo '6. Ensuring sot.run_all_entity_linking() exists...'

-- Create if not exists (may already exist from MIG_2010)
CREATE OR REPLACE FUNCTION sot.run_all_entity_linking()
RETURNS TABLE(
  step TEXT,
  records_processed INT,
  duration_ms INT
) AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  -- Step 1: Link appointments to places
  v_start := clock_timestamp();
  SELECT COUNT(*) INTO v_count FROM sot.link_appointments_to_places();
  RETURN QUERY SELECT 'link_appointments_to_places'::TEXT, v_count,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT;

  -- Step 2: Link cats to appointment places
  v_start := clock_timestamp();
  SELECT COUNT(*) INTO v_count FROM sot.link_cats_to_appointment_places();
  RETURN QUERY SELECT 'link_cats_to_appointment_places'::TEXT, v_count,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT;

  -- Step 3: Link cats to places via person chain
  v_start := clock_timestamp();
  SELECT COUNT(*) INTO v_count FROM sot.link_cats_to_places();
  RETURN QUERY SELECT 'link_cats_to_places'::TEXT, v_count,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::INT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.run_all_entity_linking IS 'Master function to run all entity linking steps in correct order.';

-- Compatibility wrapper
CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(
  step TEXT,
  records_processed INT,
  duration_ms INT
) AS $$
BEGIN
  RETURN QUERY SELECT * FROM sot.run_all_entity_linking();
END;
$$ LANGUAGE plpgsql;

\echo '   Ensured sot.run_all_entity_linking() exists'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Utility functions created:'
SELECT
  n.nspname as schema,
  p.proname as function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('sot', 'trapper')
  AND p.proname IN (
    'refresh_zone_data_coverage',
    'record_place_condition',
    'get_place_family',
    'run_all_entity_linking'
  )
ORDER BY n.nspname, p.proname;

\echo ''
\echo '=============================================='
\echo '  MIG_2016 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created utility functions:'
\echo '  - sot.refresh_zone_data_coverage() - Zone coverage stats'
\echo '  - sot.record_place_condition() - Bitemporal condition recording'
\echo '  - sot.get_place_family() - Place clustering'
\echo '  - sot.run_all_entity_linking() - Master linking function'
\echo ''
\echo 'Created compatibility wrappers in trapper.*'
\echo ''
