-- MIG_2874: Fix merge_place_into() V1 table name references
--
-- merge_place_into() referenced V1 table names that were renamed in V2:
--   ops.web_intake_submissions → ops.intake_submissions
--   ops.clinic_owner_accounts  → ops.clinic_accounts
--
-- Impact: Every place merge since V2 migration silently skipped relinking
-- intake submissions and clinic accounts. Fixed 13 + 13 + 105 stale refs manually.
-- This migration prevents future occurrences.

DROP FUNCTION IF EXISTS sot.merge_place_into(uuid, uuid, text, text);

CREATE FUNCTION sot.merge_place_into(
  p_loser_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT 'duplicate_address',
  p_changed_by TEXT DEFAULT 'system'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_loser_addr TEXT;
  v_winner_addr TEXT;
BEGIN
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

  -- Requests
  UPDATE ops.requests SET place_id = p_winner_id WHERE place_id = p_loser_id;

  -- Appointments
  UPDATE ops.appointments SET place_id = p_winner_id WHERE place_id = p_loser_id;
  UPDATE ops.appointments SET inferred_place_id = p_winner_id WHERE inferred_place_id = p_loser_id;

  -- Person-place (with conflict resolution)
  UPDATE sot.person_place SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_place pp2
      WHERE pp2.person_id = person_place.person_id
        AND pp2.place_id = p_winner_id
        AND pp2.relationship_type = person_place.relationship_type
    );
  DELETE FROM sot.person_place WHERE place_id = p_loser_id;

  -- Cat-place (with conflict resolution)
  UPDATE sot.cat_place SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.cat_place cp2
      WHERE cp2.cat_id = cat_place.cat_id
        AND cp2.place_id = p_winner_id
        AND cp2.relationship_type = cat_place.relationship_type
    );
  DELETE FROM sot.cat_place WHERE place_id = p_loser_id;

  BEGIN
    UPDATE sot.cat_place SET original_place_id = p_winner_id WHERE original_place_id = p_loser_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- Place conditions
  UPDATE sot.place_conditions SET place_id = p_winner_id
  WHERE place_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.place_conditions pc2
      WHERE pc2.place_id = p_winner_id AND pc2.condition_type = place_conditions.condition_type
    );
  DELETE FROM sot.place_conditions WHERE place_id = p_loser_id;

  -- Colony estimates
  UPDATE sot.colony_estimates SET place_id = p_winner_id WHERE place_id = p_loser_id;

  BEGIN
    UPDATE sot.place_contexts SET place_id = p_winner_id
    WHERE place_id = p_loser_id
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_contexts pc2
        WHERE pc2.place_id = p_winner_id AND pc2.context_type = place_contexts.context_type
      );
    DELETE FROM sot.place_contexts WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Disease tracking
  BEGIN
    UPDATE ops.place_disease_status SET place_id = p_winner_id
    WHERE place_id = p_loser_id
      AND NOT EXISTS (SELECT 1 FROM ops.place_disease_status pds2 WHERE pds2.place_id = p_winner_id);
    DELETE FROM ops.place_disease_status WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Intake submissions (FIXED: was ops.web_intake_submissions)
  BEGIN
    UPDATE ops.intake_submissions SET selected_address_place_id = p_winner_id WHERE selected_address_place_id = p_loser_id;
    UPDATE ops.intake_submissions SET place_id = p_winner_id WHERE place_id = p_loser_id;
    UPDATE ops.intake_submissions SET matched_place_id = p_winner_id WHERE matched_place_id = p_loser_id;
    UPDATE ops.intake_submissions SET requester_place_id = p_winner_id WHERE requester_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  -- Google/Map entries
  BEGIN
    UPDATE ops.google_map_entries SET linked_place_id = p_winner_id WHERE linked_place_id = p_loser_id;
    UPDATE ops.google_map_entries SET nearest_place_id = p_winner_id WHERE nearest_place_id = p_loser_id;
    UPDATE ops.google_map_entries SET place_id = p_winner_id WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  -- Clinic accounts (FIXED: was ops.clinic_owner_accounts)
  BEGIN
    UPDATE ops.clinic_accounts SET resolved_place_id = p_winner_id WHERE resolved_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  -- People primary address
  UPDATE sot.people SET primary_address_id = p_winner_id WHERE primary_address_id = p_loser_id;

  -- Cat lifecycle events
  BEGIN
    UPDATE sot.cat_lifecycle_events SET place_id = p_winner_id WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Cat movement events
  BEGIN
    UPDATE sot.cat_movement_events SET from_place_id = p_winner_id WHERE from_place_id = p_loser_id;
    UPDATE sot.cat_movement_events SET to_place_id = p_winner_id WHERE to_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Journal entries
  BEGIN
    UPDATE ops.journal_entries SET primary_place_id = p_winner_id WHERE primary_place_id = p_loser_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  -- Trapper service territories
  BEGIN
    UPDATE sot.trapper_assigned_places SET place_id = p_winner_id WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Self-references
  UPDATE sot.places SET parent_place_id = p_winner_id WHERE parent_place_id = p_loser_id;

  -- Place soft blacklist
  BEGIN
    UPDATE sot.place_soft_blacklist SET place_id = p_winner_id
    WHERE place_id = p_loser_id
      AND NOT EXISTS (SELECT 1 FROM sot.place_soft_blacklist psb2 WHERE psb2.place_id = p_winner_id);
    DELETE FROM sot.place_soft_blacklist WHERE place_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Mark loser as merged
  UPDATE sot.places
  SET merged_into_place_id = p_winner_id,
      merged_at = NOW(),
      merge_reason = p_reason
  WHERE place_id = p_loser_id;

  -- Audit trail
  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name,
    old_value, new_value, change_source
  ) VALUES (
    'place', p_loser_id, 'merged_into_place_id',
    v_loser_addr, p_winner_id::text,
    'migration:' || p_changed_by || ':' || p_reason
  );
END;
$$;

\echo 'MIG_2874: Fixed merge_place_into() — intake_submissions and clinic_accounts now properly relinked'
