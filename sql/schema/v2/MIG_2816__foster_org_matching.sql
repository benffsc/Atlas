-- MIG_2816__foster_org_matching.sql
-- FFS-106: Add foster parent name and shelter animal ID matching passes
-- These run after owner_name (pass 1) but before cat_name (pass 2)

-- Pass 5: Match foster entries by foster_parent_name
CREATE OR REPLACE FUNCTION ops.match_master_list_by_foster(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
BEGIN
  -- Match foster entries where foster_parent_name matches appointment client/owner
  -- Use cat name for disambiguation when foster parent has multiple appointments
  WITH matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'high',
      match_reason = 'foster_parent_name',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id,
        -- Prefer cat name match for disambiguation
        COALESCE(
          similarity(LOWER(COALESCE(e2.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))),
          0
        ) AS cat_sim
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
      LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      LEFT JOIN sot.people owner ON owner.person_id = a.person_id AND owner.merged_into_person_id IS NULL
      LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.is_foster = TRUE
        AND e2.foster_parent_name IS NOT NULL
        AND (
          LOWER(TRIM(e2.foster_parent_name)) = LOWER(TRIM(owner.display_name))
          OR LOWER(TRIM(e2.foster_parent_name)) = LOWER(TRIM(CONCAT(owner.first_name, ' ', owner.last_name)))
          OR LOWER(TRIM(e2.foster_parent_name)) = LOWER(TRIM(ca.display_name))
          OR LOWER(TRIM(e2.foster_parent_name)) = LOWER(TRIM(a.client_name))
        )
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
        )
      ORDER BY e2.entry_id, cat_sim DESC
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM matches;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

-- Pass 6: Match shelter entries by shelter_animal_id
CREATE OR REPLACE FUNCTION ops.match_master_list_by_shelter_id(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
BEGIN
  -- Match shelter entries where shelter_animal_id matches cats.shelterluv_animal_id
  WITH matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'high',
      match_reason = 'shelter_animal_id',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
      JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.is_shelter = TRUE
        AND e2.shelter_animal_id IS NOT NULL
        AND c.shelterluv_animal_id IS NOT NULL
        AND TRIM(e2.shelter_animal_id) = TRIM(c.shelterluv_animal_id)
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
        )
      ORDER BY e2.entry_id
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM matches;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

-- Update main function: owner_name → foster → shelter_id → cat_name → sex → cardinality
CREATE OR REPLACE FUNCTION ops.apply_smart_master_list_matches(p_clinic_date DATE)
RETURNS TABLE (pass TEXT, entries_matched INT) AS $$
DECLARE
  v_pass1 INT;
  v_pass5 INT;
  v_pass6 INT;
  v_pass2 INT;
  v_pass3 INT;
  v_pass4 INT;
BEGIN
  -- Ensure clinic day exists
  INSERT INTO ops.clinic_days (clinic_date)
  VALUES (p_clinic_date)
  ON CONFLICT (clinic_date) DO NOTHING;

  -- Run each pass in order (foster/shelter before fuzzy passes for higher confidence)
  v_pass1 := ops.match_master_list_by_owner_name(p_clinic_date);
  v_pass5 := ops.match_master_list_by_foster(p_clinic_date);
  v_pass6 := ops.match_master_list_by_shelter_id(p_clinic_date);
  v_pass2 := ops.match_master_list_by_cat_name(p_clinic_date);
  v_pass3 := ops.match_master_list_by_sex(p_clinic_date);
  v_pass4 := ops.match_master_list_by_cardinality(p_clinic_date);

  -- Return results
  pass := 'owner_name'; entries_matched := v_pass1; RETURN NEXT;
  pass := 'foster'; entries_matched := v_pass5; RETURN NEXT;
  pass := 'shelter_id'; entries_matched := v_pass6; RETURN NEXT;
  pass := 'cat_name'; entries_matched := v_pass2; RETURN NEXT;
  pass := 'sex'; entries_matched := v_pass3; RETURN NEXT;
  pass := 'cardinality'; entries_matched := v_pass4; RETURN NEXT;
  pass := 'total'; entries_matched := v_pass1 + v_pass5 + v_pass6 + v_pass2 + v_pass3 + v_pass4; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_foster IS 'Pass 5: Match foster entries by foster_parent_name against appointment client/owner';
COMMENT ON FUNCTION ops.match_master_list_by_shelter_id IS 'Pass 6: Match shelter entries by shelter_animal_id against cats.shelterluv_animal_id';
COMMENT ON FUNCTION ops.apply_smart_master_list_matches IS 'Run all 6 matching passes: owner_name → foster → shelter_id → cat_name → sex → cardinality';
