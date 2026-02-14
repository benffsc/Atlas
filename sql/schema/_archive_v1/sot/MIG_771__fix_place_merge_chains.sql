-- ============================================================================
-- MIG_771: Fix Place Merge Chain Black Holes (TASK_003)
-- ============================================================================
-- TASK_LEDGER reference: TASK_003
-- ACTIVE Impact: Yes (Surgical) — places is read by request detail, intake, search.
--   Only modifies merged_into_place_id on already-merged records (invisible to views).
--
-- Pre-fix state: 10 places in 2-deep merge chains out of 4,447 total merged.
-- ============================================================================

\echo '=== MIG_771: Fix Place Merge Chain Black Holes (TASK_003) ==='

-- Step 1: Diagnostics
\echo ''
\echo 'Step 1: Pre-fix diagnostics'

\echo 'Places in multi-hop chains:'
SELECT COUNT(*) AS chain_members
FROM trapper.places
WHERE merged_into_place_id IS NOT NULL
  AND merged_into_place_id IN (
    SELECT place_id FROM trapper.places WHERE merged_into_place_id IS NOT NULL
  );

-- Step 2: Backup
\echo ''
\echo 'Step 2: Creating backup'

DROP TABLE IF EXISTS trapper._backup_place_merge_chains_771;

CREATE TABLE trapper._backup_place_merge_chains_771 AS
SELECT place_id, merged_into_place_id AS original_merged_into
FROM trapper.places
WHERE merged_into_place_id IS NOT NULL;

\echo 'Backup rows:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_place_merge_chains_771;

-- Step 3: Flatten chains
\echo ''
\echo 'Step 3: Flattening place merge chains'

UPDATE trapper.places p
SET merged_into_place_id = trapper.get_canonical_place_id(p.place_id)
WHERE p.merged_into_place_id IS NOT NULL
  AND p.merged_into_place_id IN (
    SELECT place_id FROM trapper.places WHERE merged_into_place_id IS NOT NULL
  );

\echo 'Rows updated:'
SELECT COUNT(*) AS flattened
FROM trapper.places p
JOIN trapper._backup_place_merge_chains_771 b ON b.place_id = p.place_id
WHERE p.merged_into_place_id != b.original_merged_into;

-- Step 4: Verify
\echo ''
\echo 'Step 4: Verification — chains remaining (should be 0):'

SELECT COUNT(*) AS remaining_chains
FROM trapper.places
WHERE merged_into_place_id IS NOT NULL
  AND merged_into_place_id IN (
    SELECT place_id FROM trapper.places WHERE merged_into_place_id IS NOT NULL
  );

-- Step 5: Prevention trigger
\echo ''
\echo 'Step 5: Creating prevention trigger'

CREATE OR REPLACE FUNCTION trapper.trg_flatten_place_merge_target()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.merged_into_place_id IS NOT NULL THEN
        NEW.merged_into_place_id := trapper.get_canonical_place_id(NEW.merged_into_place_id);
        IF NEW.merged_into_place_id = NEW.place_id THEN
            RAISE EXCEPTION 'Cannot merge place % into itself', NEW.place_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.trg_flatten_place_merge_target IS
'Prevents place merge chain formation by resolving target to canonical. Part of TASK_003.';

DROP TRIGGER IF EXISTS trg_prevent_place_merge_chain ON trapper.places;

CREATE TRIGGER trg_prevent_place_merge_chain
    BEFORE INSERT OR UPDATE OF merged_into_place_id
    ON trapper.places
    FOR EACH ROW
    WHEN (NEW.merged_into_place_id IS NOT NULL)
    EXECUTE FUNCTION trapper.trg_flatten_place_merge_target();

-- Step 6: Final summary
\echo ''
\echo '====== MIG_771 SUMMARY ======'

\echo 'Final chain check (must be 0):'
SELECT COUNT(*) AS chains_remaining
FROM trapper.places
WHERE merged_into_place_id IS NOT NULL
  AND merged_into_place_id IN (
    SELECT place_id FROM trapper.places WHERE merged_into_place_id IS NOT NULL
  );

\echo ''
\echo '=== MIG_771 Complete ==='
