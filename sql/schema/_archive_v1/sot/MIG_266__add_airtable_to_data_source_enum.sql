-- MIG_266: Add 'airtable' to data_source enum
-- ============================================
--
-- Fixes: Project 75 sync fails with "invalid input value for enum trapper.data_source: 'airtable'"
-- The find_or_create_place_deduped() function requires a valid data_source value.
--
-- Per CLAUDE.md guidelines, 'airtable' is the canonical source_system for all Airtable data.
-- Current enum has 'airtable_sync' and 'airtable_ffsc' but was missing plain 'airtable'.

\echo '=== MIG_266: Add airtable to data_source enum ==='

-- Add 'airtable' to the enum (IF NOT EXISTS is only available in PG 13+)
DO $$
BEGIN
    -- Check if value already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'trapper.data_source'::regtype
        AND enumlabel = 'airtable'
    ) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'airtable';
        RAISE NOTICE 'Added ''airtable'' to trapper.data_source enum';
    ELSE
        RAISE NOTICE 'Value ''airtable'' already exists in enum';
    END IF;
END
$$;

-- Verify enum
\echo 'Current data_source enum values:'
SELECT enum_range(NULL::trapper.data_source);

-- ============================================
-- PART 2: Backfill Project 75 eartip observation data
-- ============================================
--
-- Problem: 506 Project 75 records have ear-tip data in `altered_count`
-- but NOT in `eartip_count_observed` (required for Chapman estimation).
--
-- Root cause: Records were imported before ecology fields were added,
-- and the sync script's ON CONFLICT UPDATE didn't populate them.
--
-- Impact: Enables Chapman mark-resight estimation for 422 places (up from 4)

\echo 'Backfilling Project 75 eartip observation data...'

UPDATE trapper.place_colony_estimates
SET
  eartip_count_observed = altered_count,
  total_cats_observed = total_cats
WHERE source_type = 'post_clinic_survey'
  AND altered_count IS NOT NULL
  AND eartip_count_observed IS NULL;

\echo 'Backfill complete. Verifying Chapman coverage...'

-- Show improvement
SELECT
  estimation_method,
  COUNT(*) as place_count
FROM trapper.v_place_ecology_stats
WHERE estimation_method IN ('mark_resight', 'max_recent', 'verified_only')
GROUP BY estimation_method
ORDER BY
  CASE estimation_method
    WHEN 'mark_resight' THEN 1
    WHEN 'max_recent' THEN 2
    ELSE 3
  END;

\echo '=== MIG_266 Complete ==='
