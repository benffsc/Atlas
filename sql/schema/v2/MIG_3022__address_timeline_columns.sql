-- MIG_3022: Address Timeline Infrastructure
--
-- Problem: sot.person_place has no temporal awareness — a stale ShelterLuv
-- address from 2024 looks identical to one confirmed today. Audra Nay's
-- request showed her Bedford address (2024 adoption) instead of her verified
-- current home because there was no way to rank by freshness.
--
-- Solution: Add last_confirmed_at + effective_to columns, a best_address_for_person()
-- helper, and update all write paths to bump last_confirmed_at on confirmation.
--
-- FFS-1034: Address timeline columns
-- FFS-1035: Fix enrich_person_from_request TEXT confidence → NUMERIC
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3022: Address Timeline Infrastructure'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1a. ADD COLUMNS
-- ============================================================================

\echo '1a. Adding last_confirmed_at and effective_to columns...'

ALTER TABLE sot.person_place ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ;
ALTER TABLE sot.person_place ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ;

COMMENT ON COLUMN sot.person_place.last_confirmed_at IS
'When this address was last confirmed via any write path (ingest, UI, verification).
Used for "best address" ranking — freshest confirmed address wins over stale ones.
MIG_3022.';

COMMENT ON COLUMN sot.person_place.effective_to IS
'When this address relationship ended (person moved away, etc.).
NULL = still active. Set manually by staff or via address change flows.
MIG_3022.';

\echo '   Columns added'

-- ============================================================================
-- 1b. BACKFILL existing rows
-- ============================================================================

\echo ''
\echo '1b. Backfilling last_confirmed_at from existing timestamps...'

UPDATE sot.person_place
SET last_confirmed_at = COALESCE(updated_at, created_at)
WHERE last_confirmed_at IS NULL;

\echo '   Backfill complete'

-- ============================================================================
-- 1c. INDEX for "best address" queries
-- ============================================================================

\echo ''
\echo '1c. Creating address ranking index...'

-- Note: Run with CONCURRENTLY on production to avoid locking.
-- In psql auto-commit mode, CONCURRENTLY works outside explicit transactions.
CREATE INDEX IF NOT EXISTS idx_person_place_address_ranking
  ON sot.person_place (person_id, effective_to, is_staff_verified, last_confirmed_at DESC NULLS LAST)
  WHERE relationship_type IN ('resident', 'owner', 'home');

\echo '   Index created'

-- ============================================================================
-- 1d. CREATE best_address_for_person() helper
-- ============================================================================

\echo ''
\echo '1d. Creating sot.best_address_for_person()...'

CREATE OR REPLACE FUNCTION sot.best_address_for_person(p_person_id UUID)
RETURNS TABLE(place_id UUID, relationship_type TEXT, last_confirmed_at TIMESTAMPTZ, is_staff_verified BOOLEAN)
AS $$
  SELECT pp.place_id, pp.relationship_type, pp.last_confirmed_at, pp.is_staff_verified
  FROM sot.person_place pp
  JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
  WHERE pp.person_id = p_person_id
    AND pp.effective_to IS NULL
    AND pp.relationship_type IN ('resident', 'owner', 'home')
  ORDER BY
    pp.is_staff_verified DESC NULLS LAST,
    pp.last_confirmed_at DESC NULLS LAST
  LIMIT 1
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.best_address_for_person IS
'Returns the single best active address for a person.
Ranking: staff-verified first, then most recently confirmed.
Filters out ended relationships (effective_to IS NOT NULL).
MIG_3022.';

\echo '   sot.best_address_for_person() created'

-- ============================================================================
-- 1e. UPDATE link_person_to_place() — add last_confirmed_at
-- ============================================================================

\echo ''
\echo '1e. Updating sot.link_person_to_place() with last_confirmed_at...'

