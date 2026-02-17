-- MIG_2330__smart_master_list_matching.sql
-- Smart matching functions for master list to ClinicHQ appointments
-- Part of clinic day ground truth workflow

-- Pass 1: Match by owner name (exact, case-insensitive)
CREATE OR REPLACE FUNCTION ops.match_master_list_by_owner_name(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
BEGIN
  -- Match entries where parsed_owner_name matches appointment owner display name
  WITH matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'high',
      match_reason = 'owner_name_exact',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
      LEFT JOIN sot.people owner ON owner.person_id = a.owner_person_id
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.parsed_owner_name IS NOT NULL
        AND (
          LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(owner.display_name))
          OR LOWER(TRIM(e2.parsed_owner_name)) = LOWER(TRIM(CONCAT(owner.first_name, ' ', owner.last_name)))
        )
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
        )
      ORDER BY e2.entry_id, e2.line_number
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM matches;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

-- Pass 2: Match by cat name (fuzzy, only if unique match)
CREATE OR REPLACE FUNCTION ops.match_master_list_by_cat_name(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
BEGIN
  -- Match entries where cat name similarity > 0.6 and only 1 match exists
  WITH potential_matches AS (
    SELECT
      e.entry_id,
      a.appointment_id,
      similarity(LOWER(TRIM(e.parsed_cat_name)), LOWER(TRIM(c.name))) AS sim_score
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.matched_appointment_id IS NULL
      AND e.parsed_cat_name IS NOT NULL
      AND c.name IS NOT NULL
      AND similarity(LOWER(TRIM(e.parsed_cat_name)), LOWER(TRIM(c.name))) > 0.6
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e3
        WHERE e3.matched_appointment_id = a.appointment_id
      )
  ),
  unique_matches AS (
    SELECT entry_id, appointment_id, sim_score
    FROM potential_matches
    WHERE entry_id IN (
      SELECT entry_id FROM potential_matches
      GROUP BY entry_id
      HAVING COUNT(*) = 1
    )
  ),
  matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = um.appointment_id,
      match_confidence = 'medium',
      match_reason = 'cat_name_unique_' || ROUND(um.sim_score::NUMERIC, 2)::TEXT,
      matched_at = NOW()
    FROM unique_matches um
    WHERE e.entry_id = um.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM matches;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

-- Pass 3: Match by sex compatibility (when only 1 unmatched of each sex)
CREATE OR REPLACE FUNCTION ops.match_master_list_by_sex(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
  v_clinic_day_id UUID;
BEGIN
  -- Get clinic_day_id for the date
  SELECT clinic_day_id INTO v_clinic_day_id
  FROM ops.clinic_days
  WHERE clinic_date = p_clinic_date;

  IF v_clinic_day_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Match females when only 1 unmatched female entry and 1 unmatched female appointment
  WITH unmatched_female_entries AS (
    SELECT entry_id
    FROM ops.clinic_day_entries
    WHERE clinic_day_id = v_clinic_day_id
      AND matched_appointment_id IS NULL
      AND female_count > 0
      AND male_count = 0
  ),
  unmatched_female_appointments AS (
    SELECT a.appointment_id
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE a.appointment_date = p_clinic_date
      AND c.sex = 'female'
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e
        WHERE e.matched_appointment_id = a.appointment_id
      )
  ),
  female_match AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = (SELECT appointment_id FROM unmatched_female_appointments),
      match_confidence = 'low',
      match_reason = 'sex_singleton_female',
      matched_at = NOW()
    WHERE e.entry_id = (SELECT entry_id FROM unmatched_female_entries)
      AND (SELECT COUNT(*) FROM unmatched_female_entries) = 1
      AND (SELECT COUNT(*) FROM unmatched_female_appointments) = 1
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched FROM female_match;

  -- Match males when only 1 unmatched male entry and 1 unmatched male appointment
  WITH unmatched_male_entries AS (
    SELECT entry_id
    FROM ops.clinic_day_entries
    WHERE clinic_day_id = v_clinic_day_id
      AND matched_appointment_id IS NULL
      AND male_count > 0
      AND female_count = 0
  ),
  unmatched_male_appointments AS (
    SELECT a.appointment_id
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE a.appointment_date = p_clinic_date
      AND c.sex = 'male'
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e
        WHERE e.matched_appointment_id = a.appointment_id
      )
  ),
  male_match AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = (SELECT appointment_id FROM unmatched_male_appointments),
      match_confidence = 'low',
      match_reason = 'sex_singleton_male',
      matched_at = NOW()
    WHERE e.entry_id = (SELECT entry_id FROM unmatched_male_entries)
      AND (SELECT COUNT(*) FROM unmatched_male_entries) = 1
      AND (SELECT COUNT(*) FROM unmatched_male_appointments) = 1
    RETURNING e.entry_id
  )
  SELECT v_matched + COUNT(*) INTO v_matched FROM male_match;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

