-- MIG_310: Auto-match Google Map Entries Trigger
--
-- Creates a trigger that automatically matches orphaned Google Map entries
-- to places when they get geocoded (location set).
--
-- This enables the "match when address comes up" feature for orphaned KML data.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_310__google_map_auto_match_trigger.sql

\echo ''
\echo '=============================================='
\echo 'MIG_310: Google Map Auto-Match Trigger'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Create trigger function
-- ============================================

\echo 'Creating trigger function...'

CREATE OR REPLACE FUNCTION trapper.trigger_match_google_map_entries()
RETURNS TRIGGER AS $$
DECLARE
    v_matched INTEGER;
BEGIN
    -- Only run when location is set (new or updated to non-null)
    IF NEW.location IS NOT NULL AND (OLD.location IS NULL OR OLD.location != NEW.location) THEN
        -- Try to match any orphaned entries within 50m
        SELECT trapper.try_match_google_map_entries_to_place(NEW.place_id) INTO v_matched;

        IF v_matched > 0 THEN
            RAISE NOTICE 'Auto-matched % Google Map entries to place %', v_matched, NEW.place_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.trigger_match_google_map_entries IS
'Trigger function that auto-matches orphaned Google Map entries when a place gets geocoded.';

-- ============================================
-- 2. Create trigger on places table
-- ============================================

\echo 'Creating trigger on places table...'

DROP TRIGGER IF EXISTS trg_match_google_map_entries ON trapper.places;

CREATE TRIGGER trg_match_google_map_entries
AFTER INSERT OR UPDATE OF location ON trapper.places
FOR EACH ROW
EXECUTE FUNCTION trapper.trigger_match_google_map_entries();

-- ============================================
-- 3. Test: Check for any matches with existing data
-- ============================================

\echo ''
\echo 'Checking for existing matches...'

-- Run the match function for all places that might have nearby orphans
WITH matches AS (
    SELECT
        p.place_id,
        trapper.try_match_google_map_entries_to_place(p.place_id) as matched_count
    FROM trapper.places p
    WHERE p.location IS NOT NULL
      AND p.merged_into_place_id IS NULL
      AND EXISTS (
          SELECT 1 FROM trapper.google_map_entries gme
          WHERE gme.match_status IN ('unmatched', 'uncertain')
            AND gme.place_id IS NULL
            AND (
                6371000 * acos(
                    cos(radians(gme.lat)) * cos(radians(ST_Y(p.location::geometry))) *
                    cos(radians(ST_X(p.location::geometry)) - radians(gme.lng)) +
                    sin(radians(gme.lat)) * sin(radians(ST_Y(p.location::geometry)))
                )
            ) <= 50
      )
)
SELECT SUM(matched_count) as total_new_matches FROM matches;

-- ============================================
-- 4. Summary
-- ============================================

\echo ''
\echo 'Current Google Map entry status:'

SELECT
    match_status,
    COUNT(*) as count
FROM trapper.google_map_entries
GROUP BY match_status
ORDER BY match_status;

\echo ''
\echo '=============================================='
\echo 'MIG_310 Complete!'
\echo ''
\echo 'Created:'
\echo '  - trigger_match_google_map_entries() function'
\echo '  - trg_match_google_map_entries trigger on places'
\echo ''
\echo 'When a place gets geocoded, any orphaned Google Map'
\echo 'entries within 50m will be automatically matched.'
\echo '=============================================='
\echo ''
