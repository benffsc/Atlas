-- =====================================================
-- MIG_900: Smart Master List Matching System
-- =====================================================
-- Enhances master list matching with:
-- 1. Extended parsing (foster, shelter ID, address, phone)
-- 2. Multi-strategy matching (cat name, sex, cardinality)
-- 3. Delayed matching for ShelterLuv/VolunteerHub data
-- 4. Entity relationship creation
-- =====================================================

\echo '=========================================='
\echo 'MIG_900: Smart Master List Matching System'
\echo '=========================================='

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------
-- Part A: Add columns for enhanced parsing
-- -----------------------------------------------------

\echo 'Adding enhanced parsing columns to clinic_day_entries...'

-- Foster detection
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  is_foster BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  foster_parent_name TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.is_foster IS 'Entry starts with "Foster" keyword';
COMMENT ON COLUMN trapper.clinic_day_entries.foster_parent_name IS 'Foster parent name extracted from parentheses';

-- Shelter/Org detection
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  is_shelter BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  org_code TEXT;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  shelter_animal_id TEXT;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  org_name TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.is_shelter IS 'Entry is from a shelter (SCAS, RPAS, etc.)';
COMMENT ON COLUMN trapper.clinic_day_entries.org_code IS 'Short org code like SCAS, RPAS';
COMMENT ON COLUMN trapper.clinic_day_entries.shelter_animal_id IS 'Shelter animal ID like A439019';
COMMENT ON COLUMN trapper.clinic_day_entries.org_name IS 'Full organization name';

-- Address detection
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  is_address BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  parsed_address TEXT;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  parsed_cat_color TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.is_address IS 'Entry starts with address (number + street)';
COMMENT ON COLUMN trapper.clinic_day_entries.parsed_address IS 'Extracted address';
COMMENT ON COLUMN trapper.clinic_day_entries.parsed_cat_color IS 'Cat color extracted from address entries';

-- Contact extraction
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  contact_phone TEXT;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  alt_contact_name TEXT;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  alt_contact_phone TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.contact_phone IS 'Primary phone number from entry';
COMMENT ON COLUMN trapper.clinic_day_entries.alt_contact_name IS 'Alternative contact name (after "call X")';
COMMENT ON COLUMN trapper.clinic_day_entries.alt_contact_phone IS 'Alternative contact phone';

-- Match tracking
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  match_reason TEXT;

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  matched_cat_id UUID REFERENCES trapper.sot_cats(cat_id);

COMMENT ON COLUMN trapper.clinic_day_entries.match_reason IS 'Reason for match: owner_name, cat_name, sex, cardinality, shelter_id, etc.';
COMMENT ON COLUMN trapper.clinic_day_entries.matched_cat_id IS 'Linked cat (may differ from appointment cat_id for shelter entries)';

-- Indexes for matching
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_shelter_id
  ON trapper.clinic_day_entries(shelter_animal_id) WHERE shelter_animal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_foster
  ON trapper.clinic_day_entries(is_foster) WHERE is_foster = TRUE;

CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_unmatched
  ON trapper.clinic_day_entries(clinic_day_id) WHERE matched_appointment_id IS NULL;

-- -----------------------------------------------------
-- Part B: Match by unique cat name
-- -----------------------------------------------------

\echo 'Creating match_master_list_by_cat_name function...'

