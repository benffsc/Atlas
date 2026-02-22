-- MIG_2442: Function Existence Safeguards
--
-- Problem: V1→V2 migration left critical functions missing. The entity-linking
-- cron called them but they failed silently, causing 9,800+ orphaned cats.
--
-- Solution:
-- 1. Pre-flight check function that verifies all required functions exist
-- 2. Registry of required functions with their purpose
-- 3. Monitoring view for missing functions
-- 4. Entity linking wrapper that fails LOUDLY if prerequisites missing
--
-- This ensures we catch missing functions BEFORE they cause silent data loss.
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2442: Function Existence Safeguards'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE FUNCTION REGISTRY TABLE
-- ============================================================================

\echo '1. Creating ops.required_functions registry...'

CREATE TABLE IF NOT EXISTS ops.required_functions (
    function_name TEXT PRIMARY KEY,
    schema_name TEXT NOT NULL DEFAULT 'ops',
    description TEXT,
    called_by TEXT,  -- What calls this function (cron name, etc.)
    migration_source TEXT,  -- Original V1 migration
    is_critical BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.required_functions IS
'Registry of functions that MUST exist for automated processing to work.
Used by check_required_functions() to prevent silent failures.';

-- Seed with known required functions
INSERT INTO ops.required_functions (function_name, schema_name, description, called_by, migration_source, is_critical)
VALUES
    -- Entity linking cron functions
    ('process_clinichq_cat_info', 'ops', 'Catch-up processing for cat_info staged records', 'entity-linking cron', 'MIG_2441', TRUE),
    ('process_clinichq_owner_info', 'ops', 'Catch-up processing for owner_info staged records', 'entity-linking cron', 'MIG_2441', TRUE),
    ('process_clinichq_unchipped_cats', 'ops', 'Creates cats from Animal ID when no microchip', 'entity-linking cron', 'MIG_891/MIG_2441', TRUE),
    ('process_clinic_euthanasia', 'ops', 'Marks cats as deceased from euthanasia appointments', 'entity-linking cron', 'MIG_892/MIG_2441', FALSE),
    ('process_embedded_microchips_in_animal_names', 'ops', 'Extracts microchips from animal names', 'entity-linking cron', 'MIG_911/MIG_2441', FALSE),
    ('retry_unmatched_master_list_entries', 'ops', 'Retries shelter/foster matching', 'entity-linking cron', 'MIG_900/MIG_2441', FALSE),
    ('run_disease_status_computation', 'ops', 'Computes disease flags for places', 'entity-linking cron', 'MIG_2116', FALSE),
    -- Entity linking core functions
    ('run_all_entity_linking', 'sot', 'Master orchestrator for entity linking', 'entity-linking cron', 'MIG_2432', TRUE),
    ('link_appointments_to_places', 'sot', 'Links appointments to places via address', 'run_all_entity_linking', 'MIG_2431', TRUE),
    ('link_cats_to_appointment_places', 'sot', 'Links cats to places via appointments', 'run_all_entity_linking', 'MIG_2430', TRUE),
    ('link_cats_to_places', 'sot', 'Links cats to places via person chain', 'run_all_entity_linking', 'MIG_2433', TRUE),
    -- Geocoding functions
    ('get_geocoding_queue', 'ops', 'Gets places needing forward geocoding', 'geocode cron', 'MIG_2070', TRUE),
    ('get_reverse_geocoding_queue', 'ops', 'Gets places needing reverse geocoding', 'geocode cron', 'MIG_2070', TRUE),
    ('record_geocoding_result', 'ops', 'Records geocoding success/failure', 'geocode cron', 'MIG_2070', TRUE),
    ('record_reverse_geocoding_result', 'ops', 'Records reverse geocoding result', 'geocode cron', 'MIG_2070', TRUE),
    -- Core identity functions
    ('find_or_create_person', 'sot', 'Creates/finds person by email/phone', 'all ingest', 'MIG_2090', TRUE),
    ('find_or_create_place_deduped', 'sot', 'Creates/finds place with dedup', 'all ingest', 'MIG_2090', TRUE),
    ('find_or_create_cat_by_microchip', 'sot', 'Creates/finds cat by microchip', 'cat ingest', 'MIG_2090', TRUE),
    ('find_or_create_cat_by_clinichq_id', 'sot', 'Creates/finds cat by Animal ID', 'unchipped cat processing', 'MIG_2333', TRUE),
    ('should_be_person', 'sot', 'Gate: checks if name/email should be a person', 'all ingest', 'MIG_2090', TRUE),
    ('should_compute_disease_for_place', 'sot', 'Gate: excludes clinic/blacklisted places', 'entity linking', 'MIG_2304', TRUE)
ON CONFLICT (function_name) DO UPDATE SET
    description = EXCLUDED.description,
    called_by = EXCLUDED.called_by,
    migration_source = EXCLUDED.migration_source;

\echo '   Created ops.required_functions registry with entries'

-- ============================================================================
-- 2. CREATE FUNCTION EXISTENCE CHECKER
-- ============================================================================

\echo ''
\echo '2. Creating ops.check_required_functions()...'

CREATE OR REPLACE FUNCTION ops.check_required_functions()
RETURNS TABLE(
    function_name TEXT,
    schema_name TEXT,
    fn_exists BOOLEAN,
    is_critical BOOLEAN,
    called_by TEXT,
    message TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rf.function_name,
        rf.schema_name,
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = rf.schema_name
              AND p.proname = rf.function_name
        ) as fn_exists,
        rf.is_critical,
        rf.called_by,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = rf.schema_name
                  AND p.proname = rf.function_name
            ) THEN 'OK'
            WHEN rf.is_critical THEN 'CRITICAL: Function missing - ' || rf.description
            ELSE 'WARNING: Function missing - ' || rf.description
        END as message
    FROM ops.required_functions rf
    ORDER BY rf.is_critical DESC, rf.schema_name, rf.function_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.check_required_functions IS
