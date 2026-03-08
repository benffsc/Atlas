-- MIG_2872: Fix merge_cats entity_edits column name + backfill SL identifiers (FFS-323)
--
-- Companion to MIG_2871. Fixes discovered during merge execution:
-- 1. merge_cats() used 'changed_by' column but entity_edits has 'edited_by' + requires 'edit_source'
-- 2. After merge, winner cats need SL identifiers transferred from merged losers
--
-- Applied manually 2026-03-08. This file documents the fixes for reproducibility.

-- =============================================================================
-- Step 1: Fix merge_cats function (column names + required fields)
-- =============================================================================

CREATE OR REPLACE FUNCTION sot.merge_cats(p_loser_id uuid, p_winner_id uuid, p_reason text DEFAULT 'duplicate'::text, p_changed_by text DEFAULT 'system'::text)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
  v_loser_name TEXT;
  v_winner_name TEXT;
BEGIN
  SELECT name INTO v_loser_name FROM sot.cats WHERE cat_id = p_loser_id;
  SELECT name INTO v_winner_name FROM sot.cats WHERE cat_id = p_winner_id;

  IF NOT EXISTS (SELECT 1 FROM sot.cats WHERE cat_id = p_loser_id AND merged_into_cat_id IS NULL) THEN
    RAISE EXCEPTION 'Loser cat % not found or already merged', p_loser_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sot.cats WHERE cat_id = p_winner_id AND merged_into_cat_id IS NULL) THEN
    RAISE EXCEPTION 'Winner cat % not found or already merged', p_winner_id;
  END IF;

  UPDATE ops.appointments SET cat_id = p_winner_id WHERE cat_id = p_loser_id;

  INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
  SELECT p_winner_id, id_type, id_value, confidence, source_system, created_at
  FROM sot.cat_identifiers WHERE cat_id = p_loser_id
  ON CONFLICT (id_type, id_value) DO NOTHING;

  INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, confidence, source_system, created_at)
  SELECT p_winner_id, place_id, relationship_type, confidence, source_system, created_at
  FROM sot.cat_place WHERE cat_id = p_loser_id
  ON CONFLICT DO NOTHING;

  INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, confidence, source_system, created_at)
  SELECT person_id, p_winner_id, relationship_type, confidence, source_system, created_at
  FROM sot.person_cat WHERE cat_id = p_loser_id
  ON CONFLICT DO NOTHING;

  -- Also copy denormalized SL ID to winner
  UPDATE sot.cats
  SET shelterluv_animal_id = (SELECT shelterluv_animal_id FROM sot.cats WHERE cat_id = p_loser_id)
  WHERE cat_id = p_winner_id
    AND shelterluv_animal_id IS NULL
    AND (SELECT shelterluv_animal_id FROM sot.cats WHERE cat_id = p_loser_id) IS NOT NULL;

  UPDATE sot.cats
  SET merged_into_cat_id = p_winner_id, updated_at = NOW()
  WHERE cat_id = p_loser_id;

  -- FIXED: use edited_by (not changed_by), include edit_source and reason
  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES (
    'cat',
    p_loser_id,
    'merge',
    jsonb_build_object(
      'loser_id', p_loser_id,
      'loser_name', v_loser_name,
      'merged_into', p_winner_id,
      'winner_name', v_winner_name
    ),
    NULL,
    p_changed_by,
    'migration',
    p_reason,
    NOW()
  );

  RETURN TRUE;
END;
$function$;

-- =============================================================================
-- Step 2: Backfill shelterluv_animal_id on winner cats (already applied)
-- =============================================================================

-- UPDATE sot.cats winner
-- SET shelterluv_animal_id = sl.shelterluv_animal_id
-- FROM sot.cats sl
-- WHERE sl.merged_into_cat_id = winner.cat_id
--   AND sl.source_system = 'shelterluv'
--   AND sl.shelterluv_animal_id IS NOT NULL
--   AND winner.shelterluv_animal_id IS NULL;

-- =============================================================================
-- Step 3: Move cat_identifiers from merged losers to winners (already applied)
-- =============================================================================

-- INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
-- SELECT sl.merged_into_cat_id, ci.id_type, ci.id_value, ci.confidence, ci.source_system, ci.created_at
-- FROM sot.cat_identifiers ci
-- JOIN sot.cats sl ON sl.cat_id = ci.cat_id
-- WHERE sl.merged_into_cat_id IS NOT NULL
--   AND sl.source_system = 'shelterluv'
--   AND ci.id_type = 'shelterluv_animal_id'
-- ON CONFLICT (id_type, id_value) DO UPDATE SET cat_id = EXCLUDED.cat_id;