CREATE OR REPLACE FUNCTION trapper.match_master_list_by_cat_name(p_clinic_date DATE)
RETURNS TABLE (entry_id UUID, appointment_id UUID, confidence TEXT, match_reason TEXT) AS $$
  WITH unmatched_entries AS (
    SELECT e.entry_id, e.parsed_cat_name, e.clinic_day_id
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.matched_appointment_id IS NULL
      AND e.parsed_cat_name IS NOT NULL
      AND TRIM(e.parsed_cat_name) != ''
  ),
  available_appointments AS (
    SELECT a.appointment_id, c.display_name AS cat_name
    FROM trapper.sot_appointments a
    LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.appointment_date = p_clinic_date
      AND a.cat_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.clinic_day_entries cde
        WHERE cde.matched_appointment_id = a.appointment_id
      )
  ),
  -- Find entries where cat name uniquely matches one appointment
  matches AS (
    SELECT e.entry_id, a.appointment_id,
      similarity(lower(e.parsed_cat_name), lower(COALESCE(a.cat_name, ''))) AS sim
    FROM unmatched_entries e
    CROSS JOIN available_appointments a
    WHERE a.cat_name IS NOT NULL
      AND similarity(lower(e.parsed_cat_name), lower(a.cat_name)) > 0.6
  ),
  -- Only keep entries that have exactly one good match
  unique_matches AS (
    SELECT DISTINCT ON (entry_id) entry_id, appointment_id
    FROM matches m
    WHERE NOT EXISTS (
      SELECT 1 FROM matches m2
      WHERE m2.entry_id = m.entry_id
        AND m2.appointment_id != m.appointment_id
        AND m2.sim > 0.5  -- Another potential match exists
    )
  )
  SELECT u.entry_id, u.appointment_id, 'high'::TEXT, 'unique_cat_name'::TEXT
  FROM unique_matches u;
$$ LANGUAGE sql;

COMMENT ON FUNCTION trapper.match_master_list_by_cat_name(DATE) IS
'Match master list entries by unique cat name on clinic day. Returns high confidence matches.';

-- -----------------------------------------------------
-- Part C: Match by sex compatibility
-- -----------------------------------------------------

\echo 'Creating match_master_list_by_sex function...'

CREATE OR REPLACE FUNCTION trapper.match_master_list_by_sex(p_clinic_date DATE)
RETURNS TABLE (entry_id UUID, appointment_id UUID, confidence TEXT, match_reason TEXT) AS $$
  WITH unmatched_entries AS (
    SELECT e.entry_id, e.female_count, e.male_count, e.parsed_owner_name, e.clinic_day_id
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.matched_appointment_id IS NULL
      AND (e.female_count > 0 OR e.male_count > 0)
  ),
  available_appointments AS (
    SELECT a.appointment_id, a.is_spay, a.is_neuter,
           p.display_name AS owner_name
    FROM trapper.sot_appointments a
    LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
    WHERE a.appointment_date = p_clinic_date
      AND NOT EXISTS (
        SELECT 1 FROM trapper.clinic_day_entries cde
        WHERE cde.matched_appointment_id = a.appointment_id
      )
  ),
  -- Count unmatched by sex
  female_entries AS (
    SELECT entry_id, parsed_owner_name FROM unmatched_entries WHERE female_count > 0 AND male_count = 0
  ),
  male_entries AS (
    SELECT entry_id, parsed_owner_name FROM unmatched_entries WHERE male_count > 0 AND female_count = 0
  ),
  female_appointments AS (
    SELECT appointment_id, owner_name FROM available_appointments WHERE is_spay = TRUE AND is_neuter = FALSE
  ),
  male_appointments AS (
    SELECT appointment_id, owner_name FROM available_appointments WHERE is_neuter = TRUE AND is_spay = FALSE
  ),
  -- Match if only one female entry and one female appointment remain
  female_matches AS (
    SELECT fe.entry_id, fa.appointment_id
    FROM female_entries fe
    CROSS JOIN female_appointments fa
    WHERE (SELECT COUNT(*) FROM female_entries) = 1
      AND (SELECT COUNT(*) FROM female_appointments) = 1
  ),
  -- Match if only one male entry and one male appointment remain
  male_matches AS (
    SELECT me.entry_id, ma.appointment_id
    FROM male_entries me
    CROSS JOIN male_appointments ma
    WHERE (SELECT COUNT(*) FROM male_entries) = 1
      AND (SELECT COUNT(*) FROM male_appointments) = 1
  )
  SELECT entry_id, appointment_id, 'medium'::TEXT, 'sex_unique'::TEXT
  FROM female_matches
  UNION ALL
  SELECT entry_id, appointment_id, 'medium'::TEXT, 'sex_unique'::TEXT
  FROM male_matches;
$$ LANGUAGE sql;

COMMENT ON FUNCTION trapper.match_master_list_by_sex(DATE) IS
'Match master list entries by sex when only one unmatched entry and appointment remain for that sex.';

