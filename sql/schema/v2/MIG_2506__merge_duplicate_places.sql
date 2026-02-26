-- MIG_2506: Merge Duplicate Places
--
-- Problem: 939 extra duplicate places exist across 77 address groups.
-- Worst case: 142 duplicates at 3301 Tomales Petaluma Rd.
-- Root cause: Places created one-per-appointment instead of using find_or_create_place_deduped()
--
-- Solution:
-- 1. Create sot.merge_place_into() function for atomic place merging
-- 2. Identify duplicate groups by formatted_address
-- 3. For each group, merge all duplicates into the place with most references
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2506: Merge Duplicate Places'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. Add missing columns for merge tracking
-- ============================================================================

\echo '0. Adding merged_at and merge_reason columns if missing...'

ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;
ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS merge_reason TEXT;

-- ============================================================================
-- 1. Pre-check: Count duplicates
-- ============================================================================

\echo '1. Pre-check: Counting duplicate place groups...'

WITH dups AS (
  SELECT formatted_address, COUNT(*) as cnt
  FROM sot.places
  WHERE merged_into_place_id IS NULL
    AND formatted_address IS NOT NULL
  GROUP BY formatted_address
  HAVING COUNT(*) > 1
)
SELECT 'duplicate_groups' as metric, COUNT(*) as value FROM dups
UNION ALL
SELECT 'total_duplicate_places', SUM(cnt) FROM dups
UNION ALL
SELECT 'extra_duplicates', SUM(cnt) - COUNT(*) FROM dups;

-- ============================================================================
-- 2. Create sot.merge_place_into() function
-- ============================================================================

\echo ''
\echo '2. Creating sot.merge_place_into() function...'

