-- ============================================================================
-- Atlas Overhauled System Migrations
-- Run this script to apply all migrations needed for the new Atlas system
--
-- Includes:
-- - CHUNK 12: Staff Verification (MIG_2514)
-- - CHUNK 21: Data Quality Monitoring (MIG_2515)
-- - CHUNK 22: VolunteerHub Enrichment (MIG_2516)
-- - Request Intelligence (MIG_2522-2525)
-- - Request Status Simplification (MIG_2530-2533)
--
-- Run with: psql $DATABASE_URL -f sql/schema/v2/RUN_ALL_OVERHAULED_MIGRATIONS.sql
-- ============================================================================

\echo ''
\echo '======================================================================'
\echo '  ATLAS OVERHAULED SYSTEM MIGRATIONS'
\echo '  Starting at:' `date`
\echo '======================================================================'
\echo ''

-- ============================================================================
-- PHASE 1: Foundation (can run in parallel)
-- ============================================================================

\echo ''
\echo '====== PHASE 1: Foundation Migrations ======'
\echo ''

-- MIG_2514: Staff Verification Schema (CHUNK 12)
\echo 'Running MIG_2514: Staff Verification Schema...'
\i MIG_2514__staff_verification_schema.sql

-- MIG_2515: Data Quality Monitoring (CHUNK 21)
\echo 'Running MIG_2515: Data Quality Monitoring...'
\i MIG_2515__data_quality_monitoring.sql

-- MIG_2516: VolunteerHub Enrichment (CHUNK 22)
\echo 'Running MIG_2516: VolunteerHub Enrichment...'
\i MIG_2516__volunteerhub_enrichment.sql

-- ============================================================================
-- PHASE 2: Request Intelligence (must run in order)
-- ============================================================================

\echo ''
\echo '====== PHASE 2: Request Intelligence ======'
\echo ''

-- MIG_2522: Requestor vs Site Contact (foundation)
\echo 'Running MIG_2522: Requestor vs Site Contact...'
\i MIG_2522__requestor_site_contact_distinction.sql

-- MIG_2523: Request-Appointment Linking (after MIG_2522)
\echo 'Running MIG_2523: Request-Appointment Linking...'
\i MIG_2523__request_appointment_linking.sql

-- MIG_2524: Request Place Classification (after MIG_2522)
\echo 'Running MIG_2524: Request Place Classification...'
\i MIG_2524__request_place_classification.sql

-- MIG_2525: Update v_request_list view (after MIG_2522)
\echo 'Running MIG_2525: Request List View Update...'
\i MIG_2525__request_list_view_site_contact.sql

-- ============================================================================
-- PHASE 3: Request Status Simplification (must run in order)
-- ============================================================================

\echo ''
\echo '====== PHASE 3: Request Status Simplification ======'
\echo ''

-- MIG_2530: Simplified Request Status (foundation)
\echo 'Running MIG_2530: Simplified Request Status...'
\i MIG_2530__simplified_request_status.sql

-- MIG_2531: Intake-Request Field Unification (after MIG_2530)
\echo 'Running MIG_2531: Intake-Request Field Unification...'
\i MIG_2531__intake_request_field_unification.sql

-- MIG_2532: Complete Request Field Coverage (after MIG_2531)
\echo 'Running MIG_2532: Complete Request Field Coverage...'
\i MIG_2532__complete_request_field_coverage.sql

-- MIG_2533: Backfill Requests from Intakes (after MIG_2532)
\echo 'Running MIG_2533: Backfill Requests from Intakes...'
\i MIG_2533__backfill_requests_from_intakes.sql

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '====== Verification ======'
\echo ''

-- Check all new columns exist on ops.requests
\echo 'Checking ops.requests columns...'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'requests'
AND column_name IN (
  'site_contact_person_id',
  'requester_is_site_contact',
  'requester_role_at_submission',
  'peak_count',
  'awareness_duration',
  'is_third_party_report',
  'county'
)
ORDER BY column_name;

-- Check v_request_list has new columns
\echo ''
\echo 'Checking ops.v_request_list columns...'
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'v_request_list'
AND column_name IN (
  'requester_role_at_submission',
  'requester_is_site_contact',
  'site_contact_name'
)
ORDER BY column_name;

-- Check new functions exist
\echo ''
\echo 'Checking new functions...'
SELECT proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('ops', 'sot')
AND proname IN (
  'classify_requestor_role',
  'enrich_skeleton_people',
  'snapshot_data_quality_metrics',
  'get_data_quality_trend',
  'verify_person_place'
)
ORDER BY proname;

-- Check status distribution
\echo ''
\echo 'Request status distribution:'
SELECT status::TEXT, COUNT(*) as count
FROM ops.requests
GROUP BY status
ORDER BY
  CASE status::TEXT
    WHEN 'new' THEN 1
    WHEN 'working' THEN 2
    WHEN 'paused' THEN 3
    WHEN 'completed' THEN 4
    ELSE 99
  END;

\echo ''
\echo '======================================================================'
\echo '  MIGRATIONS COMPLETE'
\echo '  Finished at:' `date`
\echo '======================================================================'
\echo ''
\echo 'Next steps:'
\echo '1. Restart the Atlas web app to pick up new schema'
\echo '2. Test requests list at /requests'
\echo '3. Test data quality dashboard at /admin/data-quality'
\echo ''
