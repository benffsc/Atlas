-- MIG_2044: Create sot.merge_person_into function for person deduplication
-- Date: 2026-02-13
-- Issue: Admin person-dedup page needs merge function

-- =========================================================================
-- sot.merge_person_into() — Atomic person merge with full FK relinking
-- =========================================================================
-- Relinks ALL foreign key references from loser → winner,
-- then marks loser as merged. Logs to entity_edits.
-- =========================================================================

CREATE OR REPLACE FUNCTION sot.merge_person_into(
  p_loser_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT 'duplicate_person',
  p_changed_by TEXT DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_loser_name TEXT;
  v_winner_name TEXT;
BEGIN
  -- Validate both exist and aren't already merged
  SELECT COALESCE(display_name, first_name || ' ' || last_name) INTO v_loser_name
  FROM sot.people WHERE person_id = p_loser_id AND merged_into_person_id IS NULL;
  IF NOT FOUND THEN
    RAISE NOTICE 'Loser % not found or already merged, skipping', p_loser_id;
    RETURN;
  END IF;

  SELECT COALESCE(display_name, first_name || ' ' || last_name) INTO v_winner_name
  FROM sot.people WHERE person_id = p_winner_id AND merged_into_person_id IS NULL;
  IF NOT FOUND THEN
    RAISE NOTICE 'Winner % not found or already merged, skipping', p_winner_id;
    RETURN;
  END IF;

  -- ── Person identifiers ──
  -- Move identifiers, skip if already exists on winner
  UPDATE sot.person_identifiers SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_identifiers pi2
      WHERE pi2.person_id = p_winner_id
        AND pi2.id_type = person_identifiers.id_type
        AND pi2.id_value_norm = person_identifiers.id_value_norm
    );
  -- Delete remaining conflicts
  DELETE FROM sot.person_identifiers WHERE person_id = p_loser_id;

  -- ── Person-cat relationships ──
  UPDATE sot.person_cat SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_cat pc2
      WHERE pc2.person_id = p_winner_id
        AND pc2.cat_id = person_cat.cat_id
        AND pc2.relationship_type = person_cat.relationship_type
    );
  DELETE FROM sot.person_cat WHERE person_id = p_loser_id;

  -- ── Person-place relationships ──
  UPDATE sot.person_place SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_place pp2
      WHERE pp2.person_id = p_winner_id
        AND pp2.place_id = person_place.place_id
        AND pp2.relationship_type = person_place.relationship_type
    );
  DELETE FROM sot.person_place WHERE person_id = p_loser_id;

  -- ── Person roles ──
  UPDATE sot.person_roles SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_roles pr2
      WHERE pr2.person_id = p_winner_id
        AND pr2.role = person_roles.role
    );
  DELETE FROM sot.person_roles WHERE person_id = p_loser_id;

  -- ── Appointments ──
  UPDATE ops.appointments SET person_id = p_winner_id WHERE person_id = p_loser_id;
  UPDATE ops.appointments SET resolved_person_id = p_winner_id WHERE resolved_person_id = p_loser_id;

  -- ── Requests ──
  UPDATE ops.requests SET requester_person_id = p_winner_id WHERE requester_person_id = p_loser_id;

  -- ── Request trapper assignments ──
  UPDATE ops.request_trapper_assignments SET trapper_person_id = p_winner_id
  WHERE trapper_person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM ops.request_trapper_assignments rta2
      WHERE rta2.request_id = request_trapper_assignments.request_id
        AND rta2.trapper_person_id = p_winner_id
    );
  DELETE FROM ops.request_trapper_assignments WHERE trapper_person_id = p_loser_id;

  -- ── Intake submissions ──
  UPDATE ops.intake_submissions SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- ── Clinic accounts ──
  UPDATE ops.clinic_accounts SET resolved_person_id = p_winner_id WHERE resolved_person_id = p_loser_id;

  -- ── Colonies ──
  UPDATE sot.colonies SET primary_caretaker_id = p_winner_id WHERE primary_caretaker_id = p_loser_id;

  -- ── Staff ──
  UPDATE ops.staff SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- ── Volunteers ──
  UPDATE ops.volunteers SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM ops.volunteers v2 WHERE v2.person_id = p_winner_id
    );
  DELETE FROM ops.volunteers WHERE person_id = p_loser_id;

  -- ── Communication logs ──
  UPDATE ops.communication_logs SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- ── Journal entries ──
  UPDATE ops.journal_entries SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- ── Mark loser as merged ──
  UPDATE sot.people
  SET merged_into_person_id = p_winner_id,
      updated_at = NOW()
  WHERE person_id = p_loser_id;

  -- ── Audit trail ──
  INSERT INTO sot.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value,
    edited_by, edit_source, reason
  ) VALUES (
    'person', p_loser_id, 'merge', 'merged_into_person_id',
    NULL, p_winner_id::TEXT,
    p_changed_by, 'merge_person_into', p_reason
  );

  RAISE NOTICE 'Merged person % (%) into % (%)',
    p_loser_id, v_loser_name, p_winner_id, v_winner_name;
END;
$function$;

COMMENT ON FUNCTION sot.merge_person_into IS
'Merges one person record into another, relinking all FK references.
Usage: SELECT sot.merge_person_into(loser_id, winner_id, reason, changed_by);
All identifiers, relationships, and entity references move from loser to winner.';

-- Verify function created
SELECT 'sot.merge_person_into created' as status;