DROP FUNCTION IF EXISTS sot.merge_place_into(UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.merge_place_into(
  p_loser_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT 'duplicate_address',
  p_changed_by TEXT DEFAULT 'MIG_2506'
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_loser_addr TEXT;
  v_winner_addr TEXT;
BEGIN
  -- Validate both exist and aren't already merged
  SELECT formatted_address INTO v_loser_addr
  FROM sot.places WHERE place_id = p_loser_id AND merged_into_place_id IS NULL;
  IF NOT FOUND THEN
    RAISE NOTICE 'Loser % not found or already merged, skipping', p_loser_id;
    RETURN;
  END IF;

  SELECT formatted_address INTO v_winner_addr
  FROM sot.places WHERE place_id = p_winner_id AND merged_into_place_id IS NULL;
  IF NOT FOUND THEN
    RAISE NOTICE 'Winner % not found or already merged, skipping', p_winner_id;
    RETURN;
  END IF;

  -- ── Core entity references ──

  -- Requests
  UPDATE ops.requests SET place_id = p_winner_id WHERE place_id = p_loser_id;

  -- Appointments (both place_id and inferred_place_id)
  UPDATE ops.appointments SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE ops.appointments SET inferred_place_id = p_winner_id WHERE inferred_place_id = p_loser_id;

  -- ── Person-place: ON CONFLICT update existing ──
  UPDATE sot.person_place SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_place pp2
      WHERE pp2.person_id = person_place.person_id
        AND pp2.place_id = p_winner_id
        AND pp2.relationship_type = person_place.relationship_type
    );
  -- Delete remaining conflicts
  DELETE FROM sot.person_place WHERE place_id = p_loser_id;

  -- ── Cat-place: same pattern ──
  UPDATE sot.cat_place SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.cat_place cp2
      WHERE cp2.cat_id = cat_place.cat_id
        AND cp2.place_id = p_winner_id
        AND cp2.relationship_type = cat_place.relationship_type
    );
  DELETE FROM sot.cat_place WHERE place_id = p_loser_id;

  -- Cat-place original_place_id (if column exists)
  BEGIN
    UPDATE sot.cat_place SET original_place_id = p_winner_id
    WHERE original_place_id = p_loser_id;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- Column doesn't exist, skip
  END;

  -- ── Colony & context ──

  -- Place conditions
  UPDATE sot.place_conditions SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_conditions pc2
      WHERE pc2.place_id = p_winner_id AND pc2.condition_type = place_conditions.condition_type
    );
  DELETE FROM sot.place_conditions WHERE place_id = p_loser_id;

  -- Colony estimates
  UPDATE sot.colony_estimates SET place_id = p_winner_id
  WHERE place_id = p_loser_id;

  -- Place contexts (if exists)
  BEGIN
    UPDATE sot.place_contexts SET place_id = p_winner_id
    WHERE place_id = p_loser_id
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_contexts pc2
        WHERE pc2.place_id = p_winner_id AND pc2.context_type = place_contexts.context_type
      );
    DELETE FROM sot.place_contexts WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    NULL; -- Table doesn't exist
  END;

  -- ── Disease tracking ──

  -- Place disease status (if exists)
  BEGIN
    UPDATE ops.place_disease_status SET place_id = p_winner_id
    WHERE place_id = p_loser_id
      AND NOT EXISTS (
        SELECT 1 FROM ops.place_disease_status pds2
        WHERE pds2.place_id = p_winner_id
      );
    DELETE FROM ops.place_disease_status WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ── Intake ──

  -- Web intake submissions
  BEGIN
    UPDATE ops.web_intake_submissions SET selected_address_place_id = p_winner_id
    WHERE selected_address_place_id = p_loser_id;
    UPDATE ops.web_intake_submissions SET place_id = p_winner_id
    WHERE place_id = p_loser_id;
    UPDATE ops.web_intake_submissions SET matched_place_id = p_winner_id
    WHERE matched_place_id = p_loser_id;
    UPDATE ops.web_intake_submissions SET requester_place_id = p_winner_id
    WHERE requester_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- ── Google/Map entries ──

  BEGIN
    UPDATE ops.google_map_entries SET linked_place_id = p_winner_id
    WHERE linked_place_id = p_loser_id;
    UPDATE ops.google_map_entries SET nearest_place_id = p_winner_id
    WHERE nearest_place_id = p_loser_id;
    UPDATE ops.google_map_entries SET place_id = p_winner_id
    WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- ── Clinic owner accounts ──

  BEGIN
    UPDATE ops.clinic_owner_accounts SET resolved_place_id = p_winner_id
    WHERE resolved_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- ── People primary address ──

  UPDATE sot.people SET primary_address_id = p_winner_id
  WHERE primary_address_id = p_loser_id;

  -- ── Cat lifecycle events ──

  BEGIN
    UPDATE sot.cat_lifecycle_events SET place_id = p_winner_id
    WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ── Cat movement events ──

  BEGIN
    UPDATE sot.cat_movement_events SET from_place_id = p_winner_id
    WHERE from_place_id = p_loser_id;
    UPDATE sot.cat_movement_events SET to_place_id = p_winner_id
    WHERE to_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ── Journal entries ──

  BEGIN
    UPDATE ops.journal_entries SET primary_place_id = p_winner_id
    WHERE primary_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- ── Trapper service territories ──

  BEGIN
    UPDATE sot.trapper_assigned_places SET place_id = p_winner_id
    WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ── Self-references (parent_place_id) ──

  UPDATE sot.places SET parent_place_id = p_winner_id
  WHERE parent_place_id = p_loser_id;

  -- ── Place soft blacklist ──

  BEGIN
    UPDATE sot.place_soft_blacklist SET place_id = p_winner_id
    WHERE place_id = p_loser_id
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_soft_blacklist psb2
        WHERE psb2.place_id = p_winner_id
      );
    DELETE FROM sot.place_soft_blacklist WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ── Mark loser as merged ──

  UPDATE sot.places
  SET merged_into_place_id = p_winner_id,
      merged_at = NOW(),
      merge_reason = p_reason
  WHERE place_id = p_loser_id;

  -- ── Audit trail ──

  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name,
    old_value, new_value, change_source
  ) VALUES (
    'place', p_loser_id, 'merged_into_place_id',
    v_loser_addr, p_winner_id::text,
    'migration:' || p_changed_by || ':' || p_reason
  );

END;
$function$;

COMMENT ON FUNCTION sot.merge_place_into IS
'Atomically merges one place into another: relinks all FK references, marks loser as merged, logs to entity_edits. MIG_2506.';

