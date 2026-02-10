-- ============================================================================
-- MIG_970: Fix Broken infer_appointment_places() Function
-- ============================================================================
-- Problem: MIG_960 introduced references to columns that don't exist:
--   - clinic_owner_accounts.email (doesn't exist)
--   - clinic_owner_accounts.normalized_phone (doesn't exist)
--   - clinic_owner_accounts.default_place_id (should be linked_place_id)
--   - person_place_relationships.is_primary (doesn't exist)
--   - organizations.contact_emails (doesn't exist)
--   - organizations.contact_phones (doesn't exist)
--
-- Impact: Entity linking silently fails on every ingest:
--   - inferred_place_id not set on new appointments
--   - link_cats_to_appointment_places() can't link cats
--   - Cats don't get linked to places or requests
--
-- Solution: Rewrite infer_appointment_places() with working steps:
--   - Keep Step 0a & 0b (booking address matching - working)
--   - Remove Step 1 (clinic_owner_accounts - conceptually flawed)
--   - Fix Step 2 (use confidence ordering instead of is_primary)
--   - Remove Step 3 (organizations - broken references)
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_970: Fix Broken infer_appointment_places() Function'
\echo '=============================================================================='
\echo ''
\echo 'Problem: MIG_960 references columns that do not exist'
\echo '  - clinic_owner_accounts.email (NO)'
\echo '  - clinic_owner_accounts.normalized_phone (NO)'
\echo '  - clinic_owner_accounts.default_place_id (should be linked_place_id)'
\echo '  - person_place_relationships.is_primary (NO)'
\echo '  - organizations.contact_emails (NO)'
\echo '  - organizations.contact_phones (NO)'
\echo ''

-- ============================================================================
-- PHASE 1: PRE-FIX DIAGNOSTIC
-- ============================================================================

\echo 'Phase 1: Pre-fix diagnostic...'
\echo ''

\echo '1a. Current error when calling infer_appointment_places():'
\echo '    ERROR: column coa.email does not exist'
\echo ''

\echo '1b. Appointments missing inferred_place_id (last 30 days):'
SELECT
  appointment_date,
  COUNT(*) as total,
  COUNT(inferred_place_id) as has_place,
  COUNT(*) - COUNT(inferred_place_id) as missing_place
FROM trapper.sot_appointments
WHERE appointment_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY appointment_date
ORDER BY appointment_date DESC
LIMIT 10;

-- ============================================================================
-- PHASE 2: FIX THE FUNCTION
-- ============================================================================

\echo ''
\echo 'Phase 2: Rewriting infer_appointment_places() with working steps...'

CREATE OR REPLACE FUNCTION trapper.infer_appointment_places()
RETURNS TABLE(source TEXT, appointments_linked INT) AS $$
DECLARE
  v_linked INT;
BEGIN
  -- =========================================================================
  -- Step 0a: Direct booking address match (exact normalized)
  -- Uses staged_records.payload->'Owner Address' which is the appointment address
  -- This is the HIGHEST PRIORITY source - the actual address on the booking
  -- =========================================================================
  UPDATE trapper.sot_appointments a
  SET
    inferred_place_id = p.place_id,
    inferred_place_source = 'booking_address'
  FROM trapper.staged_records sr
  JOIN trapper.places p ON
    p.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
    AND p.merged_into_place_id IS NULL
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'owner_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND a.inferred_place_id IS NULL
    AND LENGTH(TRIM(COALESCE(sr.payload->>'Owner Address', ''))) > 10;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  source := 'booking_address'; appointments_linked := v_linked; RETURN NEXT;

  -- =========================================================================
  -- Step 0b: Aggressive match using normalize_address_for_dedup
  -- Catches cases like "1814 Empire Industrial Ct, Santa Rosa, CA 95403"
  -- matching "1814 Empire Industrial Court" (no city/state in place record)
  -- =========================================================================
  UPDATE trapper.sot_appointments a
  SET
    inferred_place_id = p.place_id,
    inferred_place_source = 'booking_address_dedup'
  FROM trapper.staged_records sr
  JOIN trapper.places p ON
    trapper.normalize_address_for_dedup(sr.payload->>'Owner Address')
      = trapper.normalize_address_for_dedup(p.formatted_address)
    AND p.merged_into_place_id IS NULL
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'owner_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND a.inferred_place_id IS NULL
    AND LENGTH(TRIM(COALESCE(sr.payload->>'Owner Address', ''))) > 10;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  source := 'booking_address_dedup'; appointments_linked := v_linked; RETURN NEXT;

  -- =========================================================================
  -- Step 1: REMOVED (MIG_970)
  -- Clinic owner accounts matching was conceptually flawed - these are
  -- pseudo-profiles for addresses/organizations (apartment complexes, etc),
  -- not people with contact info. They don't have email/phone columns.
  -- =========================================================================

  -- =========================================================================
  -- Step 2: Person-place relationships (best place for linked person)
  -- MIG_970: Fixed to use confidence ordering instead of non-existent is_primary
  -- Uses DISTINCT ON to get the single best place per person
  -- =========================================================================
  UPDATE trapper.sot_appointments a
  SET
    inferred_place_id = best.place_id,
    inferred_place_source = 'person_place_relationships'
  FROM (
    SELECT DISTINCT ON (ppr.person_id)
      ppr.person_id, ppr.place_id
    FROM trapper.person_place_relationships ppr
    WHERE ppr.place_id IS NOT NULL
    ORDER BY ppr.person_id, ppr.confidence DESC NULLS LAST, ppr.created_at DESC
  ) best
  WHERE a.inferred_place_id IS NULL
    AND a.person_id IS NOT NULL
    AND best.person_id = a.person_id;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  source := 'person_place_relationships'; appointments_linked := v_linked; RETURN NEXT;

  -- =========================================================================
  -- Step 3: REMOVED (MIG_970)
  -- Organization place mappings was broken - organizations table doesn't have
  -- contact_emails or contact_phones columns. The organizations table is for
  -- internal FFSC departments, not external partners.
  --
  -- If needed, this can be re-added later with known_organizations table which
  -- may have contact info for external partners.
  -- =========================================================================

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.infer_appointment_places() IS
'MIG_970: Fixed broken function from MIG_960.

Infers place_id for appointments using these sources (in priority order):
  0a. booking_address - Exact normalized match on appointment address
  0b. booking_address_dedup - Aggressive match using normalize_address_for_dedup
  2.  person_place_relationships - Best place for linked person (by confidence)

Steps REMOVED by MIG_970:
  1. clinic_owner_accounts - These are pseudo-profiles without email/phone
  3. organization_place_mappings - organizations table lacks contact columns

The function is idempotent - only updates appointments with NULL inferred_place_id.';

\echo 'Function rewritten successfully.'

-- ============================================================================
-- PHASE 3: VERIFY FUNCTION WORKS
-- ============================================================================

\echo ''
\echo 'Phase 3: Verifying function works...'
\echo ''

\echo '3a. Running infer_appointment_places():'
SELECT * FROM trapper.infer_appointment_places();

-- ============================================================================
-- PHASE 4: BACKFILL AND RE-LINK
-- ============================================================================

\echo ''
\echo 'Phase 4: Running cat-place linking now that inferred_place_id is set...'

\echo ''
\echo '4a. Linking cats to appointment places:'
SELECT * FROM trapper.link_cats_to_appointment_places();

\echo ''
\echo '4b. Linking cats to requests:'
SELECT * FROM trapper.link_cats_to_requests_safe();

-- ============================================================================
-- PHASE 5: POST-FIX VERIFICATION
-- ============================================================================

\echo ''
\echo 'Phase 5: Post-fix verification...'
\echo ''

\echo '5a. Appointments with inferred_place_id (last 30 days):'
SELECT
  appointment_date,
  COUNT(*) as total,
  COUNT(inferred_place_id) as has_place,
  ROUND(COUNT(inferred_place_id)::numeric / COUNT(*) * 100, 1) as pct_with_place
FROM trapper.sot_appointments
WHERE appointment_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY appointment_date
ORDER BY appointment_date DESC
LIMIT 10;

\echo ''
\echo '5b. Recent appointments by inferred_place_source:'
SELECT
  inferred_place_source,
  COUNT(*) as appointments
FROM trapper.sot_appointments
WHERE appointment_date >= CURRENT_DATE - INTERVAL '30 days'
  AND inferred_place_id IS NOT NULL
GROUP BY inferred_place_source
ORDER BY COUNT(*) DESC;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================================================='
\echo 'MIG_970 Complete'
\echo '=============================================================================='
\echo ''
\echo 'What was fixed:'
\echo '  - Removed broken Step 1 (clinic_owner_accounts.email does not exist)'
\echo '  - Fixed Step 2 (use confidence ordering, not is_primary)'
\echo '  - Removed broken Step 3 (organizations.contact_emails does not exist)'
\echo ''
\echo 'Why MIG_960 was broken:'
\echo '  - Referenced columns that were planned but never implemented'
\echo '  - Errors were silently caught in ingest code try-catch blocks'
\echo ''
\echo 'Entity linking pipeline is now working again.'
\echo ''
