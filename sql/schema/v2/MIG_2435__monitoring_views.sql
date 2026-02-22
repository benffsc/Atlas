-- MIG_2435: Entity Linking Monitoring Views
--
-- Purpose: Create comprehensive monitoring views for entity linking health.
-- These views support the QRY_050 audit and ongoing data quality monitoring.
--
-- @see DATA_GAP_040
-- @see docs/ENTITY_LINKING_FORTIFICATION_PLAN.md
-- @see sql/queries/QRY_050__cat_place_audit.sql
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2435: Entity Linking Monitoring Views'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CATS WITHOUT PLACE LINKS VIEW
-- ============================================================================

\echo '1. Creating ops.v_cats_without_places...'

CREATE OR REPLACE VIEW ops.v_cats_without_places AS
SELECT
    c.cat_id,
    c.name,
    c.microchip,
    c.source_system,
    c.created_at as cat_created_at,
    (SELECT COUNT(*) FROM ops.appointments a WHERE a.cat_id = c.cat_id) as appointment_count,
    (SELECT MAX(a.appointment_date) FROM ops.appointments a WHERE a.cat_id = c.cat_id) as last_appointment,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id) as person_links,
    els.reason as skip_reason,
    els.created_at as skip_logged_at
FROM sot.cats c
LEFT JOIN ops.entity_linking_skipped els ON els.entity_id = c.cat_id AND els.entity_type = 'cat'
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id);

COMMENT ON VIEW ops.v_cats_without_places IS
'Cats that have no cat_place relationships. Includes appointment count,
person links, and skip reason from entity linking pipeline (if logged).
Use for monitoring entity linking coverage.';

\echo '   Created ops.v_cats_without_places'

-- ============================================================================
-- 2. CLINIC LEAKAGE DETECTION VIEW
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_clinic_leakage...'

CREATE OR REPLACE VIEW ops.v_clinic_leakage AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    cp.relationship_type,
    cp.source_table,
    COUNT(DISTINCT cp.cat_id) as cat_count,
    MIN(cp.created_at) as first_link,
    MAX(cp.created_at) as last_link
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE (
    p.place_kind = 'clinic'
    OR p.formatted_address ILIKE '%1814%Empire Industrial%'
    OR p.formatted_address ILIKE '%1820%Empire Industrial%'
    OR p.formatted_address ILIKE '%845 Todd%'
    OR p.formatted_address ILIKE '%Empire Industrial Court%'
)
GROUP BY p.place_id, p.display_name, p.formatted_address, p.place_kind,
         cp.relationship_type, cp.source_table
ORDER BY cat_count DESC;

COMMENT ON VIEW ops.v_clinic_leakage IS
'Detects cats incorrectly linked to clinic addresses.
Should return 0 rows after MIG_2430 cleanup.
Monitors for clinic fallback regression.';

\echo '   Created ops.v_clinic_leakage'

-- ============================================================================
-- 3. SKIPPED ENTITIES SUMMARY VIEW
-- ============================================================================

\echo ''
\echo '3. Creating ops.v_entity_linking_skipped_summary...'

CREATE OR REPLACE VIEW ops.v_entity_linking_skipped_summary AS
SELECT
    entity_type,
    reason,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7_days,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') as last_24_hours,
    MIN(created_at) as first_seen,
    MAX(created_at) as last_seen
FROM ops.entity_linking_skipped
GROUP BY entity_type, reason
ORDER BY count DESC;

COMMENT ON VIEW ops.v_entity_linking_skipped_summary IS
'Summary of entities skipped during entity linking, grouped by reason.
Tracks trends over time (last 7 days, last 24 hours).';

\echo '   Created ops.v_entity_linking_skipped_summary'

-- ============================================================================
-- 4. CAT-PLACE COVERAGE OVERVIEW
-- ============================================================================

\echo ''
\echo '4. Creating ops.v_cat_place_coverage...'

CREATE OR REPLACE VIEW ops.v_cat_place_coverage AS
WITH cat_stats AS (
    SELECT
        COUNT(*) as total_cats,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
        )) as cats_with_place,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id
        )) as cats_with_appointments,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id
        )) as cats_with_person
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
),
link_stats AS (
    SELECT
        COUNT(*) as total_links,
        COUNT(DISTINCT cat_id) as unique_cats,
        COUNT(*) FILTER (WHERE source_table = 'link_cats_to_appointment_places') as via_appointments,
        COUNT(*) FILTER (WHERE source_table = 'link_cats_to_places') as via_person_chain,
        COUNT(*) FILTER (WHERE relationship_type = 'home') as home_links,
        COUNT(*) FILTER (WHERE relationship_type = 'residence') as residence_links,
        COUNT(*) FILTER (WHERE relationship_type = 'colony_member') as colony_links
    FROM sot.cat_place
)
SELECT
    cs.total_cats,
    cs.cats_with_place,
    ROUND(100.0 * cs.cats_with_place / NULLIF(cs.total_cats, 0), 1) as place_coverage_pct,
    cs.cats_with_appointments,
    cs.cats_with_person,
    ls.total_links,
    ROUND(1.0 * ls.total_links / NULLIF(ls.unique_cats, 0), 2) as avg_links_per_cat,
    ls.via_appointments,
    ls.via_person_chain,
    ls.home_links,
    ls.residence_links,
    ls.colony_links
