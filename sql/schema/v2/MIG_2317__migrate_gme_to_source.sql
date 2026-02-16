-- MIG_2317: Migrate Google Map Entries to Source Table
-- Date: 2026-02-16
--
-- Purpose: Migrate existing data from ops.google_map_entries to source.google_map_entries
--          This restores the two-layer architecture.
--
-- Dependency: MIG_2316 must be run first to create source.google_map_entries table

\echo ''
\echo '=============================================='
\echo '  MIG_2317: Migrate GME to Source Table'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CHECK PREREQUISITE
-- ============================================================================

\echo '1. Checking prerequisites...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'source' AND table_name = 'google_map_entries'
    ) THEN
        RAISE EXCEPTION 'source.google_map_entries does not exist. Run MIG_2316 first.';
    END IF;
    RAISE NOTICE 'Prerequisite check passed: source.google_map_entries exists';
END $$;

-- ============================================================================
-- 2. COUNT EXISTING DATA
-- ============================================================================

\echo '2. Counting existing data...'

\echo 'Records in ops.google_map_entries:'
SELECT COUNT(*) as ops_count FROM ops.google_map_entries;

\echo 'Records in source.google_map_entries (before migration):'
SELECT COUNT(*) as source_count FROM source.google_map_entries;

-- ============================================================================
-- 3. MIGRATE DATA FROM OPS TO SOURCE
-- ============================================================================

\echo '3. Migrating data from ops.google_map_entries to source.google_map_entries...'

INSERT INTO source.google_map_entries (
    entry_id,
    kml_name,
    original_content,
    lat,
    lng,
    source_file,
    imported_at,
    ai_summary,
    ai_meaning,
    parsed_date,
    place_id,
    linked_place_id,
    nearest_place_id,
    nearest_place_distance_m,
    created_at,
    migrated_at
)
SELECT
    entry_id,
    kml_name,
    original_content,
    lat,
    lng,
    source_file,
    imported_at,
    ai_summary,
    ai_meaning,
    parsed_date,
    place_id,
    linked_place_id,
    nearest_place_id,
    nearest_place_distance_m,
    created_at,
    NOW()  -- Mark as migrated now
FROM ops.google_map_entries
ON CONFLICT (entry_id) DO UPDATE SET
    -- Update AI fields if they were populated
    ai_summary = COALESCE(EXCLUDED.ai_summary, source.google_map_entries.ai_summary),
    ai_meaning = COALESCE(EXCLUDED.ai_meaning, source.google_map_entries.ai_meaning),
    -- Update linking if it was done
    place_id = COALESCE(EXCLUDED.place_id, source.google_map_entries.place_id),
    linked_place_id = COALESCE(EXCLUDED.linked_place_id, source.google_map_entries.linked_place_id),
    nearest_place_id = COALESCE(EXCLUDED.nearest_place_id, source.google_map_entries.nearest_place_id),
    nearest_place_distance_m = COALESCE(EXCLUDED.nearest_place_distance_m, source.google_map_entries.nearest_place_distance_m),
    updated_at = NOW();

-- ============================================================================
-- 4. SET MATCH STATUS BASED ON LINKING
-- ============================================================================

\echo '4. Setting match_status based on existing links...'

UPDATE source.google_map_entries
SET match_status = CASE
    WHEN linked_place_id IS NOT NULL THEN 'matched'
    WHEN place_id IS NOT NULL THEN 'matched'
    WHEN nearest_place_id IS NOT NULL AND nearest_place_distance_m < 50 THEN 'uncertain'
    ELSE 'unmatched'
END,
matched_at = CASE
    WHEN linked_place_id IS NOT NULL OR place_id IS NOT NULL THEN created_at
    ELSE NULL
END
WHERE match_status = 'unmatched'
  AND (linked_place_id IS NOT NULL OR place_id IS NOT NULL OR nearest_place_id IS NOT NULL);

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Records in source.google_map_entries (after migration):'
SELECT COUNT(*) as source_count FROM source.google_map_entries;

\echo 'Match status distribution:'
SELECT match_status, COUNT(*) as count
FROM source.google_map_entries
GROUP BY match_status
ORDER BY count DESC;

\echo 'Linked vs unlinked:'
SELECT
    COUNT(*) FILTER (WHERE linked_place_id IS NOT NULL OR place_id IS NOT NULL) as linked,
    COUNT(*) FILTER (WHERE linked_place_id IS NULL AND place_id IS NULL) as unlinked,
    COUNT(*) as total
FROM source.google_map_entries;

\echo 'With AI processing:'
SELECT
    COUNT(*) FILTER (WHERE ai_summary IS NOT NULL) as with_ai_summary,
    COUNT(*) FILTER (WHERE ai_meaning IS NOT NULL) as with_ai_meaning,
    COUNT(*) as total
FROM source.google_map_entries;

-- ============================================================================
-- 6. CREATE COMPATIBILITY VIEW IN OPS (OPTIONAL)
-- ============================================================================

\echo ''
\echo '6. Creating ops.v_google_map_entries_linked view...'

CREATE OR REPLACE VIEW ops.v_google_map_entries_linked AS
SELECT * FROM source.google_map_entries
WHERE linked_place_id IS NOT NULL OR place_id IS NOT NULL;

COMMENT ON VIEW ops.v_google_map_entries_linked IS
'View of linked Google Map entries for ops-level queries.
Source data is in source.google_map_entries.';

\echo ''
\echo '=============================================='
\echo '  MIG_2317 Complete!'
\echo '=============================================='
\echo ''
\echo 'Data migrated from ops.google_map_entries to source.google_map_entries'
\echo ''
\echo 'Architecture now restored:'
\echo '  source.google_map_entries  →  Source of truth (all entries)'
\echo '  ops.v_google_map_entries_linked  →  View of linked entries only'
\echo ''
\echo 'API routes can now query source.google_map_entries'
\echo ''