'Checks that all required functions exist in the database.
Run this after migrations or before entity linking to catch missing functions.
Returns list of functions with their existence status.

Usage: SELECT * FROM ops.check_required_functions() WHERE NOT fn_exists;';

\echo '   Created ops.check_required_functions()'

-- ============================================================================
-- 3. CREATE PRE-FLIGHT CHECK FUNCTION
-- ============================================================================

\echo ''
\echo '3. Creating ops.preflight_entity_linking()...'

CREATE OR REPLACE FUNCTION ops.preflight_entity_linking()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details TEXT
) AS $$
DECLARE
    v_missing_critical INT;
    v_missing_warning INT;
    v_missing_list TEXT;
BEGIN
    -- Check 1: Required functions exist (only check entity-linking functions)
    SELECT
        COUNT(*) FILTER (WHERE NOT rf.fn_exists AND rf.is_critical),
        COUNT(*) FILTER (WHERE NOT rf.fn_exists AND NOT rf.is_critical),
        STRING_AGG(
            rf.schema_name || '.' || rf.function_name,
            ', '
            ORDER BY rf.is_critical DESC
        ) FILTER (WHERE NOT rf.fn_exists)
    INTO v_missing_critical, v_missing_warning, v_missing_list
    FROM ops.check_required_functions() rf
    WHERE rf.called_by IN ('entity-linking cron', 'run_all_entity_linking', 'all ingest',
                           'cat ingest', 'unchipped cat processing', 'entity linking');

    check_name := 'required_functions';
    IF v_missing_critical > 0 THEN
        status := 'FAIL';
        details := 'CRITICAL: ' || v_missing_critical || ' critical functions missing: ' || v_missing_list;
    ELSIF v_missing_warning > 0 THEN
        status := 'WARN';
        details := v_missing_warning || ' non-critical functions missing: ' || v_missing_list;
    ELSE
        status := 'PASS';
        details := 'All required functions exist';
    END IF;
    RETURN NEXT;

    -- Check 2: Entity linking tables exist
    check_name := 'required_tables';
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sot' AND table_name = 'cat_place')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sot' AND table_name = 'person_cat')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'sot' AND table_name = 'person_place')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ops' AND table_name = 'appointments')
    THEN
        status := 'PASS';
        details := 'All required tables exist';
    ELSE
        status := 'FAIL';
        details := 'Missing required tables for entity linking';
    END IF;
    RETURN NEXT;

    -- Check 3: Run history table exists
    check_name := 'monitoring_tables';
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ops' AND table_name = 'entity_linking_runs')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'ops' AND table_name = 'entity_linking_skipped')
    THEN
        status := 'PASS';
        details := 'Monitoring tables exist';
    ELSE
        status := 'WARN';
        details := 'Monitoring tables missing - run MIG_2430/MIG_2432';
    END IF;
    RETURN NEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.preflight_entity_linking IS