FROM cat_stats cs
CROSS JOIN link_stats ls;

COMMENT ON VIEW ops.v_cat_place_coverage IS
'Overview of cat-place linking coverage and statistics.
Shows coverage percentages, link sources, and relationship type distribution.';

\echo '   Created ops.v_cat_place_coverage'

-- ============================================================================
-- 5. APPOINTMENT PLACE RESOLUTION STATS
-- ============================================================================

\echo ''
\echo '5. Creating ops.v_appointment_place_resolution...'

CREATE OR REPLACE VIEW ops.v_appointment_place_resolution AS
SELECT
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) as with_inferred_place,
    COUNT(*) FILTER (WHERE place_id IS NOT NULL) as with_clinic_place,
    COUNT(*) FILTER (WHERE resolved_person_id IS NOT NULL) as with_resolved_person,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as with_cat_link,
    ROUND(100.0 * COUNT(*) FILTER (WHERE inferred_place_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) as inferred_place_pct,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND owner_address IS NOT NULL) as missing_with_address,
    COUNT(*) FILTER (WHERE inferred_place_id IS NULL AND resolved_person_id IS NOT NULL) as missing_with_person
FROM ops.appointments;

COMMENT ON VIEW ops.v_appointment_place_resolution IS
'Statistics on appointment place resolution.
Shows how many appointments have inferred_place_id vs clinic place_id.';

\echo '   Created ops.v_appointment_place_resolution'

-- ============================================================================
-- 6. ENTITY LINKING HEALTH CHECK FUNCTION
-- ============================================================================

\echo ''
\echo '6. Creating ops.check_entity_linking_health()...'

CREATE OR REPLACE FUNCTION ops.check_entity_linking_health()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    value INT,
    threshold INT,
    message TEXT
) AS $$
BEGIN
    -- Check 1: Clinic leakage
    RETURN QUERY
    SELECT
        'clinic_leakage'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ALERT' END::TEXT,
        COUNT(*)::INT,
        0::INT,
        CASE WHEN COUNT(*) = 0 THEN 'No clinic leakage' ELSE 'Cats incorrectly linked to clinic addresses' END::TEXT
    FROM ops.v_clinic_leakage;

    -- Check 2: Cat-place coverage
    RETURN QUERY
    SELECT
        'cat_place_coverage'::TEXT,
        CASE WHEN (SELECT place_coverage_pct FROM ops.v_cat_place_coverage) >= 80 THEN 'OK' ELSE 'WARNING' END::TEXT,
        (SELECT place_coverage_pct::INT FROM ops.v_cat_place_coverage),
        80::INT,
        'Cats with at least one place link'::TEXT;

    -- Check 3: Appointment place resolution
    RETURN QUERY
    SELECT
        'appointment_place_resolution'::TEXT,
        CASE WHEN (SELECT inferred_place_pct FROM ops.v_appointment_place_resolution) >= 70 THEN 'OK' ELSE 'WARNING' END::TEXT,
        (SELECT inferred_place_pct::INT FROM ops.v_appointment_place_resolution),
        70::INT,
        'Appointments with inferred_place_id'::TEXT;

    -- Check 4: Recent skipped entities
    RETURN QUERY
    SELECT
        'recent_skips'::TEXT,
        CASE WHEN COUNT(*) < 100 THEN 'OK' ELSE 'WARNING' END::TEXT,
        COUNT(*)::INT,
        100::INT,
        'Entities skipped in last 24 hours'::TEXT
    FROM ops.entity_linking_skipped
    WHERE created_at > NOW() - INTERVAL '1 day';

    -- Check 5: Last run status
    RETURN QUERY
    SELECT
        'last_run_status'::TEXT,
        COALESCE((SELECT status FROM ops.entity_linking_runs ORDER BY created_at DESC LIMIT 1), 'never_run')::TEXT,
        COALESCE((SELECT (result->>'cat_coverage_pct')::INT FROM ops.entity_linking_runs ORDER BY created_at DESC LIMIT 1), 0)::INT,
        0::INT,
        'Most recent entity linking run'::TEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.check_entity_linking_health IS
'Health check function for entity linking pipeline.
Returns status for key metrics with thresholds.
Use: SELECT * FROM ops.check_entity_linking_health();';

\echo '   Created ops.check_entity_linking_health()'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Cat-place coverage:'
SELECT * FROM ops.v_cat_place_coverage;

\echo ''
\echo 'Appointment place resolution:'
SELECT * FROM ops.v_appointment_place_resolution;

\echo ''
\echo 'Clinic leakage check:'
SELECT COUNT(*) as clinic_leakage_rows FROM ops.v_clinic_leakage;

\echo ''
\echo 'Entity linking health check:'
SELECT * FROM ops.check_entity_linking_health();

\echo ''
\echo '=============================================='
\echo '  MIG_2435 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created monitoring views:'
\echo '  - ops.v_cats_without_places'
\echo '  - ops.v_clinic_leakage'
\echo '  - ops.v_entity_linking_skipped_summary'
\echo '  - ops.v_cat_place_coverage'
\echo '  - ops.v_appointment_place_resolution'
\echo '  - ops.check_entity_linking_health()'
\echo ''
\echo 'Use ops.check_entity_linking_health() for quick health check.'
\echo 'Run QRY_050__cat_place_audit.sql for comprehensive audit.'
\echo ''