-- -----------------------------------------------------
-- Part D: Match by cardinality (last resort)
-- -----------------------------------------------------

\echo 'Creating match_master_list_by_cardinality function...'

CREATE OR REPLACE FUNCTION trapper.match_master_list_by_cardinality(p_clinic_date DATE)
RETURNS TABLE (entry_id UUID, appointment_id UUID, confidence TEXT, match_reason TEXT) AS $$
DECLARE
  v_entry_count INT;
  v_appt_count INT;
BEGIN
  -- Count unmatched on each side
  SELECT COUNT(*) INTO v_entry_count
  FROM trapper.clinic_day_entries e
  JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
  WHERE cd.clinic_date = p_clinic_date
    AND e.matched_appointment_id IS NULL
    AND e.parsed_owner_name IS NOT NULL;

  SELECT COUNT(*) INTO v_appt_count
  FROM trapper.sot_appointments a
  WHERE a.appointment_date = p_clinic_date
    AND NOT EXISTS (
      SELECT 1 FROM trapper.clinic_day_entries cde
      WHERE cde.matched_appointment_id = a.appointment_id
    );

  -- Only proceed if counts match and are small (≤3 for safety)
  IF v_entry_count = v_appt_count AND v_entry_count > 0 AND v_entry_count <= 3 THEN
    RETURN QUERY
    WITH unmatched_entries AS (
      SELECT e.entry_id, e.parsed_owner_name, e.parsed_cat_name, e.female_count, e.male_count,
             ROW_NUMBER() OVER (ORDER BY e.line_number) AS rn
      FROM trapper.clinic_day_entries e
      JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
      WHERE cd.clinic_date = p_clinic_date
        AND e.matched_appointment_id IS NULL
        AND e.parsed_owner_name IS NOT NULL
    ),
    available_appointments AS (
      SELECT a.appointment_id,
             p.display_name AS owner_name,
             c.display_name AS cat_name,
             a.is_spay, a.is_neuter,
             ROW_NUMBER() OVER (ORDER BY a.clinic_day_number NULLS LAST, a.appointment_number) AS rn
      FROM trapper.sot_appointments a
      LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
      LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      WHERE a.appointment_date = p_clinic_date
        AND NOT EXISTS (
          SELECT 1 FROM trapper.clinic_day_entries cde
          WHERE cde.matched_appointment_id = a.appointment_id
        )
    ),
    -- Score all pairings
    all_pairs AS (
      SELECT e.entry_id, a.appointment_id,
        -- Score: cat name similarity + owner name similarity + sex match
        COALESCE(similarity(lower(e.parsed_cat_name), lower(COALESCE(a.cat_name, ''))), 0) * 2 +
        COALESCE(similarity(lower(e.parsed_owner_name), lower(COALESCE(a.owner_name, ''))), 0) +
        CASE WHEN (e.female_count > 0 AND a.is_spay) OR (e.male_count > 0 AND a.is_neuter) THEN 0.3 ELSE 0 END
        AS score
      FROM unmatched_entries e
      CROSS JOIN available_appointments a
    ),
    -- Use Hungarian algorithm approximation: greedy best match
    ranked AS (
      SELECT entry_id, appointment_id, score,
             ROW_NUMBER() OVER (PARTITION BY entry_id ORDER BY score DESC) AS entry_rank,
             ROW_NUMBER() OVER (PARTITION BY appointment_id ORDER BY score DESC) AS appt_rank
      FROM all_pairs
    )
    SELECT r.entry_id, r.appointment_id, 'medium'::TEXT, 'cardinality_match'::TEXT
    FROM ranked r
    WHERE r.entry_rank = 1 AND r.appt_rank = 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_master_list_by_cardinality(DATE) IS
'Match remaining entries to appointments when counts are equal (≤3). Uses best-fit pairing.';

-- -----------------------------------------------------
-- Part E: Apply all matching strategies in order
-- -----------------------------------------------------

\echo 'Creating apply_smart_master_list_matches function...'

