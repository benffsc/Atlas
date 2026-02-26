-- MIG_2440: System Cohesiveness Health Check
--
-- Purpose: Comprehensive health check for all automated systems.
-- Identifies disconnects between systems and pending work that should be automatic.
--
-- @see docs/ENTITY_LINKING_FORTIFICATION_PLAN.md
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2440: System Cohesiveness Health Check'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE SYSTEM HEALTH CHECK FUNCTION
-- ============================================================================

\echo '1. Creating ops.check_system_cohesiveness()...'

CREATE OR REPLACE FUNCTION ops.check_system_cohesiveness()
RETURNS TABLE(
    system_name TEXT,
    check_type TEXT,
    status TEXT,
    current_value INT,
    threshold INT,
    message TEXT,
    action_required TEXT
) AS $$
BEGIN
    -- ========================================================================
    -- GEOCODING SYSTEM
    -- ========================================================================

    -- Check 1: Geocoding queue size
    RETURN QUERY
    SELECT
        'geocoding'::TEXT,
        'queue_size'::TEXT,
        CASE
            WHEN COUNT(*) > 1000 THEN 'CRITICAL'
            WHEN COUNT(*) > 500 THEN 'WARNING'
            ELSE 'OK'
        END::TEXT,
        COUNT(*)::INT,
        500::INT,
        'Places waiting for forward geocoding'::TEXT,
        CASE
            WHEN COUNT(*) > 500 THEN 'Queue growing faster than processing. Check cron frequency or API limits.'
            ELSE NULL
        END::TEXT
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND latitude IS NULL
      AND formatted_address IS NOT NULL
      AND TRIM(formatted_address) != '';

    -- Check 2: Geocoding failures
    RETURN QUERY
    SELECT
        'geocoding'::TEXT,
        'failed_permanent'::TEXT,
        CASE
            WHEN COUNT(*) > 100 THEN 'WARNING'
            ELSE 'OK'
        END::TEXT,
        COUNT(*)::INT,
        100::INT,
        'Places with permanent geocoding failures'::TEXT,
        CASE
            WHEN COUNT(*) > 100 THEN 'Review failed addresses at /admin/geocoding-failures'
            ELSE NULL
        END::TEXT
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND geocode_error IS NOT NULL
      AND geocode_attempts >= 3;

    -- ========================================================================
    -- ENTITY LINKING SYSTEM
    -- ========================================================================

    -- Check 3: Recent entity linking runs
    RETURN QUERY
    SELECT
        'entity_linking'::TEXT,
        'recent_runs'::TEXT,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM ops.entity_linking_runs
                WHERE created_at > NOW() - INTERVAL '30 minutes'
            ) THEN 'OK'
            ELSE 'WARNING'
        END::TEXT,
        COALESCE((
            SELECT COUNT(*)::INT FROM ops.entity_linking_runs
            WHERE created_at > NOW() - INTERVAL '24 hours'
        ), 0)::INT,
        48::INT,  -- Should run every 15 min = 96/day, at least 48 in 24h
        'Entity linking runs in last 24 hours'::TEXT,
        CASE
            WHEN NOT EXISTS (
                SELECT 1 FROM ops.entity_linking_runs
                WHERE created_at > NOW() - INTERVAL '30 minutes'
            ) THEN 'Entity linking cron may not be running. Check Vercel cron logs.'
            ELSE NULL
        END::TEXT;

    -- Check 4: Skipped entities accumulating
    RETURN QUERY
    SELECT
        'entity_linking'::TEXT,
        'skipped_entities'::TEXT,
        CASE
            WHEN COUNT(*) > 5000 THEN 'WARNING'
            ELSE 'OK'
        END::TEXT,
        COUNT(*)::INT,
        5000::INT,
        'Total entities skipped during linking'::TEXT,
        CASE
            WHEN COUNT(*) > 5000 THEN 'Review skipped reasons. Some may need manual intervention.'
            ELSE NULL
        END::TEXT
    FROM ops.entity_linking_skipped;

    -- Check 5: Clinic leakage (cats at clinic addresses)
    RETURN QUERY
    SELECT
        'entity_linking'::TEXT,
        'clinic_leakage'::TEXT,
        CASE
            WHEN (SELECT COUNT(*) FROM ops.v_clinic_leakage) > 0 THEN 'CRITICAL'
            ELSE 'OK'
        END::TEXT,
        (SELECT COUNT(*)::INT FROM ops.v_clinic_leakage),
        0::INT,
        'Cats incorrectly linked to clinic addresses'::TEXT,
        CASE
            WHEN (SELECT COUNT(*) FROM ops.v_clinic_leakage) > 0 THEN 'Run MIG_2430 cleanup or check link_cats_to_appointment_places()'
            ELSE NULL
        END::TEXT;

    -- ========================================================================
    -- STAGED RECORDS / PROCESSING PIPELINE
    -- ========================================================================

    -- Check 6: Unprocessed staged records
    RETURN QUERY
    SELECT
        'staging'::TEXT,
        'unprocessed_records'::TEXT,
        CASE
            WHEN COUNT(*) > 1000 THEN 'WARNING'
            WHEN COUNT(*) > 5000 THEN 'CRITICAL'
            ELSE 'OK'
        END::TEXT,
        COUNT(*)::INT,
        1000::INT,
        'Staged records awaiting processing'::TEXT,
        CASE
            WHEN COUNT(*) > 1000 THEN 'Run ops.process_all_pending_staged() or check cron'
            ELSE NULL
        END::TEXT
    FROM ops.staged_records
    WHERE is_processed = FALSE;

    -- Check 7: Stuck file uploads
    RETURN QUERY
    SELECT
        'uploads'::TEXT,
        'stuck_processing'::TEXT,
        CASE
            WHEN COUNT(*) > 0 THEN 'WARNING'
            ELSE 'OK'
        END::TEXT,
        COUNT(*)::INT,
        0::INT,
        'File uploads stuck in processing state'::TEXT,
        CASE
            WHEN COUNT(*) > 0 THEN 'Auto-reset should trigger at next cron. Check process-uploads cron.'
            ELSE NULL
        END::TEXT
    FROM ops.file_uploads
    WHERE status = 'processing'
      AND processed_at < NOW() - INTERVAL '5 minutes';

    -- ========================================================================
    -- DATA ENGINE / IDENTITY RESOLUTION
    -- ========================================================================

    -- Check 8: Pending identity reviews
    RETURN QUERY
    SELECT
        'data_engine'::TEXT,
        'pending_reviews'::TEXT,
        CASE
            WHEN COUNT(*) > 500 THEN 'CRITICAL'
            WHEN COUNT(*) > 100 THEN 'WARNING'
            ELSE 'OK'
        END::TEXT,
        COUNT(*)::INT,
        100::INT,
        'Identity matches pending human review'::TEXT,
        CASE
            WHEN COUNT(*) > 100 THEN 'Review at /admin/person-dedup - these REQUIRE manual action'
            ELSE NULL
        END::TEXT
    FROM sot.data_engine_match_decisions
    WHERE review_status = 'pending';

    -- ========================================================================
    -- SOURCE SYNC FRESHNESS
    -- ========================================================================

    -- Check 9: ShelterLuv sync freshness
    RETURN QUERY
    SELECT
        'shelterluv'::TEXT,
        'sync_freshness'::TEXT,
        CASE
            WHEN last_sync_at < NOW() - INTERVAL '12 hours' THEN 'WARNING'
            WHEN last_sync_at < NOW() - INTERVAL '24 hours' THEN 'CRITICAL'
            ELSE 'OK'
        END::TEXT,
        EXTRACT(HOURS FROM NOW() - last_sync_at)::INT,
        12::INT,
        'Hours since last ShelterLuv sync'::TEXT,
        CASE
            WHEN last_sync_at < NOW() - INTERVAL '12 hours' THEN 'Check shelterluv-sync cron and API key'
            ELSE NULL
        END::TEXT
    FROM ops.data_freshness_tracking
    WHERE source_system = 'shelterluv';

    -- Check 10: VolunteerHub sync freshness
    RETURN QUERY
    SELECT
        'volunteerhub'::TEXT,
        'sync_freshness'::TEXT,
        CASE
            WHEN COALESCE(last_sync_at, '2000-01-01') < NOW() - INTERVAL '36 hours' THEN 'WARNING'
            WHEN COALESCE(last_sync_at, '2000-01-01') < NOW() - INTERVAL '48 hours' THEN 'CRITICAL'
            ELSE 'OK'
        END::TEXT,
        COALESCE(EXTRACT(HOURS FROM NOW() - last_sync_at)::INT, 9999),
        36::INT,
        'Hours since last VolunteerHub sync'::TEXT,
        CASE
            WHEN COALESCE(last_sync_at, '2000-01-01') < NOW() - INTERVAL '36 hours' THEN 'Check volunteerhub-sync cron - may not be configured in vercel.json'
            ELSE NULL
        END::TEXT
    FROM ops.data_freshness_tracking
    WHERE source_system = 'volunteerhub';

    -- ========================================================================
    -- CAT-PLACE COVERAGE (THE BIG METRIC)
    -- ========================================================================

    -- Check 11: Overall cat-place coverage
    RETURN QUERY
    SELECT
        'coverage'::TEXT,
        'cat_place_pct'::TEXT,
        CASE
            WHEN place_coverage_pct < 90 THEN 'CRITICAL'
            WHEN place_coverage_pct < 95 THEN 'WARNING'
            ELSE 'OK'
        END::TEXT,
        place_coverage_pct::INT,
        95::INT,
        'Percentage of cats with place links'::TEXT,
        CASE
            WHEN place_coverage_pct < 95 THEN 'Run entity linking pipeline. Check for structural gaps (PetLink-only, no-identifier cats).'
            ELSE NULL
        END::TEXT
    FROM ops.v_cat_place_coverage;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.check_system_cohesiveness IS
