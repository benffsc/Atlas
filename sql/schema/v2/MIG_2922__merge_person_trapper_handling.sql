-- MIG_2922: Add trapper table handling to merge_person_into()
--
-- Problem: merge_person_into() doesn't handle:
--   1. sot.trapper_profiles (PK = person_id)
--   2. sot.trapper_service_places (UNIQUE on person_id + place_id)
--   3. source.volunteerhub_volunteers.matched_person_id
--
-- MIG_2912 had to manually handle these before calling merge.
-- This makes future trapper merges safe without manual prep.
--
-- Fixes FFS-475

CREATE OR REPLACE FUNCTION sot.merge_person_into(
  p_loser_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_changed_by UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_loser_name TEXT;
  v_winner_name TEXT;
BEGIN
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

  -- person_identifiers: move non-duplicate, delete rest
  UPDATE sot.person_identifiers SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM sot.person_identifiers pi2
      WHERE pi2.person_id = p_winner_id AND pi2.id_type = person_identifiers.id_type
        AND pi2.id_value_norm = person_identifiers.id_value_norm);
  DELETE FROM sot.person_identifiers WHERE person_id = p_loser_id;

  -- person_cat: move non-duplicate, delete rest
  UPDATE sot.person_cat SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc2
      WHERE pc2.person_id = p_winner_id AND pc2.cat_id = person_cat.cat_id
        AND pc2.relationship_type = person_cat.relationship_type);
  DELETE FROM sot.person_cat WHERE person_id = p_loser_id;

  -- person_place: move non-duplicate, delete rest
  UPDATE sot.person_place SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (SELECT 1 FROM sot.person_place pp2
      WHERE pp2.person_id = p_winner_id AND pp2.place_id = person_place.place_id
        AND pp2.relationship_type = person_place.relationship_type);
  DELETE FROM sot.person_place WHERE person_id = p_loser_id;

  -- person_roles: move non-duplicate, delete rest
  UPDATE sot.person_roles SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (SELECT 1 FROM sot.person_roles pr2
      WHERE pr2.person_id = p_winner_id AND pr2.role = person_roles.role);
  DELETE FROM sot.person_roles WHERE person_id = p_loser_id;

  -- appointments
  UPDATE ops.appointments SET person_id = p_winner_id WHERE person_id = p_loser_id;
  UPDATE ops.appointments SET resolved_person_id = p_winner_id WHERE resolved_person_id = p_loser_id;

  -- requests
  UPDATE ops.requests SET requester_person_id = p_winner_id WHERE requester_person_id = p_loser_id;

  -- request_trapper_assignments: move non-duplicate, delete rest
  UPDATE ops.request_trapper_assignments SET trapper_person_id = p_winner_id
  WHERE trapper_person_id = p_loser_id
    AND NOT EXISTS (SELECT 1 FROM ops.request_trapper_assignments rta2
      WHERE rta2.request_id = request_trapper_assignments.request_id
        AND rta2.trapper_person_id = p_winner_id);
  DELETE FROM ops.request_trapper_assignments WHERE trapper_person_id = p_loser_id;

  -- intake_submissions
  UPDATE ops.intake_submissions SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- clinic_accounts
  UPDATE ops.clinic_accounts SET resolved_person_id = p_winner_id WHERE resolved_person_id = p_loser_id;

  -- colonies
  UPDATE sot.colonies SET primary_caretaker_id = p_winner_id WHERE primary_caretaker_id = p_loser_id;

  -- staff
  UPDATE ops.staff SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- volunteers: move if winner doesn't have one, delete rest
  UPDATE ops.volunteers SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (SELECT 1 FROM ops.volunteers v2 WHERE v2.person_id = p_winner_id);
  DELETE FROM ops.volunteers WHERE person_id = p_loser_id;

  -- journal_entries
  UPDATE ops.journal_entries SET person_id = p_winner_id WHERE person_id = p_loser_id;

  -- =========================================================================
  -- MIG_2922: Trapper tables (FFS-475)
  -- =========================================================================

  -- trapper_profiles: PK = person_id, so can't have both.
  -- If winner has profile, enrich with loser's non-null fields, then delete loser.
  -- If only loser has profile, re-key to winner.
  IF EXISTS (SELECT 1 FROM sot.trapper_profiles WHERE person_id = p_winner_id)
     AND EXISTS (SELECT 1 FROM sot.trapper_profiles WHERE person_id = p_loser_id) THEN
    -- Both have profiles: enrich winner with loser's data where winner is NULL
    UPDATE sot.trapper_profiles SET
      trapper_type = COALESCE(trapper_profiles.trapper_type, loser.trapper_type),
      rescue_name = COALESCE(trapper_profiles.rescue_name, loser.rescue_name),
      rescue_place_id = COALESCE(trapper_profiles.rescue_place_id, loser.rescue_place_id),
      rescue_is_registered = COALESCE(trapper_profiles.rescue_is_registered, loser.rescue_is_registered),
      certified_date = COALESCE(trapper_profiles.certified_date, loser.certified_date),
      has_signed_contract = COALESCE(trapper_profiles.has_signed_contract, loser.has_signed_contract),
      contract_signed_date = COALESCE(trapper_profiles.contract_signed_date, loser.contract_signed_date),
      contract_areas = COALESCE(trapper_profiles.contract_areas, loser.contract_areas),
      notes = CASE
        WHEN trapper_profiles.notes IS NULL THEN loser.notes
        WHEN loser.notes IS NULL THEN trapper_profiles.notes
        ELSE trapper_profiles.notes || E'\n[Merged] ' || loser.notes
      END,
      updated_at = NOW()
    FROM sot.trapper_profiles loser
    WHERE trapper_profiles.person_id = p_winner_id
      AND loser.person_id = p_loser_id;
    DELETE FROM sot.trapper_profiles WHERE person_id = p_loser_id;
  ELSIF EXISTS (SELECT 1 FROM sot.trapper_profiles WHERE person_id = p_loser_id) THEN
    -- Only loser has profile: re-key to winner
    UPDATE sot.trapper_profiles SET person_id = p_winner_id, updated_at = NOW()
    WHERE person_id = p_loser_id;
  END IF;

  -- trapper_service_places: UNIQUE(person_id, place_id)
  -- Move non-duplicate, delete rest
  UPDATE sot.trapper_service_places SET person_id = p_winner_id
  WHERE person_id = p_loser_id
    AND NOT EXISTS (SELECT 1 FROM sot.trapper_service_places tsp2
      WHERE tsp2.person_id = p_winner_id
        AND tsp2.place_id = trapper_service_places.place_id);
  DELETE FROM sot.trapper_service_places WHERE person_id = p_loser_id;

  -- volunteerhub_volunteers.matched_person_id
  UPDATE source.volunteerhub_volunteers SET matched_person_id = p_winner_id
  WHERE matched_person_id = p_loser_id;

  -- =========================================================================
  -- Mark loser as merged + audit trail
  -- =========================================================================

  UPDATE sot.people SET merged_into_person_id = p_winner_id, updated_at = NOW()
  WHERE person_id = p_loser_id;

  INSERT INTO sot.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value, edited_by, edit_source, reason
  ) VALUES (
    'person', p_loser_id, 'merge', 'merged_into_person_id',
    NULL, to_jsonb(p_winner_id::text),
    p_changed_by, 'merge_person_into', p_reason
  );

  RAISE NOTICE 'Merged person % (%) into % (%)',
    p_loser_id, v_loser_name, p_winner_id, v_winner_name;
END;
$$;

-- Verification: confirm function signature updated
DO $$
BEGIN
  RAISE NOTICE 'MIG_2922: merge_person_into() updated with trapper_profiles, trapper_service_places, volunteerhub_volunteers handling';
END $$;
