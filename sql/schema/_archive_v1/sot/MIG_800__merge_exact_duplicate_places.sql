\echo '=== MIG_800: Merge exact duplicate places + re-normalize ==='
\echo 'Merges 36 place pairs that collapse to identical normalized addresses'
\echo 'after MIG_799 hardened normalization. Relinks all FK references.'

-- =========================================================================
-- 1. merge_place_into() — Atomic place merge with full FK relinking
-- =========================================================================
-- Relinks ALL foreign key references from loser → winner,
-- then marks loser as merged. Logs to entity_edits.
-- =========================================================================

CREATE OR REPLACE FUNCTION trapper.merge_place_into(
  p_loser_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT 'duplicate_address_normalization',
  p_changed_by TEXT DEFAULT 'MIG_800'
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
  FROM trapper.places WHERE place_id = p_loser_id AND merged_into_place_id IS NULL;
  IF NOT FOUND THEN
    RAISE NOTICE 'Loser % not found or already merged, skipping', p_loser_id;
    RETURN;
  END IF;

  SELECT formatted_address INTO v_winner_addr
  FROM trapper.places WHERE place_id = p_winner_id AND merged_into_place_id IS NULL;
  IF NOT FOUND THEN
    RAISE NOTICE 'Winner % not found or already merged, skipping', p_winner_id;
    RETURN;
  END IF;

  -- ── Core entity references ──
  UPDATE trapper.sot_requests SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.sot_appointments SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.sot_appointments SET inferred_place_id = p_winner_id WHERE inferred_place_id = p_loser_id;

  -- Person-place: ON CONFLICT update existing
  UPDATE trapper.person_place_relationships SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_place_relationships pp2
      WHERE pp2.person_id = person_place_relationships.person_id
        AND pp2.place_id = p_winner_id
        AND pp2.role = person_place_relationships.role
    );
  -- Delete remaining conflicts (person already linked to winner with same role)
  DELETE FROM trapper.person_place_relationships WHERE place_id = p_loser_id;

  -- Cat-place: same pattern
  UPDATE trapper.cat_place_relationships SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_place_relationships cp2
      WHERE cp2.cat_id = cat_place_relationships.cat_id
        AND cp2.place_id = p_winner_id
        AND cp2.relationship_type = cat_place_relationships.relationship_type
    );
  DELETE FROM trapper.cat_place_relationships WHERE place_id = p_loser_id;

  -- Cat-place original_place_id
  UPDATE trapper.cat_place_relationships SET original_place_id = p_winner_id
  WHERE original_place_id = p_loser_id;

  -- ── Colony & context ──
  UPDATE trapper.place_contexts SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.place_contexts pc2
      WHERE pc2.place_id = p_winner_id AND pc2.context_type = place_contexts.context_type
    );
  DELETE FROM trapper.place_contexts WHERE place_id = p_loser_id;

  UPDATE trapper.place_colony_estimates SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.colonies SET primary_place_id = p_winner_id WHERE primary_place_id = p_loser_id;
  UPDATE trapper.colony_places SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.colony_places cp2
      WHERE cp2.place_id = p_winner_id AND cp2.colony_id = colony_places.colony_id
    );
  DELETE FROM trapper.colony_places WHERE place_id = p_loser_id;

  -- ── Intake ──
  UPDATE trapper.web_intake_submissions SET selected_address_place_id = p_winner_id WHERE selected_address_place_id = p_loser_id;
  UPDATE trapper.web_intake_submissions SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.web_intake_submissions SET matched_place_id = p_winner_id WHERE matched_place_id = p_loser_id;
  UPDATE trapper.web_intake_submissions SET requester_place_id = p_winner_id WHERE requester_place_id = p_loser_id;

  -- ── Google/Map entries ──
  UPDATE trapper.google_map_entries SET linked_place_id = p_winner_id WHERE linked_place_id = p_loser_id;
  UPDATE trapper.google_map_entries SET nearest_place_id = p_winner_id WHERE nearest_place_id = p_loser_id;
  UPDATE trapper.google_map_entries SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.google_map_entries SET suggested_parent_place_id = p_winner_id WHERE suggested_parent_place_id = p_loser_id;
  UPDATE trapper.kml_pending_records SET linked_place_id = p_winner_id WHERE linked_place_id = p_loser_id;
  UPDATE trapper.kml_pending_records SET nearest_place_id = p_winner_id WHERE nearest_place_id = p_loser_id;

  -- ── Other entities ──
  UPDATE trapper.households SET primary_place_id = p_winner_id WHERE primary_place_id = p_loser_id;
  UPDATE trapper.known_organizations SET linked_place_id = p_winner_id WHERE linked_place_id = p_loser_id;
  UPDATE trapper.site_observations SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.trapper_site_visits SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.clinic_owner_accounts SET linked_place_id = p_winner_id WHERE linked_place_id = p_loser_id;
  UPDATE trapper.tippy_draft_requests SET place_id = p_winner_id WHERE place_id = p_loser_id;

  -- ── Life events ──
  UPDATE trapper.cat_birth_events SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.cat_mortality_events SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.cat_movement_events SET to_place_id = p_winner_id WHERE to_place_id = p_loser_id;
  UPDATE trapper.cat_movement_events SET from_place_id = p_winner_id WHERE from_place_id = p_loser_id;

  -- ── Other references ──
  UPDATE trapper.journal_entries SET primary_place_id = p_winner_id WHERE primary_place_id = p_loser_id;
  UPDATE trapper.partner_organizations SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.place_changes SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE trapper.request_media SET place_id = p_winner_id WHERE place_id = p_loser_id;

  -- ── Self-references ──
  UPDATE trapper.places SET parent_place_id = p_winner_id WHERE parent_place_id = p_loser_id;

  -- ── Place-place edges ──
  UPDATE trapper.place_place_edges SET place_id_a = p_winner_id
  WHERE place_id_a = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.place_place_edges e2
      WHERE e2.place_id_a = p_winner_id AND e2.place_id_b = place_place_edges.place_id_b
    );
  UPDATE trapper.place_place_edges SET place_id_b = p_winner_id
  WHERE place_id_b = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM trapper.place_place_edges e2
      WHERE e2.place_id_b = p_winner_id AND e2.place_id_a = place_place_edges.place_id_a
    );
  DELETE FROM trapper.place_place_edges WHERE place_id_a = p_loser_id OR place_id_b = p_loser_id;

  -- ── sot_people primary_address_id ──
  UPDATE trapper.sot_people SET primary_address_id = p_winner_id WHERE primary_address_id = p_loser_id;

  -- ── Mark loser as merged ──
  UPDATE trapper.places
  SET merged_into_place_id = p_winner_id,
      merged_at = NOW(),
      merge_reason = p_reason
  WHERE place_id = p_loser_id;

  -- ── Audit trail ──
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value,
    edited_by, edit_source, reason
  ) VALUES (
    'place', p_loser_id, 'merge', 'merged_into_place_id',
    to_jsonb(v_loser_addr), to_jsonb(v_winner_addr),
    p_changed_by, 'migration', 'MIG_800: Duplicate address resolved by hardened normalization'
  );

  RAISE NOTICE 'Merged place % into %', p_loser_id, p_winner_id;
