-- MIG_256: Improve merge_places function to handle all FK relationships
--
-- Problem: The merge_places function was failing to merge places that had:
--   - Other places merged into them (merged_into_place_id FK)
--   - Child units (parent_place_id FK)
--   - Cat movement events (from_place_id, to_place_id FKs)
--   - Matched intake submissions (matched_place_id FK)
--
-- Solution: Update the function to:
--   1. Cascade merged_into_place_id references to the keep place
--   2. Re-parent child units
--   3. Transfer cat movement events
--   4. Transfer matched_place_id references
--   5. Soft-delete (mark as merged) instead of hard delete
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_256__improve_merge_places_function.sql

\echo ''
\echo 'MIG_256: Improve merge_places function'
\echo '======================================='
\echo ''

CREATE OR REPLACE FUNCTION trapper.merge_places(
  p_keep_place_id uuid,
  p_remove_place_id uuid,
  p_merge_reason text DEFAULT 'manual'
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    v_keep_record RECORD;
    v_remove_record RECORD;
BEGIN
    SELECT * INTO v_keep_record FROM trapper.places WHERE place_id = p_keep_place_id;
    SELECT * INTO v_remove_record FROM trapper.places WHERE place_id = p_remove_place_id;

    IF v_keep_record IS NULL OR v_remove_record IS NULL THEN
        RETURN FALSE;
    END IF;

    RAISE NOTICE 'Merging "%" into "%"', v_remove_record.formatted_address, v_keep_record.formatted_address;

    -- Update all FK references to sot tables
    UPDATE trapper.sot_requests SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
    UPDATE trapper.sot_appointments SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- Handle web_intake_submissions (both place_id and matched_place_id)
    UPDATE trapper.web_intake_submissions SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
    UPDATE trapper.web_intake_submissions SET matched_place_id = p_keep_place_id WHERE matched_place_id = p_remove_place_id;

    -- Handle places pointing to this one via merged_into_place_id (cascade the merge)
    UPDATE trapper.places SET merged_into_place_id = p_keep_place_id WHERE merged_into_place_id = p_remove_place_id;

    -- Handle places with this as parent (unit hierarchy)
    UPDATE trapper.places SET parent_place_id = p_keep_place_id WHERE parent_place_id = p_remove_place_id;

    -- Handle cat_movement_events
    UPDATE trapper.cat_movement_events SET from_place_id = p_keep_place_id WHERE from_place_id = p_remove_place_id;
    UPDATE trapper.cat_movement_events SET to_place_id = p_keep_place_id WHERE to_place_id = p_remove_place_id;

    -- Handle person_place_relationships (delete dups, update rest)
    DELETE FROM trapper.person_place_relationships
    WHERE place_id = p_remove_place_id
      AND person_id IN (SELECT person_id FROM trapper.person_place_relationships WHERE place_id = p_keep_place_id);
    UPDATE trapper.person_place_relationships SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- Handle cat_place_relationships
    DELETE FROM trapper.cat_place_relationships
    WHERE place_id = p_remove_place_id
      AND cat_id IN (SELECT cat_id FROM trapper.cat_place_relationships WHERE place_id = p_keep_place_id);
    UPDATE trapper.cat_place_relationships SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- Handle colony estimates
    DELETE FROM trapper.place_colony_estimates
    WHERE place_id = p_remove_place_id
      AND source_record_id IN (SELECT source_record_id FROM trapper.place_colony_estimates WHERE place_id = p_keep_place_id AND source_record_id IS NOT NULL);
    UPDATE trapper.place_colony_estimates SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- Merge data (keep better data from either record)
    UPDATE trapper.places p
    SET
        location = COALESCE(p.location, v_remove_record.location),
        has_cat_activity = p.has_cat_activity OR COALESCE(v_remove_record.has_cat_activity, FALSE),
        has_trapping_activity = p.has_trapping_activity OR COALESCE(v_remove_record.has_trapping_activity, FALSE),
        has_appointment_activity = p.has_appointment_activity OR COALESCE(v_remove_record.has_appointment_activity, FALSE),
        colony_size_estimate = COALESCE(p.colony_size_estimate, v_remove_record.colony_size_estimate),
        notes = CASE
          WHEN p.notes IS NOT NULL AND v_remove_record.notes IS NOT NULL
          THEN p.notes || E'\n[Merged from ' || LEFT(v_remove_record.formatted_address, 50) || ']: ' || v_remove_record.notes
          ELSE COALESCE(p.notes, v_remove_record.notes)
        END,
        updated_at = NOW()
    WHERE p.place_id = p_keep_place_id;

    -- Log merge to data_changes
    INSERT INTO trapper.data_changes (entity_type, entity_key, field_name, old_value, new_value, change_source)
    VALUES ('place', p_keep_place_id::TEXT, 'merged_from', p_remove_place_id::TEXT, v_remove_record.formatted_address, p_merge_reason);

    -- Mark removed place as merged (soft delete)
    UPDATE trapper.places
    SET
      merged_into_place_id = p_keep_place_id,
      merged_at = NOW(),
      merge_reason = p_merge_reason
    WHERE place_id = p_remove_place_id;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error merging: %', SQLERRM;
    RETURN FALSE;
END;
$function$;

\echo ''
\echo 'MIG_256 complete!'
\echo '  - merge_places function now handles all FK relationships'
\echo '  - Places are soft-deleted (marked as merged) instead of hard deleted'
\echo '  - Cascades merged_into_place_id to keep chain integrity'
\echo ''
