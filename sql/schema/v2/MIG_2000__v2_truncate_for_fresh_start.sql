-- MIG_2000: V2 Fresh Start - Truncate All Copied Data
--
-- Purpose: Remove all data copied from V1 to V2 (via MIG_1005)
-- This allows V2 to start fresh with re-processed source data
--
-- IMPORTANT: Run this AFTER disabling dual-write triggers
-- SELECT atlas.disable_dual_write();
--
-- V1 (trapper schema) remains untouched and continues serving production

\echo ''
\echo '=============================================='
\echo '  MIG_2000: V2 Fresh Start'
\echo '=============================================='
\echo ''
\echo 'This will TRUNCATE all V2 tables for a fresh start.'
\echo 'V1 (trapper schema) is NOT affected.'
\echo ''

-- ============================================================================
-- 1. VERIFY DUAL-WRITE IS DISABLED
-- ============================================================================

\echo '1. Verifying dual-write is disabled...'

DO $$
DECLARE
    v_enabled TEXT;
BEGIN
    SELECT value INTO v_enabled FROM atlas.config WHERE key = 'dual_write_enabled';
    IF v_enabled = 'true' THEN
        RAISE EXCEPTION 'Dual-write is still ENABLED! Disable first: SELECT atlas.disable_dual_write();';
    END IF;
    RAISE NOTICE 'Dual-write is disabled. Safe to proceed.';
END;
$$;

-- ============================================================================
-- 2. TRUNCATE SOT RELATIONSHIPS (respecting foreign keys)
-- ============================================================================

\echo ''
\echo '2. Truncating SOT relationships...'

TRUNCATE sot.person_cat CASCADE;
TRUNCATE sot.cat_place CASCADE;
TRUNCATE sot.person_place CASCADE;

\echo '   Truncated: person_cat, cat_place, person_place'

-- ============================================================================
-- 3. TRUNCATE COLONY DATA
-- ============================================================================

\echo ''
\echo '3. Truncating colony data...'

TRUNCATE sot.colony_cats CASCADE;
TRUNCATE sot.colony_places CASCADE;
TRUNCATE sot.colonies CASCADE;
TRUNCATE beacon.colony_estimates CASCADE;

\echo '   Truncated: colony_cats, colony_places, colonies, colony_estimates'

-- ============================================================================
-- 4. TRUNCATE IDENTIFIERS AND PROVENANCE
-- ============================================================================

\echo ''
\echo '4. Truncating identifiers and provenance...'

TRUNCATE sot.person_identifiers CASCADE;
TRUNCATE sot.cat_identifiers CASCADE;
TRUNCATE sot.cat_field_sources CASCADE;
TRUNCATE sot.person_field_sources CASCADE;
TRUNCATE sot.place_field_sources CASCADE;

\echo '   Truncated: person_identifiers, cat_identifiers, *_field_sources'

-- ============================================================================
-- 5. TRUNCATE SOT ENTITIES
-- ============================================================================

\echo ''
\echo '5. Truncating SOT entities...'

TRUNCATE sot.place_contexts CASCADE;
TRUNCATE sot.cats CASCADE;
TRUNCATE sot.people CASCADE;
TRUNCATE sot.places CASCADE;
TRUNCATE sot.addresses CASCADE;

\echo '   Truncated: place_contexts, cats, people, places, addresses'

-- ============================================================================
-- 6. TRUNCATE OPS DATA
-- ============================================================================

\echo ''
\echo '6. Truncating OPS data...'

TRUNCATE ops.request_cats CASCADE;
TRUNCATE ops.request_trapper_assignments CASCADE;
TRUNCATE ops.requests CASCADE;
TRUNCATE ops.appointments CASCADE;
TRUNCATE ops.intake_submissions CASCADE;
TRUNCATE ops.journal_entries CASCADE;
TRUNCATE ops.google_map_entries CASCADE;
TRUNCATE ops.volunteers CASCADE;
TRUNCATE ops.person_roles CASCADE;

\echo '   Truncated: requests, appointments, intake_submissions, etc.'

-- ============================================================================
-- 7. TRUNCATE SOURCE TRACKING
-- ============================================================================

\echo ''
\echo '7. Truncating source tracking...'

TRUNCATE source.change_events CASCADE;
TRUNCATE source.sync_record_state CASCADE;
TRUNCATE source.entity_source_links CASCADE;
-- Keep source.sync_runs for audit trail (just the metadata)

\echo '   Truncated: change_events, sync_record_state, entity_source_links'

-- ============================================================================
-- 8. TRUNCATE AUDIT/QUARANTINE
-- ============================================================================

\echo ''
\echo '8. Truncating audit/quarantine...'

TRUNCATE audit.pattern_alerts CASCADE;
TRUNCATE quarantine.failed_records CASCADE;

\echo '   Truncated: pattern_alerts, failed_records'

-- ============================================================================
-- 9. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'V2 table counts (should all be 0):'

SELECT 'sot.people' as table_name, COUNT(*) as count FROM sot.people
UNION ALL SELECT 'sot.cats', COUNT(*) FROM sot.cats
UNION ALL SELECT 'sot.places', COUNT(*) FROM sot.places
UNION ALL SELECT 'sot.addresses', COUNT(*) FROM sot.addresses
UNION ALL SELECT 'ops.appointments', COUNT(*) FROM ops.appointments
UNION ALL SELECT 'ops.requests', COUNT(*) FROM ops.requests
UNION ALL SELECT 'ops.intake_submissions', COUNT(*) FROM ops.intake_submissions
ORDER BY table_name;

\echo ''
\echo 'V1 table counts (should be UNCHANGED):'

SELECT 'trapper.sot_people' as table_name, COUNT(*) as count FROM trapper.sot_people
UNION ALL SELECT 'trapper.sot_cats', COUNT(*) FROM trapper.sot_cats
UNION ALL SELECT 'trapper.places', COUNT(*) FROM trapper.places
UNION ALL SELECT 'trapper.raw_clinichq_owner_info', COUNT(*) FROM trapper.raw_clinichq_owner_info
ORDER BY table_name;

\echo ''
\echo '=============================================='
\echo '  MIG_2000 Complete - V2 Fresh Start Ready'
\echo '=============================================='
\echo ''
\echo 'Next steps:'
\echo '  1. Run MIG_2001 to create source.*_raw tables'
\echo '  2. Run MIG_2002 to enhance OPS layer'
\echo '  3. Create V2 ingest scripts'
\echo '  4. Process source data fresh into V2'
\echo ''
\echo 'V1 (trapper schema) continues serving production.'
\echo 'Dual-write remains DISABLED until V2 is validated.'
\echo ''
