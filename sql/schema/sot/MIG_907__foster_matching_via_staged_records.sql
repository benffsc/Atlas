-- MIG_901: Foster Matching via Staged Records
--
-- Problem: Master list foster entries like "Foster 'Asher' (Chiaroni)" fail to match
-- when sot_cats.display_name is a generic breed description ("DMH Brn Tabby 3750")
-- instead of the actual cat name.
--
-- Solution: Match via ClinicHQ staged_records where Animal Name = "Asher (Chiaroni)"
-- pattern contains both the cat name and foster last name.
--
-- Additionally: Link foster parents from VolunteerHub to cats via person_cat_relationships.
--
\echo '=== MIG_901: Foster Matching via Staged Records ==='

-- ============================================================================
-- Function: match_master_list_fosters_via_staged()
--
-- Matches unmatched foster entries to appointments using ClinicHQ staged record
-- Animal Name pattern: "CatName (FosterLastName)"
-- ============================================================================
CREATE OR REPLACE FUNCTION trapper.match_master_list_fosters_via_staged(
  p_clinic_date DATE
)
RETURNS TABLE (
  entry_id UUID,
  appointment_id UUID,
  confidence TEXT,
  match_reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH foster_entries AS (
    -- Get unmatched foster entries with parsed cat name and foster parent name
    SELECT e.entry_id, e.parsed_cat_name, e.foster_parent_name, cd.clinic_date
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.is_foster = TRUE
      AND e.matched_appointment_id IS NULL
      AND e.parsed_cat_name IS NOT NULL
      AND e.foster_parent_name IS NOT NULL
  ),
  clinichq_foster_appts AS (
    -- Find appointments with "CatName (FosterName)" pattern in Animal Name
    SELECT a.appointment_id, a.appointment_date,
           sr.payload->>'Animal Name' AS animal_name,
           TRIM((regexp_match(sr.payload->>'Animal Name', '^([^(]+)\s*\(([^)]+)\)'))[1]) AS hq_cat_name,
           TRIM((regexp_match(sr.payload->>'Animal Name', '^([^(]+)\s*\(([^)]+)\)'))[2]) AS hq_foster_name
    FROM trapper.sot_appointments a
    JOIN trapper.staged_records sr ON sr.source_row_id = a.source_record_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
    WHERE a.appointment_date = p_clinic_date
      AND sr.payload->>'Animal Name' ~ '\([^)]+\)$'  -- Contains parentheses pattern
      AND NOT EXISTS (
        SELECT 1 FROM trapper.clinic_day_entries cde
        WHERE cde.matched_appointment_id = a.appointment_id
      )
  )
  SELECT fe.entry_id,
         ca.appointment_id,
         'high'::TEXT AS confidence,
         'foster_staged_animal_name'::TEXT AS match_reason
  FROM foster_entries fe
  JOIN clinichq_foster_appts ca
    ON ca.appointment_date = fe.clinic_date
    AND LOWER(ca.hq_cat_name) = LOWER(fe.parsed_cat_name)
    AND LOWER(ca.hq_foster_name) = LOWER(fe.foster_parent_name);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_master_list_fosters_via_staged(DATE) IS
'Matches unmatched foster master list entries to appointments using ClinicHQ staged record Animal Name pattern "CatName (FosterLastName)". Returns high confidence matches.';

-- ============================================================================
-- Function: link_foster_parent_to_cat()
--
-- Creates person_cat_relationship linking foster parent to cat based on:
-- 1. VolunteerHub volunteer with matching last name in "Approved Foster Parent" group
-- 2. ClinicHQ appointment with "CatName (FosterLastName)" pattern
-- ============================================================================
CREATE OR REPLACE FUNCTION trapper.link_foster_parent_to_cat(
  p_foster_last_name TEXT,
  p_cat_id UUID,
  p_appointment_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_foster_person_id UUID;
  v_person_cat_id UUID;
BEGIN
  -- Find the foster parent via VolunteerHub
  -- Must be in "Approved Foster Parent" group
  SELECT vv.matched_person_id INTO v_foster_person_id
  FROM trapper.volunteerhub_volunteers vv
  JOIN trapper.volunteerhub_group_memberships vgm ON vgm.volunteerhub_id = vv.volunteerhub_id
  JOIN trapper.volunteerhub_user_groups vug ON vug.user_group_uid = vgm.user_group_uid
  WHERE LOWER(vv.last_name) = LOWER(p_foster_last_name)
    AND vug.atlas_role = 'foster'
    AND vgm.left_at IS NULL
    AND vv.matched_person_id IS NOT NULL
  LIMIT 1;

  IF v_foster_person_id IS NULL THEN
    -- Try matching via sot_people display_name if no VH match
    SELECT person_id INTO v_foster_person_id
    FROM trapper.sot_people
    WHERE display_name ILIKE '%' || p_foster_last_name
      AND merged_into_person_id IS NULL
    LIMIT 1;
  END IF;

  IF v_foster_person_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Check if relationship already exists
  SELECT person_cat_id INTO v_person_cat_id
  FROM trapper.person_cat_relationships
  WHERE person_id = v_foster_person_id
    AND cat_id = p_cat_id
    AND relationship_type = 'foster';

  IF v_person_cat_id IS NOT NULL THEN
    RETURN v_person_cat_id;
  END IF;

  -- Create the foster relationship with all required columns
  INSERT INTO trapper.person_cat_relationships (
    person_id,
    cat_id,
    relationship_type,
    confidence,
    source_system,
    source_table,
    appointment_id,
    context_notes,
    created_at
  ) VALUES (
    v_foster_person_id,
    p_cat_id,
    'foster',
    'high',
    'master_list',
    'clinic_day_entries',
    p_appointment_id,
    'Linked via master list foster entry matching',
    NOW()
  )
  RETURNING person_cat_id INTO v_person_cat_id;

  RETURN v_person_cat_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_foster_parent_to_cat(TEXT, UUID, UUID) IS
'Links a foster parent to a cat by looking up the foster via VolunteerHub (Approved Foster Parent group) or sot_people. Creates person_cat_relationship with type=foster.';

-- ============================================================================
-- Function: apply_foster_matches_and_links()
--
-- Orchestrates foster matching:
-- 1. Match master list fosters via staged records
-- 2. Update clinic_day_entries with matches
-- 3. Create person_cat_relationships for foster parents
-- ============================================================================
CREATE OR REPLACE FUNCTION trapper.apply_foster_matches_and_links(
  p_clinic_date DATE
)
RETURNS TABLE (
  operation TEXT,
  count INT
) AS $$
DECLARE
  v_matched INT := 0;
  v_linked INT := 0;
  rec RECORD;
BEGIN
  -- Step 1: Find and apply foster matches via staged records
  FOR rec IN
    SELECT * FROM trapper.match_master_list_fosters_via_staged(p_clinic_date)
  LOOP
    UPDATE trapper.clinic_day_entries
    SET matched_appointment_id = rec.appointment_id,
        match_confidence = rec.confidence,
        match_reason = rec.match_reason
    WHERE entry_id = rec.entry_id
      AND matched_appointment_id IS NULL;

    IF FOUND THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  operation := 'foster_entries_matched';
  count := v_matched;
  RETURN NEXT;

  -- Step 2: Create person_cat_relationships for matched fosters
  FOR rec IN
    SELECT e.foster_parent_name, a.cat_id, a.appointment_id
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    JOIN trapper.sot_appointments a ON a.appointment_id = e.matched_appointment_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.is_foster = TRUE
      AND e.foster_parent_name IS NOT NULL
      AND a.cat_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships pcr
        WHERE pcr.cat_id = a.cat_id
          AND pcr.relationship_type = 'foster'
      )
  LOOP
    IF trapper.link_foster_parent_to_cat(rec.foster_parent_name, rec.cat_id, rec.appointment_id) IS NOT NULL THEN
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  operation := 'foster_relationships_created';
  count := v_linked;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.apply_foster_matches_and_links(DATE) IS
'Orchestrates foster matching and relationship creation for a clinic date. Returns counts of entries matched and relationships created.';

-- ============================================================================
-- Update apply_smart_master_list_matches to include foster matching
-- ============================================================================
CREATE OR REPLACE FUNCTION trapper.apply_smart_master_list_matches(
  p_clinic_date DATE
)
RETURNS TABLE (
  pass TEXT,
  entries_matched INT
) AS $$
DECLARE
  v_count INT;
  rec RECORD;
BEGIN
  -- Pass 1: Existing trigram owner/name matching (from import)
  -- This is already applied during import, so we just report current state
  SELECT COUNT(*) INTO v_count
  FROM trapper.clinic_day_entries e
  JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
  WHERE cd.clinic_date = p_clinic_date
    AND e.matched_appointment_id IS NOT NULL
    AND e.match_reason IN ('exact', 'high', 'medium');

  pass := 'pass_1_owner_name';
  entries_matched := v_count;
  RETURN NEXT;

  -- Pass 2: Unique cat name matching
  v_count := 0;
  FOR rec IN
    SELECT * FROM trapper.match_master_list_by_cat_name(p_clinic_date)
  LOOP
    UPDATE trapper.clinic_day_entries
    SET matched_appointment_id = rec.appointment_id,
        match_confidence = rec.confidence,
        match_reason = rec.match_reason
    WHERE entry_id = rec.entry_id
      AND matched_appointment_id IS NULL;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  pass := 'pass_2_unique_cat_name';
  entries_matched := v_count;
  RETURN NEXT;

  -- Pass 3: Foster matching via staged records (NEW)
  v_count := 0;
  FOR rec IN
    SELECT * FROM trapper.match_master_list_fosters_via_staged(p_clinic_date)
  LOOP
    UPDATE trapper.clinic_day_entries
    SET matched_appointment_id = rec.appointment_id,
        match_confidence = rec.confidence,
        match_reason = rec.match_reason
    WHERE entry_id = rec.entry_id
      AND matched_appointment_id IS NULL;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  pass := 'pass_3_foster_staged';
  entries_matched := v_count;
  RETURN NEXT;

  -- Pass 4: Sex compatibility matching (if needed)
  v_count := 0;
  FOR rec IN
    SELECT * FROM trapper.match_master_list_by_sex(p_clinic_date)
  LOOP
    UPDATE trapper.clinic_day_entries
    SET matched_appointment_id = rec.appointment_id,
        match_confidence = rec.confidence,
        match_reason = rec.match_reason
    WHERE entry_id = rec.entry_id
      AND matched_appointment_id IS NULL;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  pass := 'pass_4_sex_compatibility';
  entries_matched := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Verify and apply to 02/04/2026 clinic day
-- ============================================================================
\echo ''
\echo 'Testing foster matching on 2026-02-04...'

SELECT * FROM trapper.match_master_list_fosters_via_staged('2026-02-04'::DATE);

\echo ''
\echo '=== MIG_901 Complete ==='
