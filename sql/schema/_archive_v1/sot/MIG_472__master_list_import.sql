-- =====================================================
-- MIG_472: Master List Import System
-- =====================================================
-- Adds schema support for importing SharePoint Master List
-- Excel files as ground truth for clinic day attendance.
-- Extends clinic_day_entries with parsing and matching columns.
-- =====================================================

\echo '=========================================='
\echo 'MIG_472: Master List Import System'
\echo '=========================================='

-- Enable pg_trgm extension for fuzzy matching (if not already)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------
-- Add columns to clinic_day_entries for master list data
-- -----------------------------------------------------

\echo 'Adding master list columns to clinic_day_entries...'

-- Raw data from master list
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  raw_client_name TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.raw_client_name IS 'Original client name from master list (e.g., "Nina Van Sweden - Trp Crystal")';

-- Parsed fields
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  parsed_owner_name TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.parsed_owner_name IS 'Extracted owner name without trapper suffix';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  parsed_cat_name TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.parsed_cat_name IS 'Cat name extracted from quotes in client name';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  parsed_trapper_alias TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.parsed_trapper_alias IS 'Trapper alias extracted from "Trp X" suffix';

-- Matching to ClinicHQ appointments
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  matched_appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id);

COMMENT ON COLUMN trapper.clinic_day_entries.matched_appointment_id IS 'Linked ClinicHQ appointment (if matched)';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  match_confidence TEXT;