-- Pass 4: Match by cardinality (greedy best-fit when ≤3 unmatched on each side)
CREATE OR REPLACE FUNCTION ops.match_master_list_by_cardinality(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched INT := 0;
  v_clinic_day_id UUID;
  v_unmatched_entries INT;
  v_unmatched_appointments INT;
  r RECORD;
BEGIN
  -- Get clinic_day_id for the date
  SELECT clinic_day_id INTO v_clinic_day_id
  FROM ops.clinic_days
  WHERE clinic_date = p_clinic_date;

  IF v_clinic_day_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Count unmatched on each side
  SELECT COUNT(*) INTO v_unmatched_entries
  FROM ops.clinic_day_entries
  WHERE clinic_day_id = v_clinic_day_id
    AND matched_appointment_id IS NULL;

  SELECT COUNT(*) INTO v_unmatched_appointments
  FROM ops.appointments a
  WHERE a.appointment_date = p_clinic_date
    AND NOT EXISTS (
      SELECT 1 FROM ops.clinic_day_entries e
      WHERE e.matched_appointment_id = a.appointment_id
    );

  -- Only proceed if both sides have ≤3 unmatched
  IF v_unmatched_entries > 3 OR v_unmatched_appointments > 3 THEN
    RETURN 0;
  END IF;

  -- Greedy match: pair by best similarity score
  FOR r IN (
    SELECT DISTINCT ON (e.entry_id)
      e.entry_id,
      a.appointment_id,
      COALESCE(
        similarity(LOWER(COALESCE(e.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))),
        0
      ) +
      COALESCE(
        similarity(LOWER(COALESCE(e.parsed_owner_name, '')), LOWER(COALESCE(owner.display_name, ''))),
        0
      ) AS combined_score
    FROM ops.clinic_day_entries e
    JOIN ops.appointments a ON a.appointment_date = p_clinic_date
    LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
    LEFT JOIN sot.people owner ON owner.person_id = a.owner_person_id
    WHERE e.clinic_day_id = v_clinic_day_id
      AND e.matched_appointment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e2
        WHERE e2.matched_appointment_id = a.appointment_id
      )
    ORDER BY e.entry_id, combined_score DESC
  )
  LOOP
    UPDATE ops.clinic_day_entries
    SET
      matched_appointment_id = r.appointment_id,
      match_confidence = 'low',
      match_reason = 'cardinality_greedy',
      matched_at = NOW()
    WHERE entry_id = r.entry_id
      AND matched_appointment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e2
        WHERE e2.matched_appointment_id = r.appointment_id
      );

    IF FOUND THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN v_matched;
END;
$$ LANGUAGE plpgsql;

-- Main function: Run all matching passes
CREATE OR REPLACE FUNCTION ops.apply_smart_master_list_matches(p_clinic_date DATE)
RETURNS TABLE (pass TEXT, entries_matched INT) AS $$
DECLARE
  v_pass1 INT;
  v_pass2 INT;
  v_pass3 INT;
  v_pass4 INT;