\echo '   Created sot.merge_place_into()'

-- ============================================================================
-- 3. Merge duplicate places by formatted_address
-- ============================================================================

\echo ''
\echo '3. Merging duplicate places...'

DO $$
DECLARE
  v_group RECORD;
  v_place RECORD;
  v_winner_id UUID;
  v_winner_refs INT;
  v_refs INT;
  v_merged_count INT := 0;
  v_group_count INT := 0;
BEGIN
  -- Loop through each duplicate group
  FOR v_group IN
    SELECT formatted_address
    FROM sot.places
    WHERE merged_into_place_id IS NULL
      AND formatted_address IS NOT NULL
    GROUP BY formatted_address
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  LOOP
    v_group_count := v_group_count + 1;
    v_winner_id := NULL;
    v_winner_refs := -1;

    -- Find the place with most references to be the winner
    FOR v_place IN
      SELECT p.place_id,
        (
          (SELECT COUNT(*) FROM ops.requests WHERE place_id = p.place_id) +
          (SELECT COUNT(*) FROM ops.appointments WHERE place_id = p.place_id) +
          (SELECT COUNT(*) FROM ops.appointments WHERE inferred_place_id = p.place_id) +
          (SELECT COUNT(*) FROM sot.person_place WHERE place_id = p.place_id) +
          (SELECT COUNT(*) FROM sot.cat_place WHERE place_id = p.place_id)
        ) as ref_count
      FROM sot.places p
      WHERE p.formatted_address = v_group.formatted_address
        AND p.merged_into_place_id IS NULL
      ORDER BY ref_count DESC, p.created_at ASC
    LOOP
      IF v_winner_id IS NULL THEN
        -- First place (most refs) is the winner
        v_winner_id := v_place.place_id;
        v_winner_refs := v_place.ref_count;
      ELSE
        -- Merge this place into winner
        PERFORM sot.merge_place_into(v_place.place_id, v_winner_id, 'MIG_2506_duplicate_address', 'MIG_2506');
        v_merged_count := v_merged_count + 1;
      END IF;
    END LOOP;

    -- Progress notification every 10 groups
    IF v_group_count % 10 = 0 THEN
      RAISE NOTICE 'Processed % groups, merged % places...', v_group_count, v_merged_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'Merge complete: % groups processed, % places merged', v_group_count, v_merged_count;
END;
$$;

-- ============================================================================
-- 4. Post-check: Verify no duplicates remain
-- ============================================================================

\echo ''
\echo '4. Post-check: Verifying results...'

SELECT 'active_places' as metric, COUNT(*) as value
FROM sot.places WHERE merged_into_place_id IS NULL
UNION ALL
SELECT 'merged_places', COUNT(*)
FROM sot.places WHERE merged_into_place_id IS NOT NULL
UNION ALL
SELECT 'remaining_duplicate_groups', COUNT(*)
FROM (
  SELECT formatted_address, COUNT(*) as cnt
  FROM sot.places
  WHERE merged_into_place_id IS NULL
    AND formatted_address IS NOT NULL
  GROUP BY formatted_address
  HAVING COUNT(*) > 1
) dups;

-- ============================================================================
-- 5. Show sample of merged places for verification
-- ============================================================================

\echo ''
\echo '5. Sample of merged places (top 5 by merge count)...'

SELECT
  winner.formatted_address,
  winner.place_id as winner_place_id,
  COUNT(*) as merged_into_this
FROM sot.places loser
JOIN sot.places winner ON loser.merged_into_place_id = winner.place_id
WHERE loser.merge_reason = 'MIG_2506_duplicate_address'
GROUP BY winner.formatted_address, winner.place_id
ORDER BY COUNT(*) DESC
LIMIT 5;

\echo ''
\echo '=============================================='
\echo '  MIG_2506 Complete'
\echo '=============================================='
\echo ''
\echo 'Created: sot.merge_place_into() function'
\echo 'Merged: Duplicate places by formatted_address'
\echo 'Result: Each unique address now has one canonical place'
\echo ''