'Comprehensive health check for all automated systems in Atlas.
Identifies disconnects between systems and work that should be automatic.
Returns actionable messages for each issue found.

Usage: SELECT * FROM ops.check_system_cohesiveness() WHERE status != ''OK'';';

\echo '   Created ops.check_system_cohesiveness()'

-- ============================================================================
-- 2. CREATE SUMMARY VIEW
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_system_health_summary...'

CREATE OR REPLACE VIEW ops.v_system_health_summary AS
SELECT
    system_name,
    COUNT(*) FILTER (WHERE status = 'OK') as ok_checks,
    COUNT(*) FILTER (WHERE status = 'WARNING') as warning_checks,
    COUNT(*) FILTER (WHERE status = 'CRITICAL') as critical_checks,
    CASE
        WHEN COUNT(*) FILTER (WHERE status = 'CRITICAL') > 0 THEN 'CRITICAL'
        WHEN COUNT(*) FILTER (WHERE status = 'WARNING') > 0 THEN 'WARNING'
        ELSE 'HEALTHY'
    END as overall_status
FROM ops.check_system_cohesiveness()
GROUP BY system_name
ORDER BY
    CASE
        WHEN COUNT(*) FILTER (WHERE status = 'CRITICAL') > 0 THEN 1
        WHEN COUNT(*) FILTER (WHERE status = 'WARNING') > 0 THEN 2
        ELSE 3
    END,
    system_name;

COMMENT ON VIEW ops.v_system_health_summary IS
'Summary of system health by subsystem. Shows critical/warning/ok counts.';

\echo '   Created ops.v_system_health_summary'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'System cohesiveness check (issues only):'
SELECT system_name, check_type, status, current_value, threshold, message
FROM ops.check_system_cohesiveness()
WHERE status != 'OK';

\echo ''
\echo 'System health summary:'
SELECT * FROM ops.v_system_health_summary;

\echo ''
\echo '=============================================='
\echo '  MIG_2440 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - ops.check_system_cohesiveness() - Comprehensive health check'
\echo '  - ops.v_system_health_summary - Per-system summary view'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM ops.check_system_cohesiveness() WHERE status != ''OK'';'
\echo ''
