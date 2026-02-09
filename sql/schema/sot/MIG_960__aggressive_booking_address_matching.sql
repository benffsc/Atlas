\echo ''
\echo '=============================================================================='
\echo 'MIG_960: Aggressive Booking Address Matching in infer_appointment_places()'
\echo '=============================================================================='
\echo ''
\echo 'Problem: ~267 appointments have booking addresses that dont match any place'
\echo 'because of minor variations that normalize_address() doesnt catch:'
\echo '  - "1814 Empire Industrial Ct, Santa Rosa, CA 95403" has no exact match'
\echo '  - Closest place is "1814 Empire Industrial Court" (no city/state)'
\echo ''
\echo 'Solution: Update infer_appointment_places() Step 0 to also try matching'
\echo 'with normalize_address_for_dedup() which strips city/state/zip for comparison.'
\echo ''

-- ============================================================================
-- PHASE 1: Test the aggressive matching
-- ============================================================================

\echo 'Phase 1: Testing aggressive matching...'

\echo ''
\echo 'Appointments that would match with aggressive normalization:'
SELECT
  a.client_address,
  p.formatted_address as would_match_to,
  COUNT(*) as appointments
FROM trapper.sot_appointments a
JOIN trapper.places p ON
  trapper.normalize_address_for_dedup(a.client_address) = trapper.normalize_address_for_dedup(p.formatted_address)
  AND p.merged_into_place_id IS NULL
LEFT JOIN trapper.places current ON current.place_id = a.inferred_place_id
WHERE a.client_address IS NOT NULL
  AND LENGTH(TRIM(a.client_address)) > 10
  AND (a.inferred_place_id IS NULL OR trapper.normalize_address(a.client_address) != current.normalized_address)
GROUP BY a.client_address, p.formatted_address
ORDER BY COUNT(*) DESC
LIMIT 15;

-- ============================================================================
-- PHASE 2: Update infer_appointment_places() with aggressive matching fallback
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating infer_appointment_places() with aggressive matching...'

CREATE OR REPLACE FUNCTION trapper.infer_appointment_places()
RETURNS TABLE(source TEXT, appointments_linked INT) AS $$
DECLARE
  v_linked INT;
BEGIN
  -- =========================================================================
  -- Step 0: Direct booking address match (HIGHEST PRIORITY)
  -- Uses staged_records.payload->'Owner Address' which is the appointment address
  -- MIG_960: Also tries aggressive matching via normalize_address_for_dedup()
  -- =========================================================================

  -- Step 0a: Exact normalized match
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

  -- Step 0b: Aggressive match using normalize_address_for_dedup (NEW in MIG_960)
  -- This catches cases like "1814 Empire Industrial Ct, Santa Rosa, CA 95403"
  -- matching "1814 Empire Industrial Court" (no city/state in place record)
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
  -- Step 1: Clinic owner accounts (specific addresses for known clinics)
  -- =========================================================================
  UPDATE trapper.sot_appointments a
  SET
    inferred_place_id = coa.default_place_id,
    inferred_place_source = 'clinic_owner_accounts'
  FROM trapper.clinic_owner_accounts coa
  WHERE a.inferred_place_id IS NULL
    AND (
      (a.owner_email IS NOT NULL AND LOWER(a.owner_email) = LOWER(coa.email))
      OR (a.owner_phone IS NOT NULL AND trapper.norm_phone_us(a.owner_phone) = coa.normalized_phone)
    )
    AND coa.default_place_id IS NOT NULL;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  source := 'clinic_owner_accounts'; appointments_linked := v_linked; RETURN NEXT;

  -- =========================================================================
  -- Step 2: Person-place relationships (fallback to person's primary address)
  -- =========================================================================
  UPDATE trapper.sot_appointments a
  SET
    inferred_place_id = ppr.place_id,
    inferred_place_source = 'person_place_relationships'
  FROM trapper.person_place_relationships ppr
  WHERE a.inferred_place_id IS NULL
    AND a.person_id IS NOT NULL
    AND ppr.person_id = a.person_id
    AND ppr.place_id IS NOT NULL
    AND ppr.is_primary = true;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  source := 'person_place_relationships'; appointments_linked := v_linked; RETURN NEXT;

  -- =========================================================================
  -- Step 3: Organization place mappings (partner orgs with known locations)
  -- =========================================================================
  UPDATE trapper.sot_appointments a
  SET
    inferred_place_id = opm.place_id,
    inferred_place_source = 'organization_place_mappings'
  FROM trapper.organization_place_mappings opm
  JOIN trapper.organizations o ON o.org_id = opm.org_id
  WHERE a.inferred_place_id IS NULL
    AND (
      (a.owner_email IS NOT NULL AND LOWER(a.owner_email) = ANY(o.contact_emails))
      OR (a.owner_phone IS NOT NULL AND trapper.norm_phone_us(a.owner_phone) = ANY(o.contact_phones))
    )
    AND opm.place_id IS NOT NULL;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  source := 'organization_place_mappings'; appointments_linked := v_linked; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.infer_appointment_places IS
'MIG_960: Infers place_id for appointments using multiple sources in priority order.

Sources (in order):
1. booking_address - Direct match on normalized appointment address
2. booking_address_dedup - Aggressive match using normalize_address_for_dedup() (MIG_960)
3. clinic_owner_accounts - Known clinic email/phone mappings
4. person_place_relationships - Person primary address fallback
5. organization_place_mappings - Partner org locations

The aggressive dedup matching catches variations like city/state formatting
differences or missing suffixes.';

-- ============================================================================
-- PHASE 3: Clear and re-run for remaining mismatches
-- ============================================================================

\echo ''
\echo 'Phase 3: Clearing remaining mis-inferred appointments and re-running...'

-- Clear appointments that still don't match their booking address
WITH still_mismatched AS (
  SELECT DISTINCT a.appointment_id
  FROM trapper.sot_appointments a
  JOIN trapper.places p ON p.place_id = a.inferred_place_id
  WHERE a.client_address IS NOT NULL
    AND LENGTH(TRIM(a.client_address)) > 10
    AND trapper.normalize_address(a.client_address) != p.normalized_address
    AND a.inferred_place_source NOT IN ('booking_address', 'booking_address_fuzzy', 'booking_address_dedup')
)
UPDATE trapper.sot_appointments a
SET
  inferred_place_id = NULL,
  inferred_place_source = NULL
FROM still_mismatched m
WHERE a.appointment_id = m.appointment_id;

\echo ''
\echo 'Re-running infer_appointment_places()...'
SELECT * FROM trapper.infer_appointment_places();

\echo ''
\echo 'Re-running cat-place linking...'
SELECT * FROM trapper.link_cats_to_appointment_places();

-- ============================================================================
-- PHASE 4: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Remaining true mismatches:'
SELECT COUNT(*) as remaining_true_mismatches
FROM trapper.sot_appointments a
JOIN trapper.places p ON p.place_id = a.inferred_place_id
WHERE a.client_address IS NOT NULL
  AND LENGTH(TRIM(a.client_address)) > 10
  AND trapper.normalize_address(a.client_address) != p.normalized_address
  AND a.inferred_place_source NOT IN ('booking_address_fuzzy');

\echo ''
\echo 'Distribution by inferred_place_source:'
SELECT
  inferred_place_source,
  COUNT(*) as appointments
FROM trapper.sot_appointments
WHERE inferred_place_id IS NOT NULL
GROUP BY inferred_place_source
ORDER BY COUNT(*) DESC;

\echo ''
\echo '=============================================================================='
\echo 'MIG_960 Complete!'
\echo '=============================================================================='
\echo ''