DROP FUNCTION IF EXISTS sot.link_person_to_place(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION sot.link_person_to_place(
    p_person_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'resident',
    p_evidence_type TEXT DEFAULT 'manual',
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_confidence NUMERIC DEFAULT 0.9
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
BEGIN
    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system, last_confirmed_at
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system, NOW()
    )
    ON CONFLICT (person_id, place_id, relationship_type)
    DO UPDATE SET
        confidence = GREATEST(sot.person_place.confidence, EXCLUDED.confidence),
        last_confirmed_at = NOW(),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
EXCEPTION WHEN undefined_column THEN
    -- Fallback: Try with just person_id, place_id conflict
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system, last_confirmed_at
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        p_confidence, p_evidence_type, p_source_system, NOW()
    )
    ON CONFLICT (person_id, place_id) DO UPDATE SET
        relationship_type = EXCLUDED.relationship_type,
        confidence = GREATEST(sot.person_place.confidence, EXCLUDED.confidence),
        last_confirmed_at = NOW(),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_place IS
'V2: Creates or updates a person-place relationship.
MIG_3022: Sets last_confirmed_at = NOW() on both INSERT and ON CONFLICT UPDATE.
This is the big win — most write paths route through this function.
Accepts NUMERIC confidence (fixes MIG_2021 TEXT mismatch, MIG_2929).';

\echo '   sot.link_person_to_place() updated'

-- ============================================================================
-- 1f. UPDATE verify_person_place() — bump last_confirmed_at
-- ============================================================================

\echo ''
\echo '1f. Updating sot.verify_person_place() with last_confirmed_at...'