-- Add check constraint separately to avoid issues if column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_day_entries_match_confidence_check'
  ) THEN
    ALTER TABLE trapper.clinic_day_entries
    ADD CONSTRAINT clinic_day_entries_match_confidence_check
    CHECK (match_confidence IS NULL OR match_confidence IN ('high', 'medium', 'low', 'unmatched', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN trapper.clinic_day_entries.match_confidence IS 'Confidence level of appointment match';

-- Master list specific fields
ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  fee_code TEXT;

COMMENT ON COLUMN trapper.clinic_day_entries.fee_code IS 'Fee code from master list (e.g., 50ca, 100ch, 51cc)';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  is_walkin BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.clinic_day_entries.is_walkin IS 'Wellness/walk-in visit (A/W column = W)';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  is_already_altered BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.clinic_day_entries.is_already_altered IS 'Cat was already altered (A/W column = A)';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  was_altered BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trapper.clinic_day_entries.was_altered IS 'Surgery performed this visit (F=1 or M=1, counts as alteration)';

ALTER TABLE trapper.clinic_day_entries ADD COLUMN IF NOT EXISTS
  line_number INT;

COMMENT ON COLUMN trapper.clinic_day_entries.line_number IS 'Sequential number from master list (# column)';

-- -----------------------------------------------------
-- Trapper Aliases Table
-- -----------------------------------------------------
-- Maps short names (Crystal) to full trapper records

\echo 'Creating trapper_aliases table...'

CREATE TABLE IF NOT EXISTS trapper.trapper_aliases (
  alias_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  alias_type TEXT DEFAULT 'first_name' CHECK (alias_type IN ('first_name', 'nickname', 'organization', 'manual')),
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES trapper.staff(staff_id),
  UNIQUE(person_id, alias_name)
);

COMMENT ON TABLE trapper.trapper_aliases IS 'Maps trapper aliases/nicknames to person records for master list matching';
COMMENT ON COLUMN trapper.trapper_aliases.alias_name IS 'The alias used in master list (e.g., "Crystal", "Katie Moore", "Marin Friends of Ferals")';
COMMENT ON COLUMN trapper.trapper_aliases.alias_type IS 'Type of alias: first_name, nickname, organization, or manual entry';

CREATE INDEX IF NOT EXISTS idx_trapper_aliases_name
  ON trapper.trapper_aliases(lower(alias_name));

CREATE INDEX IF NOT EXISTS idx_trapper_aliases_person
  ON trapper.trapper_aliases(person_id);

-- -----------------------------------------------------
-- Populate trapper aliases from existing trappers
-- -----------------------------------------------------

\echo 'Populating trapper aliases from existing trappers...'

INSERT INTO trapper.trapper_aliases (person_id, alias_name, alias_type, is_primary)
SELECT DISTINCT
  p.person_id,
  p.first_name,
  'first_name',
  TRUE
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE pr.role_name IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
  AND p.first_name IS NOT NULL
  AND p.first_name != ''
ON CONFLICT (person_id, alias_name) DO NOTHING;

-- Also add display_name as alias for organization trappers
INSERT INTO trapper.trapper_aliases (person_id, alias_name, alias_type)
SELECT DISTINCT
  p.person_id,
  p.display_name,
  'organization'
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE pr.role_name IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
  AND p.display_name IS NOT NULL
  AND p.display_name != p.first_name
ON CONFLICT (person_id, alias_name) DO NOTHING;

-- -----------------------------------------------------
-- Function: resolve_trapper_alias
-- -----------------------------------------------------

\echo 'Creating resolve_trapper_alias function...'

CREATE OR REPLACE FUNCTION trapper.resolve_trapper_alias(p_alias TEXT)
RETURNS UUID AS $$
DECLARE
  v_person_id UUID;
BEGIN
  -- Exact match first
  SELECT ta.person_id INTO v_person_id
  FROM trapper.trapper_aliases ta
  WHERE lower(ta.alias_name) = lower(p_alias)
  LIMIT 1;

  IF v_person_id IS NOT NULL THEN
    RETURN v_person_id;
  END IF;

  -- Fuzzy match with high threshold
  SELECT ta.person_id INTO v_person_id
  FROM trapper.trapper_aliases ta
  WHERE similarity(lower(ta.alias_name), lower(p_alias)) > 0.7
  ORDER BY similarity(lower(ta.alias_name), lower(p_alias)) DESC
  LIMIT 1;

  RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.resolve_trapper_alias(TEXT) IS 'Resolves a trapper alias/nickname to a person_id';

-- -----------------------------------------------------
-- Function: match_master_list_to_appointments
-- -----------------------------------------------------

\echo 'Creating match_master_list_to_appointments function...'

CREATE OR REPLACE FUNCTION trapper.match_master_list_to_appointments(
  p_clinic_date DATE
) RETURNS TABLE (
  entry_id UUID,
  appointment_id UUID,
  confidence TEXT,
  match_reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH unmatched_entries AS (
    SELECT
      e.entry_id,
      e.parsed_owner_name,
      e.parsed_cat_name,
      e.female_count,
      e.male_count
    FROM trapper.clinic_day_entries e
    JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
    WHERE cd.clinic_date = p_clinic_date
      AND e.matched_appointment_id IS NULL
      AND e.parsed_owner_name IS NOT NULL
  ),
  available_appointments AS (
    SELECT DISTINCT ON (a.appointment_id)
      a.appointment_id,
      p.display_name AS owner_name,
      c.display_name AS cat_name,
      a.is_spay,
      a.is_neuter
    FROM trapper.sot_appointments a
    LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id
    LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
    WHERE a.appointment_date = p_clinic_date
      AND NOT EXISTS (
        SELECT 1 FROM trapper.clinic_day_entries cde
        WHERE cde.matched_appointment_id = a.appointment_id
      )
  ),
  matches AS (
    SELECT
      e.entry_id,
      a.appointment_id,
      CASE
        WHEN lower(e.parsed_owner_name) = lower(a.owner_name)
             AND e.parsed_cat_name IS NOT NULL
             AND lower(e.parsed_cat_name) = lower(COALESCE(a.cat_name, ''))
          THEN 'high'
        WHEN lower(e.parsed_owner_name) = lower(a.owner_name)
          THEN 'medium'
        WHEN similarity(lower(e.parsed_owner_name), lower(COALESCE(a.owner_name, ''))) > 0.6
          THEN 'low'
        ELSE NULL
      END AS confidence,
      'name_match' AS match_reason,
      similarity(lower(e.parsed_owner_name), lower(COALESCE(a.owner_name, ''))) AS sim_score
    FROM unmatched_entries e
    CROSS JOIN available_appointments a
    WHERE similarity(lower(e.parsed_owner_name), lower(COALESCE(a.owner_name, ''))) > 0.4
  )
  SELECT DISTINCT ON (m.entry_id)
    m.entry_id,
    m.appointment_id,
    m.confidence,
    m.match_reason
  FROM matches m
  WHERE m.confidence IS NOT NULL
  ORDER BY m.entry_id, m.sim_score DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.match_master_list_to_appointments(DATE) IS 'Matches unmatched clinic_day_entries to sot_appointments by name similarity';

-- -----------------------------------------------------
-- Function: apply_master_list_matches
-- -----------------------------------------------------

\echo 'Creating apply_master_list_matches function...'

CREATE OR REPLACE FUNCTION trapper.apply_master_list_matches(
  p_clinic_date DATE,
  p_min_confidence TEXT DEFAULT 'low'
) RETURNS TABLE (
  entries_matched INT,
  high_confidence INT,
  medium_confidence INT,
  low_confidence INT
) AS $$
DECLARE
  v_matched INT := 0;
  v_high INT := 0;
  v_medium INT := 0;
  v_low INT := 0;
BEGIN
  -- Apply matches
  WITH matches AS (
    SELECT * FROM trapper.match_master_list_to_appointments(p_clinic_date)
    WHERE
      CASE p_min_confidence
        WHEN 'high' THEN confidence = 'high'
        WHEN 'medium' THEN confidence IN ('high', 'medium')
        ELSE confidence IN ('high', 'medium', 'low')
      END
  ),
  updated AS (
    UPDATE trapper.clinic_day_entries e
    SET
      matched_appointment_id = m.appointment_id,
      match_confidence = m.confidence
    FROM matches m
    WHERE e.entry_id = m.entry_id
    RETURNING m.confidence
  )
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE confidence = 'high')::INT,
    COUNT(*) FILTER (WHERE confidence = 'medium')::INT,
    COUNT(*) FILTER (WHERE confidence = 'low')::INT
  INTO v_matched, v_high, v_medium, v_low
  FROM updated;

  RETURN QUERY SELECT v_matched, v_high, v_medium, v_low;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.apply_master_list_matches(DATE, TEXT) IS 'Applies automatic matches to clinic_day_entries with confidence filtering';

-- -----------------------------------------------------
-- Indexes for matching performance
-- -----------------------------------------------------

\echo 'Creating indexes for matching...'

CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_parsed_owner
  ON trapper.clinic_day_entries USING gin(parsed_owner_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_matched_appt
  ON trapper.clinic_day_entries(matched_appointment_id);

CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_line_number
  ON trapper.clinic_day_entries(clinic_day_id, line_number);

-- -----------------------------------------------------
-- View: v_master_list_comparison
-- -----------------------------------------------------

\echo 'Creating v_master_list_comparison view...'

CREATE OR REPLACE VIEW trapper.v_master_list_comparison AS
SELECT
  cd.clinic_date,
  cd.clinic_type,
  cd.total_cats AS master_list_total,
  cd.total_females AS master_list_females,
  cd.total_males AS master_list_males,

  -- Alteration counts from master list
  (SELECT COUNT(*) FROM trapper.clinic_day_entries cde
   WHERE cde.clinic_day_id = cd.clinic_day_id AND cde.was_altered = TRUE) AS alterations_performed,

  -- ClinicHQ counts
  COALESCE(chq.clinichq_total, 0) AS clinichq_total,
  COALESCE(chq.clinichq_spays, 0) AS clinichq_spays,
  COALESCE(chq.clinichq_neuters, 0) AS clinichq_neuters,

  -- Match stats
  (SELECT COUNT(*) FROM trapper.clinic_day_entries cde
   WHERE cde.clinic_day_id = cd.clinic_day_id AND cde.matched_appointment_id IS NOT NULL) AS matched_count,
  (SELECT COUNT(*) FROM trapper.clinic_day_entries cde
   WHERE cde.clinic_day_id = cd.clinic_day_id AND cde.matched_appointment_id IS NULL AND cde.parsed_owner_name IS NOT NULL) AS unmatched_count,

  -- Confidence breakdown
  (SELECT COUNT(*) FROM trapper.clinic_day_entries cde
   WHERE cde.clinic_day_id = cd.clinic_day_id AND cde.match_confidence = 'high') AS high_confidence,
  (SELECT COUNT(*) FROM trapper.clinic_day_entries cde
   WHERE cde.clinic_day_id = cd.clinic_day_id AND cde.match_confidence = 'medium') AS medium_confidence,
  (SELECT COUNT(*) FROM trapper.clinic_day_entries cde
   WHERE cde.clinic_day_id = cd.clinic_day_id AND cde.match_confidence = 'low') AS low_confidence

FROM trapper.clinic_days cd
LEFT JOIN LATERAL (
  SELECT
    COUNT(DISTINCT a.appointment_id) AS clinichq_total,
    COUNT(DISTINCT a.appointment_id) FILTER (WHERE a.is_spay) AS clinichq_spays,
    COUNT(DISTINCT a.appointment_id) FILTER (WHERE a.is_neuter) AS clinichq_neuters
  FROM trapper.sot_appointments a
  WHERE a.appointment_date = cd.clinic_date
) chq ON TRUE;

COMMENT ON VIEW trapper.v_master_list_comparison IS 'Compares master list entries with ClinicHQ appointments including match statistics';

-- -----------------------------------------------------
-- Summary
-- -----------------------------------------------------

\echo ''
\echo 'Added columns to clinic_day_entries:'
\echo '  - raw_client_name, parsed_owner_name, parsed_cat_name, parsed_trapper_alias'
\echo '  - matched_appointment_id, match_confidence'
\echo '  - fee_code, is_walkin, is_already_altered, was_altered, line_number'
\echo ''
\echo 'Created tables:'
\echo '  - trapper_aliases: Maps trapper nicknames to person records'
\echo ''
\echo 'Created functions:'
\echo '  - resolve_trapper_alias(alias): Returns person_id for alias'
\echo '  - match_master_list_to_appointments(date): Returns potential matches'
\echo '  - apply_master_list_matches(date, confidence): Applies matches to entries'
\echo ''
\echo 'Created views:'
\echo '  - v_master_list_comparison: Compares master list vs ClinicHQ'
\echo ''
\echo 'MIG_472 complete'
\echo '=========================================='