BEGIN
  -- Ensure clinic day exists
  INSERT INTO ops.clinic_days (clinic_date)
  VALUES (p_clinic_date)
  ON CONFLICT (clinic_date) DO NOTHING;

  -- Run each pass in order
  v_pass1 := ops.match_master_list_by_owner_name(p_clinic_date);
  v_pass2 := ops.match_master_list_by_cat_name(p_clinic_date);
  v_pass3 := ops.match_master_list_by_sex(p_clinic_date);
  v_pass4 := ops.match_master_list_by_cardinality(p_clinic_date);

  -- Return results
  pass := 'owner_name'; entries_matched := v_pass1; RETURN NEXT;
  pass := 'cat_name'; entries_matched := v_pass2; RETURN NEXT;
  pass := 'sex'; entries_matched := v_pass3; RETURN NEXT;
  pass := 'cardinality'; entries_matched := v_pass4; RETURN NEXT;
  pass := 'total'; entries_matched := v_pass1 + v_pass2 + v_pass3 + v_pass4; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Link trappers to matched appointments via trapper_person_id
CREATE OR REPLACE FUNCTION ops.create_master_list_relationships(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_linked INT := 0;
BEGIN
  -- Resolve trapper aliases and link to entries
  UPDATE ops.clinic_day_entries e
  SET trapper_person_id = ops.resolve_trapper_alias(e.parsed_trapper_alias)
  FROM ops.clinic_days cd
  WHERE cd.clinic_day_id = e.clinic_day_id
    AND cd.clinic_date = p_clinic_date
    AND e.parsed_trapper_alias IS NOT NULL
    AND e.trapper_person_id IS NULL;

  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- Create person_cat_relationships for trappers
  INSERT INTO sot.person_cat_relationships (
    person_id,
    cat_id,
    relationship_type,
    evidence_type,
    source_system,
    confidence
  )
  SELECT DISTINCT
    e.trapper_person_id,
    a.cat_id,
    'trapper',
    'master_list',
    'master_list',
    0.8
  FROM ops.clinic_day_entries e
  JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
  JOIN ops.appointments a ON a.appointment_id = e.matched_appointment_id
  WHERE cd.clinic_date = p_clinic_date
    AND e.trapper_person_id IS NOT NULL
    AND a.cat_id IS NOT NULL
  ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING;

  RETURN v_linked;
END;
$$ LANGUAGE plpgsql;

-- Helper function to get matching stats for a clinic day
CREATE OR REPLACE FUNCTION ops.get_master_list_match_stats(p_clinic_date DATE)
RETURNS TABLE (
  total_entries INT,
  matched_high INT,
  matched_medium INT,
  matched_low INT,
  unmatched INT,
  total_appointments INT,
  appointments_matched INT,
  appointments_unmatched INT
) AS $$
BEGIN
  RETURN QUERY
  WITH entry_stats AS (
    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE match_confidence = 'high')::INT AS high,
      COUNT(*) FILTER (WHERE match_confidence = 'medium')::INT AS medium,
      COUNT(*) FILTER (WHERE match_confidence = 'low')::INT AS low,
      COUNT(*) FILTER (WHERE match_confidence IS NULL OR match_confidence = 'unmatched')::INT AS unmatched
    FROM ops.clinic_day_entries e
    JOIN ops.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
  ),
  appt_stats AS (
    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ops.clinic_day_entries e
        WHERE e.matched_appointment_id = a.appointment_id
      ))::INT AS matched
    FROM ops.appointments a
    WHERE a.appointment_date = p_clinic_date
  )
  SELECT
    es.total,
    es.high,
    es.medium,
    es.low,
    es.unmatched,
    aps.total,
    aps.matched,
    (aps.total - aps.matched)::INT
  FROM entry_stats es, appt_stats aps;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_owner_name IS 'Pass 1: Match master list entries to appointments by exact owner name';
COMMENT ON FUNCTION ops.match_master_list_by_cat_name IS 'Pass 2: Match by fuzzy cat name (similarity > 0.6, unique match only)';
COMMENT ON FUNCTION ops.match_master_list_by_sex IS 'Pass 3: Match when only 1 unmatched entry and appointment of same sex';
COMMENT ON FUNCTION ops.match_master_list_by_cardinality IS 'Pass 4: Greedy best-fit when ≤3 unmatched on each side';
COMMENT ON FUNCTION ops.apply_smart_master_list_matches IS 'Run all 4 matching passes and return results per pass';
COMMENT ON FUNCTION ops.create_master_list_relationships IS 'Resolve trapper aliases and create person_cat relationships';
COMMENT ON FUNCTION ops.get_master_list_match_stats IS 'Get matching statistics for a clinic day';