CREATE OR REPLACE FUNCTION sot.verify_person_place(
  p_person_place_id UUID,
  p_verified_by UUID,
  p_method TEXT,
  p_relationship_type TEXT DEFAULT NULL,
  p_financial_commitment TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_old_type TEXT;
  v_new_type TEXT;
  v_result JSONB;
BEGIN
  -- Validate person_place exists
  IF NOT EXISTS (SELECT 1 FROM sot.person_place WHERE id = p_person_place_id) THEN
    RAISE EXCEPTION 'person_place not found: %', p_person_place_id;
  END IF;

  -- Get current relationship type
  SELECT relationship_type INTO v_old_type
  FROM sot.person_place
  WHERE id = p_person_place_id;

  -- Determine new relationship type
  v_new_type := COALESCE(p_relationship_type, v_old_type);

  -- Update verification status + bump last_confirmed_at
  UPDATE sot.person_place
  SET is_staff_verified = TRUE,
      verified_at = NOW(),
      verified_by = p_verified_by,
      verification_method = p_method,
      relationship_type = v_new_type,
      last_confirmed_at = NOW()
  WHERE id = p_person_place_id;

  -- Upsert financial commitment if provided
  IF p_financial_commitment IS NOT NULL OR p_notes IS NOT NULL THEN
    INSERT INTO sot.person_place_details (person_place_id, financial_commitment, notes, created_by)
    VALUES (p_person_place_id, p_financial_commitment, p_notes, p_verified_by)
    ON CONFLICT (person_place_id) DO UPDATE
    SET financial_commitment = COALESCE(EXCLUDED.financial_commitment, sot.person_place_details.financial_commitment),
        notes = COALESCE(EXCLUDED.notes, sot.person_place_details.notes),
        updated_at = NOW();
  END IF;

  -- Build result
  v_result := jsonb_build_object(
    'success', TRUE,
    'person_place_id', p_person_place_id,
    'old_relationship_type', v_old_type,
    'new_relationship_type', v_new_type,
    'verified_at', NOW(),
    'verification_method', p_method
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.verify_person_place IS
'Verifies a person-place relationship with optional role update and financial commitment tracking.
MIG_3022: Now bumps last_confirmed_at = NOW() on verification.
Created by MIG_2514, updated MIG_3022.';

\echo '   sot.verify_person_place() updated'

-- ============================================================================
-- 1h. FIX enrich_person_from_request confidence type (FFS-1035)
-- ============================================================================

\echo ''
\echo '1h. Fixing enrich_person_from_request() — TEXT confidence → NUMERIC...'

CREATE OR REPLACE FUNCTION ops.enrich_person_from_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_req RECORD;
  v_rel_type TEXT;
BEGIN
  SELECT request_id, requester_person_id, place_id, is_third_party_report,
         requester_role_at_submission, site_contact_person_id, is_property_owner
  INTO v_req FROM ops.requests WHERE request_id = p_request_id;

  IF NOT FOUND OR v_req.requester_person_id IS NULL OR v_req.place_id IS NULL THEN
    RETURN;
  END IF;

  -- Skip trapper/staff roles (linked via trapper_service_places, not person_place)
  IF COALESCE(v_req.requester_role_at_submission, 'unknown') IN (
    'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff'
  ) THEN
    RETURN;
  END IF;

  -- CASE 1: Third-party reporter -> referrer
  IF v_req.is_third_party_report THEN
    PERFORM sot.link_person_to_place(
      v_req.requester_person_id, v_req.place_id,
      'referrer', 'request_report', 'atlas_ui', 0.9
    );
  ELSE
    -- CASE 2: Non-third-party -> map role to relationship type
    v_rel_type := CASE v_req.requester_role_at_submission
      WHEN 'resident'          THEN 'resident'
      WHEN 'property_owner'    THEN 'owner'
      WHEN 'colony_caretaker'  THEN 'colony_caretaker'
      WHEN 'neighbor'          THEN 'neighbor'
      WHEN 'concerned_citizen' THEN 'concerned_citizen'
      WHEN 'volunteer'         THEN 'volunteer'
      ELSE 'resident'  -- default for NULL/'unknown'/'frequent_caller'
    END;

    PERFORM sot.link_person_to_place(
      v_req.requester_person_id, v_req.place_id,
      v_rel_type, 'request_report', 'atlas_ui', 0.9
    );
  END IF;

  -- CASE 3: Site contact (if different from requester)
  IF v_req.site_contact_person_id IS NOT NULL
     AND v_req.site_contact_person_id != v_req.requester_person_id THEN
    PERFORM sot.link_person_to_place(
      v_req.site_contact_person_id, v_req.place_id,
      CASE WHEN v_req.is_property_owner THEN 'owner' ELSE 'resident' END,
      'request_report', 'atlas_ui', 0.9
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.enrich_person_from_request(UUID) IS
'Links requestor (and site contact) to request place via sot.link_person_to_place().
MIG_3022/FFS-1035: Fixed confidence from TEXT ''high'' to NUMERIC 0.9.
Handles: third-party reporters (referrer), regular callers (mapped by role), site contacts.
Skips trappers/staff. Originally MIG_2862/FFS-295.';

\echo '   enrich_person_from_request() fixed'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'New columns on sot.person_place:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'sot' AND table_name = 'person_place'
  AND column_name IN ('last_confirmed_at', 'effective_to')
ORDER BY column_name;

\echo ''
\echo 'Backfill check (should be 0):'
SELECT COUNT(*) AS null_last_confirmed_at
FROM sot.person_place
WHERE last_confirmed_at IS NULL;

\echo ''
\echo 'Functions updated:'
SELECT proname, pronamespace::regnamespace AS schema
FROM pg_proc
WHERE proname IN ('best_address_for_person', 'link_person_to_place', 'verify_person_place', 'enrich_person_from_request')
  AND pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('sot', 'ops'))
ORDER BY schema, proname;

\echo ''
\echo '=============================================='
\echo '  MIG_3022 Complete!'
\echo '=============================================='
\echo ''
\echo 'CREATED:'
\echo '  - sot.person_place.last_confirmed_at column (backfilled)'
\echo '  - sot.person_place.effective_to column'
\echo '  - idx_person_place_address_ranking index'
\echo '  - sot.best_address_for_person() helper function'
\echo ''
\echo 'UPDATED:'
\echo '  - sot.link_person_to_place() — sets last_confirmed_at = NOW()'
\echo '  - sot.verify_person_place() — sets last_confirmed_at = NOW()'
\echo '  - ops.enrich_person_from_request() — fixed TEXT confidence to NUMERIC 0.9'
\echo ''
\echo 'ALSO REQUIRED: Re-run MIG_2975 for ClinicHQ post-processing update (1g).'
\echo ''
