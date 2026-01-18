\echo '=== MIG_323: Soft-Invalidate Garbage People ==='
\echo 'Marks invalid people as non-canonical without deleting them'
\echo ''

-- ============================================================================
-- PROBLEM
-- ============================================================================
-- 450 people with garbage names (placeholders, test data, single letters)
-- pollute identity matching and inflate people counts.
--
-- SOLUTION
-- - Mark as non-canonical (is_canonical = FALSE)
-- - Set data_quality = 'garbage' or 'low'
-- - Exclude from identity matching
-- - Preserve for audit trail and linked data
-- ============================================================================

-- Step 1: Count current state
\echo 'Step 1: Counting people by quality...'
SELECT
    COUNT(*) as total_people,
    COUNT(*) FILTER (WHERE trapper.is_valid_person_name(display_name)) as valid_names,
    COUNT(*) FILTER (WHERE NOT trapper.is_valid_person_name(display_name)) as invalid_names,
    COUNT(*) FILTER (WHERE trapper.is_organization_name(display_name)) as org_names
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL;

-- Step 2: Add data_quality column if not exists
\echo ''
\echo 'Step 2: Ensuring data_quality column exists...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
          AND table_name = 'sot_people'
          AND column_name = 'data_quality'
    ) THEN
        ALTER TABLE trapper.sot_people ADD COLUMN data_quality TEXT DEFAULT 'normal';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
          AND table_name = 'sot_people'
          AND column_name = 'quality_notes'
    ) THEN
        ALTER TABLE trapper.sot_people ADD COLUMN quality_notes TEXT;
    END IF;
END $$;

-- Step 3: Mark garbage names (but NOT organization names - those go to MIG_322)
\echo ''
\echo 'Step 3: Marking garbage names as non-canonical...'

UPDATE trapper.sot_people
SET
    is_canonical = FALSE,
    data_quality = 'garbage',
    quality_notes = 'Invalid name pattern: ' || display_name,
    updated_at = NOW()
WHERE merged_into_person_id IS NULL
  AND is_canonical = TRUE
  AND NOT trapper.is_valid_person_name(display_name)
  AND NOT trapper.is_organization_name(display_name);  -- Orgs handled separately

-- Step 4: Log the bulk update
\echo ''
\echo 'Step 4: Logging bulk update...'

INSERT INTO trapper.data_changes (
    operation, record_type, record_count, notes, changed_by
)
SELECT
    'soft_invalidate',
    'person',
    COUNT(*),
    'MIG_323: Marked invalid people as non-canonical',
    'migration'
FROM trapper.sot_people
WHERE data_quality = 'garbage'
  AND quality_notes LIKE 'Invalid name pattern:%';

-- Step 5: Also mark low-quality people (empty names, too short, etc.)
\echo ''
\echo 'Step 5: Marking low-quality people...'

UPDATE trapper.sot_people
SET
    data_quality = 'low',
    quality_notes = COALESCE(quality_notes, '') ||
        CASE
            WHEN display_name IS NULL OR TRIM(display_name) = '' THEN 'Empty name'
            WHEN LENGTH(TRIM(display_name)) < 3 THEN 'Name too short'
            WHEN display_name ~ '^\s*$' THEN 'Whitespace only'
            ELSE 'Unknown issue'
        END,
    updated_at = NOW()
WHERE merged_into_person_id IS NULL
  AND data_quality = 'normal'
  AND (
    display_name IS NULL
    OR TRIM(display_name) = ''
    OR LENGTH(TRIM(display_name)) < 3
    OR display_name ~ '^\s*$'
  );

-- Step 6: Create index for data_quality queries
\echo ''
\echo 'Step 6: Creating index on data_quality...'

CREATE INDEX IF NOT EXISTS idx_sot_people_data_quality ON trapper.sot_people(data_quality)
WHERE merged_into_person_id IS NULL;

-- Step 7: Create view for monitoring
\echo ''
\echo 'Step 7: Creating quality monitoring view...'

CREATE OR REPLACE VIEW trapper.v_people_quality_summary AS
SELECT
    data_quality,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY data_quality
ORDER BY count DESC;

COMMENT ON VIEW trapper.v_people_quality_summary IS
'Summary of people records by data quality tier.';

-- Step 8: Verify results
\echo ''
\echo '=== Results ==='
SELECT * FROM trapper.v_people_quality_summary;

\echo ''
\echo 'People marked as non-canonical:'
SELECT COUNT(*) FROM trapper.sot_people WHERE is_canonical = FALSE AND merged_into_person_id IS NULL;

\echo ''
\echo '=== MIG_323 Complete ==='
\echo 'Soft-invalidated garbage people without deleting them.'
\echo 'They are excluded from identity matching but preserved for audit.'
\echo ''
