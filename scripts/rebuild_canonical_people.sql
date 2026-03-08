-- DEPRECATED: v1 script. References trapper.* schema dropped in MIG_2299. Do not run.
-- rebuild_canonical_people.sql
-- Rebuild canonical people and relationships from scratch
--
-- This script:
--   1. Clears all derived person data (NOT staged_records or raw data)
--   2. Clears observations (will be re-populated)
--   3. After running this, re-run the population scripts
--
-- SAFETY: This preserves all source data (staged_records, clinichq_hist_*)
--
-- USAGE:
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rebuild_canonical_people.sql
--   # Then re-run observation population and person derivation

\echo '============================================'
\echo 'Rebuild Canonical People'
\echo '============================================'
\echo ''
\echo 'This will CLEAR all derived person data.'
\echo 'Source data (staged_records, clinichq_hist_*) is PRESERVED.'
\echo ''

-- ============================================
-- BEFORE COUNTS
-- ============================================
\echo 'BEFORE counts:'
SELECT 'sot_people' AS table_name, COUNT(*) AS row_count FROM trapper.sot_people
UNION ALL
SELECT 'person_aliases', COUNT(*) FROM trapper.person_aliases
UNION ALL
SELECT 'person_identifiers', COUNT(*) FROM trapper.person_identifiers
UNION ALL
SELECT 'staged_record_person_link', COUNT(*) FROM trapper.staged_record_person_link
UNION ALL
SELECT 'observations', COUNT(*) FROM trapper.observations
UNION ALL
SELECT 'person_cat_relationships', COUNT(*) FROM trapper.person_cat_relationships
UNION ALL
SELECT 'person_place_relationships', COUNT(*) FROM trapper.person_place_relationships
ORDER BY table_name;

\echo ''
\echo 'SOURCE DATA (preserved):'
SELECT 'staged_records' AS table_name, COUNT(*) AS row_count FROM trapper.staged_records;

-- ============================================
-- CLEAR DERIVED DATA
-- ============================================
\echo ''
\echo 'Clearing derived data...'

-- Person-entity relationships first (FK dependencies)
TRUNCATE trapper.person_cat_relationships CASCADE;
TRUNCATE trapper.person_place_relationships CASCADE;
\echo '  Cleared person_cat_relationships, person_place_relationships'

-- Person linking
TRUNCATE trapper.staged_record_person_link CASCADE;
\echo '  Cleared staged_record_person_link'

-- Person data
TRUNCATE trapper.person_aliases CASCADE;
TRUNCATE trapper.person_identifiers CASCADE;
\echo '  Cleared person_aliases, person_identifiers'

-- Delete all people (can't TRUNCATE due to self-FK on merged_into_person_id)
DELETE FROM trapper.sot_people;
\echo '  Cleared sot_people'

-- Observations (will re-populate with fixed extraction)
TRUNCATE trapper.observations CASCADE;
\echo '  Cleared observations'

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'AFTER counts (should all be 0):'
SELECT 'sot_people' AS table_name, COUNT(*) AS row_count FROM trapper.sot_people
UNION ALL
SELECT 'person_aliases', COUNT(*) FROM trapper.person_aliases
UNION ALL
SELECT 'person_identifiers', COUNT(*) FROM trapper.person_identifiers
UNION ALL
SELECT 'staged_record_person_link', COUNT(*) FROM trapper.staged_record_person_link
UNION ALL
SELECT 'observations', COUNT(*) FROM trapper.observations
UNION ALL
SELECT 'person_cat_relationships', COUNT(*) FROM trapper.person_cat_relationships
UNION ALL
SELECT 'person_place_relationships', COUNT(*) FROM trapper.person_place_relationships
ORDER BY table_name;

\echo ''
\echo 'Rebuild complete. Now run:'
\echo ''
\echo '  # Re-populate observations (uses fixed extraction from MIG_030)'
\echo '  psql "$DATABASE_URL" -c "SELECT trapper.populate_observations_for_latest_run(''trapping_requests'');"'
\echo ''
\echo '  # Create canonical people from observations'
\echo '  psql "$DATABASE_URL" -c "SELECT * FROM trapper.upsert_people_from_observations(''trapping_requests'');"'
\echo ''
\echo '  # Update display names'
\echo '  psql "$DATABASE_URL" -c "SELECT trapper.update_all_person_display_names();"'
\echo ''
\echo '  # Verify'
\echo '  psql "$DATABASE_URL" -c "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE trapper.is_valid_person_name(display_name)) AS valid FROM trapper.sot_people WHERE merged_into_person_id IS NULL;"'
\echo ''
