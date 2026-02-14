-- ============================================================================
-- MIG_774: Archive Old Backup Tables (TASK_006)
-- ============================================================================
-- TASK_LEDGER reference: TASK_006
-- ACTIVE Impact: No — backup tables have zero references (no FK, no views,
--   no functions).
--
-- Drops 10 old backup tables (~149 MB, ~208K rows).
-- Keeps 2 recent rollback backups from today's merge chain fixes:
--   _backup_person_merge_chains_770 (3 MB)
--   _backup_place_merge_chains_771 (296 KB)
-- ============================================================================

\echo '=== MIG_774: Archive Old Backup Tables (TASK_006) ==='

-- ============================================================================
-- Step 1: Pre-drop inventory
-- ============================================================================

\echo ''
\echo 'Step 1: Backup tables before cleanup:'

SELECT
    t.tablename,
    pg_size_pretty(pg_total_relation_size('trapper.' || t.tablename)) AS size
FROM pg_tables t
WHERE t.schemaname = 'trapper'
  AND (t.tablename LIKE 'backup_%' OR t.tablename LIKE '_backup_%')
ORDER BY pg_total_relation_size('trapper.' || t.tablename) DESC;

-- ============================================================================
-- Step 2: Drop old backup tables
-- ============================================================================

\echo ''
\echo 'Step 2: Dropping old backup tables'

DROP TABLE IF EXISTS trapper.backup_staged_records_clinichq_20260112;
\echo '  Dropped: backup_staged_records_clinichq_20260112 (~129 MB)'

DROP TABLE IF EXISTS trapper.backup_rebuild_cat_place_relationships;
\echo '  Dropped: backup_rebuild_cat_place_relationships (~10 MB)'

DROP TABLE IF EXISTS trapper.backup_person_cat_rels_20260112;
\echo '  Dropped: backup_person_cat_rels_20260112 (~3 MB)'

DROP TABLE IF EXISTS trapper.backup_rebuild_person_cat_relationships;
\echo '  Dropped: backup_rebuild_person_cat_relationships (~3 MB)'

DROP TABLE IF EXISTS trapper.backup_places_mig158;
\echo '  Dropped: backup_places_mig158 (~2 MB)'

DROP TABLE IF EXISTS trapper.backup_sot_people_mig157;
\echo '  Dropped: backup_sot_people_mig157 (~1 MB)'

DROP TABLE IF EXISTS trapper.backup_cat_place_relationships_mig159;
\echo '  Dropped: backup_cat_place_relationships_mig159 (~552 KB)'

DROP TABLE IF EXISTS trapper.backup_person_identifiers_mig157;
\echo '  Dropped: backup_person_identifiers_mig157'

DROP TABLE IF EXISTS trapper.backup_person_place_relationships_mig157;
\echo '  Dropped: backup_person_place_relationships_mig157'

DROP TABLE IF EXISTS trapper.backup_person_cat_relationships_mig157;
\echo '  Dropped: backup_person_cat_relationships_mig157'

-- ============================================================================
-- Step 3: Post-drop verification
-- ============================================================================

\echo ''
\echo 'Step 3: Remaining backup tables (should only be MIG_770/771):'

SELECT
    t.tablename,
    pg_size_pretty(pg_total_relation_size('trapper.' || t.tablename)) AS size
FROM pg_tables t
WHERE t.schemaname = 'trapper'
  AND (t.tablename LIKE 'backup_%' OR t.tablename LIKE '_backup_%')
ORDER BY t.tablename;

-- ============================================================================
-- Step 4: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_774 SUMMARY ======'
\echo 'Dropped 10 old backup tables (~149 MB, ~208K rows).'
\echo 'Kept 2 recent rollback backups from MIG_770/771.'
\echo ''
\echo 'Note: These tables had zero dependencies (no FK, no views, no functions).'
\echo 'Data is NOT recoverable after this point (backup tables are gone).'
\echo ''
\echo '=== MIG_774 Complete ==='
