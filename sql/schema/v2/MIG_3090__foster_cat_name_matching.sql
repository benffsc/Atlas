-- MIG_3090: Enhanced foster cat matching — cat name comparison
--
-- Part of FFS-1237 (CDS: Foster cat detection via booking account + waiver color)
--
-- Problem: Foster cats are booked under "Forgotten Felines Fosters" in ClinicHQ.
-- The ML entry says `Foster "Bear" (Adams/Stroud)`, extracting:
--   - is_foster = true
--   - parsed_cat_name = "Bear"
--   - foster_parent_name = "Adams/Stroud"
--
-- The existing pass compares foster_parent_name against client_name, but
-- "Adams/Stroud" never matches "Forgotten Felines Fosters".
--
-- ClinicHQ names the CAT as "Bear (Adams/Stroud)" — the cat name in CHQ
-- contains both the cat name AND the foster parent name.
--
-- Fix: When is_foster=true and foster_parent_name doesn't match directly,
-- fall back to matching parsed_cat_name against the CHQ cat name for
-- appointments booked under a foster account.
--
-- Depends on: MIG_2816 (original foster matching), MIG_2328 (is_foster column)
--
-- Created: 2026-04-18

\echo ''
\echo '=============================================='
\echo '  MIG_3090: Enhanced Foster Cat Name Matching'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Enhanced foster matching function
-- ============================================================================
-- Replaces ops.match_master_list_by_foster with two sub-passes:
--   A) Original: foster_parent_name matches client/owner (exact)
--   B) NEW: cat name match for foster-account bookings

\echo '1. Updating ops.match_master_list_by_foster...'

CREATE OR REPLACE FUNCTION ops.match_master_list_by_foster(p_clinic_date DATE)
RETURNS INT AS $$
DECLARE
  v_matched_a INT := 0;
  v_matched_b INT := 0;
BEGIN
  -- ── Pass A: foster_parent_name matches appointment client/owner (original) ──
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
        COALESCE(
          similarity(LOWER(COALESCE(e2.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))),
          0
        ) AS cat_sim
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
        AND a.merged_into_appointment_id IS NULL
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
            AND e3.match_confidence IS NOT NULL
            AND e3.match_confidence != 'unmatched'
        )
      ORDER BY e2.entry_id, cat_sim DESC
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched_a FROM matches;

  -- ── Pass B: cat name match for foster-account bookings ──
  -- When the appointment is booked under "Forgotten Felines Fosters" (or similar),
  -- the CHQ cat name often includes the foster parent name in parens:
  --   ML: parsed_cat_name = "Bear"
  --   CHQ: c.name = "Bear (Adams/Stroud)"
  -- We match when: parsed_cat_name appears in c.name (case-insensitive)
  -- OR similarity > 0.5 between the two cat names.
  WITH matches AS (
    UPDATE ops.clinic_day_entries e
    SET
      matched_appointment_id = sub.appointment_id,
      match_confidence = 'high',
      match_reason = 'foster_cat_name',
      matched_at = NOW()
    FROM (
      SELECT DISTINCT ON (e2.entry_id)
        e2.entry_id,
        a.appointment_id,
        -- Score: exact substring match beats fuzzy
        CASE
          WHEN LOWER(COALESCE(c.name, '')) LIKE '%' || LOWER(COALESCE(e2.parsed_cat_name, '')) || '%'
          THEN 1.0
          ELSE similarity(LOWER(COALESCE(e2.parsed_cat_name, '')), LOWER(COALESCE(c.name, '')))
        END AS cat_sim
      FROM ops.clinic_day_entries e2
      JOIN ops.clinic_days cd ON cd.clinic_day_id = e2.clinic_day_id
      JOIN ops.appointments a ON a.appointment_date = cd.clinic_date
        AND a.merged_into_appointment_id IS NULL
      JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
      WHERE cd.clinic_date = p_clinic_date
        AND e2.matched_appointment_id IS NULL
        AND e2.is_foster = TRUE
        AND e2.parsed_cat_name IS NOT NULL
        AND LENGTH(TRIM(e2.parsed_cat_name)) >= 2  -- avoid matching empty/single-char
        -- Appointment must be booked under a foster account
        AND (
          LOWER(a.client_name) LIKE '%foster%'
          OR LOWER(a.client_name) LIKE '%forgotten feline%'
        )
        -- Cat name must match: substring or fuzzy
        AND (
          LOWER(c.name) LIKE '%' || LOWER(TRIM(e2.parsed_cat_name)) || '%'
          OR similarity(LOWER(COALESCE(e2.parsed_cat_name, '')), LOWER(COALESCE(c.name, ''))) > 0.5
        )
        -- Not already claimed by another entry
        AND NOT EXISTS (
          SELECT 1 FROM ops.clinic_day_entries e3
          WHERE e3.matched_appointment_id = a.appointment_id
            AND e3.match_confidence IS NOT NULL
            AND e3.match_confidence != 'unmatched'
        )
      ORDER BY e2.entry_id, cat_sim DESC
    ) sub
    WHERE e.entry_id = sub.entry_id
    RETURNING e.entry_id
  )
  SELECT COUNT(*) INTO v_matched_b FROM matches;

  RETURN v_matched_a + v_matched_b;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.match_master_list_by_foster IS
  'Pass 5: Match foster entries by (A) foster_parent_name against client/owner, '
  'or (B) parsed_cat_name against CHQ cat name for foster-account bookings. '
  'FFS-1237: handles "Forgotten Felines Fosters" booking pattern.';

-- ============================================================================
-- 2. Verification
-- ============================================================================

\echo ''
\echo '2. Verification...'

DO $$
DECLARE
  v_func_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'match_master_list_by_foster'
  ) INTO v_func_exists;

  ASSERT v_func_exists, 'ops.match_master_list_by_foster not found';
  RAISE NOTICE '   ✓ Function updated successfully';
END;
$$;

COMMIT;

\echo ''
\echo '✓ MIG_3090 complete'
\echo ''