END;
$function$;

COMMENT ON FUNCTION trapper.merge_place_into IS
  'Atomically merges one place into another: relinks all FK references, marks loser as merged, logs to entity_edits. MIG_800.';

-- =========================================================================
-- 2. Merge the 36 colliding pairs
-- =========================================================================
-- For each pair, keep the place with more FK references.
-- =========================================================================

\echo 'Merging 36 duplicate place pairs...'

DO $$
DECLARE
  v_pair RECORD;
  v_refs_a INT;
  v_refs_b INT;
  v_winner UUID;
  v_loser UUID;
  v_count INT := 0;
BEGIN
  FOR v_pair IN
    SELECT a.place_id AS place_a, b.place_id AS place_b
    FROM trapper.places a
    JOIN trapper.places b ON a.place_id < b.place_id
    WHERE a.merged_into_place_id IS NULL
      AND b.merged_into_place_id IS NULL
      AND a.normalized_address IS NOT NULL
      AND b.normalized_address IS NOT NULL
      AND a.normalized_address <> b.normalized_address
      AND trapper.normalize_address(a.formatted_address) = trapper.normalize_address(b.formatted_address)
  LOOP
    -- Count references for each
    SELECT
      (SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id = v_pair.place_a) +
      (SELECT COUNT(*) FROM trapper.person_place_relationships WHERE place_id = v_pair.place_a) +
      (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE place_id = v_pair.place_a)
    INTO v_refs_a;

    SELECT
      (SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id = v_pair.place_b) +
      (SELECT COUNT(*) FROM trapper.person_place_relationships WHERE place_id = v_pair.place_b) +
      (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE place_id = v_pair.place_b)
    INTO v_refs_b;

    -- Keep the one with more references
    IF v_refs_a >= v_refs_b THEN
      v_winner := v_pair.place_a;
      v_loser := v_pair.place_b;
    ELSE
      v_winner := v_pair.place_b;
      v_loser := v_pair.place_a;
    END IF;

    PERFORM trapper.merge_place_into(v_loser, v_winner, 'MIG_800_exact_duplicate', 'MIG_800');
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Merged % duplicate place pairs', v_count;
END;
$$;

-- =========================================================================
-- 3. Re-normalize all remaining active places
-- =========================================================================

\echo 'Re-normalizing all active place addresses...'

UPDATE trapper.places
SET normalized_address = trapper.normalize_address(formatted_address),
    updated_at = NOW()
WHERE formatted_address IS NOT NULL
  AND merged_into_place_id IS NULL
  AND normalized_address IS DISTINCT FROM trapper.normalize_address(formatted_address);

\echo 'Re-normalization complete.'

-- =========================================================================
-- 4. Verify: count remaining issues
-- =========================================================================

\echo 'Verification counts:'

SELECT 'active_places' AS metric, COUNT(*) AS value
FROM trapper.places WHERE merged_into_place_id IS NULL
UNION ALL
SELECT 'merged_places', COUNT(*)
FROM trapper.places WHERE merged_into_place_id IS NOT NULL
UNION ALL
SELECT 'exact_norm_dupes', COUNT(*)
FROM trapper.places a
JOIN trapper.places b ON a.normalized_address = b.normalized_address AND a.place_id < b.place_id
WHERE a.merged_into_place_id IS NULL AND b.merged_into_place_id IS NULL
UNION ALL
SELECT 'uppercase_in_norm', COUNT(*)
FROM trapper.places
WHERE merged_into_place_id IS NULL AND normalized_address <> LOWER(normalized_address)
ORDER BY metric;

\echo '=== MIG_800 complete ==='
\echo 'Created: merge_place_into() function'
\echo 'Merged: ~36 exact duplicate pairs'
\echo 'Re-normalized: all active place addresses'
