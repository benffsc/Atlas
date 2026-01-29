-- ============================================================================
-- MIG_770: Fix Person Merge Chain Black Holes (TASK_002)
-- ============================================================================
-- TASK_LEDGER reference: TASK_002
-- ACTIVE Impact: Yes (Surgical)
--   sot_people.merged_into_person_id is read by request detail, journal, search.
--   However, this migration ONLY modifies already-merged records (invisible to
--   all views that filter WHERE merged_into_person_id IS NULL).
--
-- What this does:
--   1. Creates a backup of all merge pointers before changes
--   2. Flattens all multi-hop merge chains to single-hop
--      (every merged person points directly to its live canonical)
--   3. Adds a prevention trigger so future merges always resolve the
--      target to canonical first, preventing new chains from forming
--
-- Safety:
--   - Only touches merged_into_person_id on records WHERE it IS NOT NULL
--   - All views already exclude merged records — these rows are invisible
--   - No API response shapes change
--   - No trigger behavior changes on ACTIVE surfaces
--   - get_canonical_person_id() already exists (MIG_225) and handles chains
--     at query time; this fix makes the data clean so the function is O(1)
--
-- Rollback:
--   UPDATE trapper.sot_people sp
--   SET merged_into_person_id = b.original_merged_into
--   FROM trapper._backup_person_merge_chains_770 b
--   WHERE b.person_id = sp.person_id;
-- ============================================================================

\echo '=== MIG_770: Fix Person Merge Chain Black Holes (TASK_002) ==='

-- ============================================================================
-- Step 1: Diagnostic — count chains before fix
-- ============================================================================

\echo ''
\echo 'Step 1: Pre-fix diagnostics'

\echo 'Total merged people:'
SELECT COUNT(*) AS total_merged
FROM trapper.sot_people
WHERE merged_into_person_id IS NOT NULL;

\echo 'People in multi-hop chains (the problem):'
SELECT COUNT(*) AS chain_members
FROM trapper.sot_people
WHERE merged_into_person_id IS NOT NULL
  AND merged_into_person_id IN (
    SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
  );

\echo 'Chain depth distribution:'
WITH RECURSIVE chain AS (
    SELECT person_id, merged_into_person_id, 1 AS depth
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NOT NULL

    UNION ALL

    SELECT c.person_id, sp.merged_into_person_id, c.depth + 1
    FROM chain c
    JOIN trapper.sot_people sp ON sp.person_id = c.merged_into_person_id
    WHERE sp.merged_into_person_id IS NOT NULL
      AND c.depth < 20
),
max_depths AS (
    SELECT person_id, MAX(depth) AS max_depth
    FROM chain
    GROUP BY person_id
)
SELECT max_depth AS chain_depth, COUNT(*) AS people_count
FROM max_depths
GROUP BY max_depth
ORDER BY max_depth;

-- ============================================================================
-- Step 2: Create backup of all merge pointers
-- ============================================================================

\echo ''
\echo 'Step 2: Creating backup table _backup_person_merge_chains_770'

DROP TABLE IF EXISTS trapper._backup_person_merge_chains_770;

CREATE TABLE trapper._backup_person_merge_chains_770 AS
SELECT person_id, merged_into_person_id AS original_merged_into, merged_at, merge_reason
FROM trapper.sot_people
WHERE merged_into_person_id IS NOT NULL;

\echo 'Backup rows:'
SELECT COUNT(*) AS backup_rows FROM trapper._backup_person_merge_chains_770;

-- ============================================================================
-- Step 3: Flatten all merge chains to single-hop
-- ============================================================================

\echo ''
\echo 'Step 3: Flattening merge chains to single-hop'

-- Use get_canonical_person_id() (from MIG_225) to resolve each merged
-- person to its final canonical target, then update in one statement.
-- This only touches rows that are currently in multi-hop chains.

UPDATE trapper.sot_people sp
SET merged_into_person_id = trapper.get_canonical_person_id(sp.person_id)
WHERE sp.merged_into_person_id IS NOT NULL
  AND sp.merged_into_person_id IN (
    SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
  );

\echo 'Rows updated (chains flattened):'
SELECT COUNT(*) AS flattened
FROM trapper.sot_people sp
JOIN trapper._backup_person_merge_chains_770 b ON b.person_id = sp.person_id
WHERE sp.merged_into_person_id != b.original_merged_into;

-- ============================================================================
-- Step 4: Verify — zero chains remain
-- ============================================================================

\echo ''
\echo 'Step 4: Verification — chains remaining (should be 0):'

SELECT COUNT(*) AS remaining_chains
FROM trapper.sot_people
WHERE merged_into_person_id IS NOT NULL
  AND merged_into_person_id IN (
    SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
  );

\echo 'All merged people now point to canonical (non-merged) targets:'
SELECT
    COUNT(*) AS total_merged,
    COUNT(*) FILTER (WHERE target.merged_into_person_id IS NULL) AS pointing_to_canonical,
    COUNT(*) FILTER (WHERE target.merged_into_person_id IS NOT NULL) AS still_in_chain