'Pre-flight check before running entity linking.
Returns FAIL if critical functions are missing.
The entity-linking cron should call this first and abort if it fails.';

\echo '   Created ops.preflight_entity_linking()'

-- ============================================================================
-- 4. CREATE SAFE ENTITY LINKING WRAPPER
-- ============================================================================

\echo ''
\echo '4. Creating ops.safe_run_entity_linking()...'

CREATE OR REPLACE FUNCTION ops.safe_run_entity_linking()
RETURNS JSONB AS $$
DECLARE
    v_preflight RECORD;
    v_has_failure BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    -- Run preflight checks
    FOR v_preflight IN SELECT * FROM ops.preflight_entity_linking() LOOP
        IF v_preflight.status = 'FAIL' THEN
            v_has_failure := TRUE;
            RAISE WARNING 'Preflight FAILED: % - %', v_preflight.check_name, v_preflight.details;
        END IF;
    END LOOP;

    -- Abort if preflight failed
    IF v_has_failure THEN
        RETURN jsonb_build_object(
            'success', FALSE,
            'error', 'Preflight check failed - missing required functions',
            'preflight', (SELECT jsonb_agg(row_to_json(p)) FROM ops.preflight_entity_linking() p)
        );
    END IF;

    -- Run entity linking
    v_result := sot.run_all_entity_linking();

    RETURN jsonb_build_object(
        'success', TRUE,
        'preflight', 'PASSED',
        'result', v_result
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.safe_run_entity_linking IS
'Safe wrapper for entity linking that runs preflight checks first.
Returns error JSON instead of failing silently if functions are missing.
Use this from crons instead of calling run_all_entity_linking() directly.';

\echo '   Created ops.safe_run_entity_linking()'

-- ============================================================================
-- 5. CREATE MONITORING VIEW
-- ============================================================================

\echo ''
\echo '5. Creating ops.v_missing_functions...'

CREATE OR REPLACE VIEW ops.v_missing_functions AS
SELECT
    rf.function_name,
    rf.schema_name,
    r.description,
    rf.called_by,
    r.migration_source,
    rf.is_critical,
    CASE
        WHEN rf.is_critical THEN 'CRITICAL - Processing will fail silently!'
        ELSE 'WARNING - Feature disabled'
    END as impact
FROM ops.check_required_functions() rf
JOIN ops.required_functions r ON r.function_name = rf.function_name
WHERE NOT rf.fn_exists
ORDER BY rf.is_critical DESC, rf.function_name;

COMMENT ON VIEW ops.v_missing_functions IS
'Shows functions that are registered as required but do not exist.
CRITICAL functions will cause silent data loss if missing.
Check this view after migrations and before deployments.';

\echo '   Created ops.v_missing_functions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Checking required functions:'
SELECT function_name, schema_name, fn_exists, is_critical, message
FROM ops.check_required_functions()
ORDER BY fn_exists, is_critical DESC;

\echo ''
\echo 'Missing functions (should be empty after MIG_2441):'
SELECT * FROM ops.v_missing_functions;

\echo ''
\echo 'Preflight check:'
SELECT * FROM ops.preflight_entity_linking();

\echo ''
\echo '=============================================='
\echo '  MIG_2442 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created safeguards:'
\echo '  - ops.required_functions table (registry of needed functions)'
\echo '  - ops.check_required_functions() - Verifies functions exist'
\echo '  - ops.preflight_entity_linking() - Pre-flight check'
\echo '  - ops.safe_run_entity_linking() - Safe wrapper that fails loudly'
\echo '  - ops.v_missing_functions view - Shows missing functions'
\echo ''
\echo 'IMPORTANT: Update entity-linking cron to call safe_run_entity_linking()!'
\echo ''