CREATE OR REPLACE FUNCTION trapper.apply_smart_master_list_matches(p_clinic_date DATE)
RETURNS TABLE (pass TEXT, entries_matched INT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Pass 1: Existing owner/name matching (from MIG_472)
  WITH matches AS (
    SELECT * FROM trapper.match_master_list_to_appointments(p_clinic_date)
    WHERE confidence IN ('high', 'medium')
  ),
  updated AS (
    UPDATE trapper.clinic_day_entries e
    SET matched_appointment_id = m.appointment_id,
        match_confidence = m.confidence,
        match_reason = m.match_reason
    FROM matches m
    WHERE e.entry_id = m.entry_id
      AND e.matched_appointment_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  pass := 'owner_name'; entries_matched := v_count;
  RETURN NEXT;

  -- Pass 2: Unique cat name matching
  WITH matches AS (
    SELECT * FROM trapper.match_master_list_by_cat_name(p_clinic_date)
  ),
  updated AS (
    UPDATE trapper.clinic_day_entries e
    SET matched_appointment_id = m.appointment_id,
        match_confidence = m.confidence,
        match_reason = m.match_reason
    FROM matches m
    WHERE e.entry_id = m.entry_id
      AND e.matched_appointment_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  pass := 'cat_name'; entries_matched := v_count;
  RETURN NEXT;

  -- Pass 3: Sex compatibility matching
  WITH matches AS (
    SELECT * FROM trapper.match_master_list_by_sex(p_clinic_date)
  ),
  updated AS (
    UPDATE trapper.clinic_day_entries e
    SET matched_appointment_id = m.appointment_id,
        match_confidence = m.confidence,
        match_reason = m.match_reason
    FROM matches m
    WHERE e.entry_id = m.entry_id
      AND e.matched_appointment_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  pass := 'sex_compatibility'; entries_matched := v_count;
  RETURN NEXT;

  -- Pass 4: Cardinality matching (last resort)
  WITH matches AS (
    SELECT * FROM trapper.match_master_list_by_cardinality(p_clinic_date)
  ),
  updated AS (
    UPDATE trapper.clinic_day_entries e
    SET matched_appointment_id = m.appointment_id,
        match_confidence = m.confidence,
        match_reason = m.match_reason
    FROM matches m
    WHERE e.entry_id = m.entry_id
      AND e.matched_appointment_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  pass := 'cardinality'; entries_matched := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.apply_smart_master_list_matches(DATE) IS
'Apply all matching strategies in order: owner_name → cat_name → sex → cardinality.';

-- -----------------------------------------------------
-- Part F: Delayed matching for ShelterLuv/VolunteerHub
-- -----------------------------------------------------

\echo 'Creating retry_unmatched_master_list_entries function...'

CREATE OR REPLACE FUNCTION trapper.retry_unmatched_master_list_entries()
RETURNS TABLE (clinic_date DATE, entries_matched INT, match_method TEXT) AS $$
DECLARE
  v_date DATE;
  v_count INT;
BEGIN
  -- Find clinic dates with unmatched shelter entries in last 30 days
  FOR v_date IN
    SELECT DISTINCT cd.clinic_date
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE e.matched_appointment_id IS NULL
      AND e.shelter_animal_id IS NOT NULL
      AND cd.clinic_date >= CURRENT_DATE - INTERVAL '30 days'
  LOOP
    -- Try to match by ShelterLuv ID
    WITH matches AS (
      UPDATE trapper.clinic_day_entries e
      SET matched_cat_id = ci.cat_id,
          match_reason = 'shelterluv_id'
      FROM trapper.cat_identifiers ci
      WHERE ci.id_type = 'shelterluv_animal_id'
        AND (
          ci.id_value = e.shelter_animal_id
          OR ci.id_value = e.org_code || ' ' || e.shelter_animal_id
          OR ci.id_value ILIKE '%' || e.shelter_animal_id || '%'
        )
        AND e.matched_cat_id IS NULL
        AND e.shelter_animal_id IS NOT NULL
        AND e.clinic_day_id IN (
          SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = v_date
        )
      RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_count FROM matches;

    IF v_count > 0 THEN
      clinic_date := v_date;
      entries_matched := v_count;
      match_method := 'shelterluv_id';
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Find clinic dates with unmatched foster entries in last 30 days
  FOR v_date IN
    SELECT DISTINCT cd.clinic_date
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE e.matched_appointment_id IS NULL
      AND e.is_foster = TRUE
      AND e.foster_parent_name IS NOT NULL
      AND cd.clinic_date >= CURRENT_DATE - INTERVAL '30 days'
  LOOP
    -- Try to match by foster parent name + VH role
    WITH foster_matches AS (
      UPDATE trapper.clinic_day_entries e
      SET matched_appointment_id = a.appointment_id,
          match_confidence = 'high',
          match_reason = 'foster_parent_vh'
      FROM trapper.sot_appointments a
      JOIN trapper.sot_people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
      JOIN trapper.person_roles pr ON pr.person_id = p.person_id AND pr.role_name = 'foster'
      WHERE a.appointment_date = v_date
        AND e.is_foster = TRUE
        AND e.foster_parent_name IS NOT NULL
        AND similarity(lower(e.foster_parent_name), lower(p.display_name)) > 0.6
        AND e.matched_appointment_id IS NULL
        AND e.clinic_day_id IN (
          SELECT clinic_day_id FROM trapper.clinic_days WHERE clinic_date = v_date
        )
        AND NOT EXISTS (
          SELECT 1 FROM trapper.clinic_day_entries cde
          WHERE cde.matched_appointment_id = a.appointment_id
        )
      RETURNING e.entry_id
    )
    SELECT COUNT(*) INTO v_count FROM foster_matches;

    IF v_count > 0 THEN
      clinic_date := v_date;
      entries_matched := v_count;
      match_method := 'foster_parent';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.retry_unmatched_master_list_entries() IS
'Retry matching unmatched shelter/foster entries using ShelterLuv and VolunteerHub data.
Run via cron after external data syncs. Returns matches made per clinic date.';

-- -----------------------------------------------------
-- Part G: Create entity relationships from matches
-- -----------------------------------------------------

\echo 'Creating create_master_list_relationships function...'

CREATE OR REPLACE FUNCTION trapper.create_master_list_relationships(p_clinic_date DATE)
RETURNS TABLE (relationship_type TEXT, relationships_created INT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Shelter/relo relationships placeholder
  -- NOTE: known_organizations table doesn't have canonical_person_id yet
  -- When SCAS/RPAS/etc org records are set up with person linkage, this can be enabled
  -- For now, the shelter_animal_id is stored in clinic_day_entries for future matching
  relationship_type := 'relo_source';
  relationships_created := 0;
  RETURN NEXT;

  -- Update trapper_person_id on appointments
  WITH trapper_updates AS (
    UPDATE trapper.sot_appointments a
    SET trapper_person_id = e.trapper_person_id
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.matched_appointment_id = a.appointment_id
      AND e.trapper_person_id IS NOT NULL
      AND a.trapper_person_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM trapper_updates;
  relationship_type := 'trapper_linkage';
  relationships_created := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.create_master_list_relationships(DATE) IS
'Create entity relationships from matched master list entries (relo_source, trapper linkage).';

-- -----------------------------------------------------
-- Summary
-- -----------------------------------------------------

\echo ''
\echo 'MIG_900 complete. Added:'
\echo ''
\echo 'Schema:'
\echo '  - clinic_day_entries: foster, shelter, address, phone columns'
\echo '  - clinic_day_entries: match_reason, matched_cat_id columns'
\echo ''
\echo 'Functions:'
\echo '  - match_master_list_by_cat_name(date) - Match by unique cat name'
\echo '  - match_master_list_by_sex(date) - Match by sex compatibility'
\echo '  - match_master_list_by_cardinality(date) - Match remaining by cardinality'
\echo '  - apply_smart_master_list_matches(date) - Apply all strategies in order'
\echo '  - retry_unmatched_master_list_entries() - Retry with SL/VH data'
\echo '  - create_master_list_relationships(date) - Create entity relationships'
\echo ''
\echo 'Usage:'
\echo '  SELECT * FROM trapper.apply_smart_master_list_matches(''2026-02-04'');'
\echo '  SELECT * FROM trapper.retry_unmatched_master_list_entries();'
\echo '  SELECT * FROM trapper.create_master_list_relationships(''2026-02-04'');'
\echo ''
\echo '=========================================='