FROM trapper.sot_people sp
JOIN trapper.sot_people target ON target.person_id = sp.merged_into_person_id
WHERE sp.merged_into_person_id IS NOT NULL;

-- ============================================================================
-- Step 5: Prevention trigger — resolve target on merge
-- ============================================================================

\echo ''
\echo 'Step 5: Creating prevention trigger to block future chain formation'

CREATE OR REPLACE FUNCTION trapper.trg_flatten_person_merge_target()
RETURNS TRIGGER AS $$
BEGIN
    -- When merged_into_person_id is set (new merge), resolve the target
    -- to its canonical form to prevent chain formation.
    IF NEW.merged_into_person_id IS NOT NULL THEN
        NEW.merged_into_person_id := trapper.get_canonical_person_id(NEW.merged_into_person_id);

        -- Safety: don't allow self-merge
        IF NEW.merged_into_person_id = NEW.person_id THEN
            RAISE EXCEPTION 'Cannot merge person % into itself', NEW.person_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.trg_flatten_person_merge_target IS
'Prevents merge chain formation by resolving the merge target to its canonical
(non-merged) person before the INSERT/UPDATE completes. Part of TASK_002.';

-- Drop if exists to make migration re-runnable
DROP TRIGGER IF EXISTS trg_prevent_person_merge_chain ON trapper.sot_people;

CREATE TRIGGER trg_prevent_person_merge_chain
    BEFORE INSERT OR UPDATE OF merged_into_person_id
    ON trapper.sot_people
    FOR EACH ROW
    WHEN (NEW.merged_into_person_id IS NOT NULL)
    EXECUTE FUNCTION trapper.trg_flatten_person_merge_target();

\echo 'Prevention trigger created: trg_prevent_person_merge_chain'

-- ============================================================================
-- Step 6: Test prevention trigger
-- ============================================================================

\echo ''
\echo 'Step 6: Testing prevention trigger...'

DO $$
DECLARE
    v_person_a UUID;
    v_person_b UUID;
    v_person_c UUID;
    v_result UUID;
BEGIN
    -- Find 3 non-merged people to test with
    SELECT person_id INTO v_person_a
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
    ORDER BY created_at DESC LIMIT 1;

    SELECT person_id INTO v_person_b
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL AND person_id != v_person_a
    ORDER BY created_at DESC LIMIT 1 OFFSET 1;

    SELECT person_id INTO v_person_c
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL AND person_id != v_person_a AND person_id != v_person_b
    ORDER BY created_at DESC LIMIT 1 OFFSET 2;

    -- Simulate: merge A → B
    UPDATE trapper.sot_people SET merged_into_person_id = v_person_b WHERE person_id = v_person_a;

    -- Simulate: merge C → A (which is merged into B)
    -- The trigger should resolve A → B, so C ends up pointing directly to B
    UPDATE trapper.sot_people SET merged_into_person_id = v_person_a WHERE person_id = v_person_c;

    -- Check: C should point to B (not A)
    SELECT merged_into_person_id INTO v_result
    FROM trapper.sot_people WHERE person_id = v_person_c;

    IF v_result = v_person_b THEN
        RAISE NOTICE 'TEST PASSED: Prevention trigger correctly flattened C → A to C → B';
    ELSE
        RAISE WARNING 'TEST FAILED: C points to % instead of expected %', v_result, v_person_b;
    END IF;

    -- Undo test merges
    UPDATE trapper.sot_people SET merged_into_person_id = NULL, merged_at = NULL WHERE person_id = v_person_a;
    UPDATE trapper.sot_people SET merged_into_person_id = NULL, merged_at = NULL WHERE person_id = v_person_c;
    RAISE NOTICE 'Test cleanup complete — test merges reversed';
END $$;

-- ============================================================================
-- Step 7: Final summary
-- ============================================================================

\echo ''
\echo '====== MIG_770 SUMMARY ======'
\echo ''

\echo 'Final state — merge chain check (must be 0):'
SELECT COUNT(*) AS chains_remaining
FROM trapper.sot_people
WHERE merged_into_person_id IS NOT NULL
  AND merged_into_person_id IN (
    SELECT person_id FROM trapper.sot_people WHERE merged_into_person_id IS NOT NULL
  );

\echo ''
\echo 'Backup table: trapper._backup_person_merge_chains_770'
\echo 'Prevention trigger: trg_prevent_person_merge_chain on sot_people'
\echo ''
\echo 'Rollback SQL:'
\echo '  UPDATE trapper.sot_people sp'
\echo '  SET merged_into_person_id = b.original_merged_into'
\echo '  FROM trapper._backup_person_merge_chains_770 b'
\echo '  WHERE b.person_id = sp.person_id;'
\echo ''
\echo '=== MIG_770 Complete ==='
