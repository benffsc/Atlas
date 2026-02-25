-- MIG_2496: Address-Type Account Place Extraction
--
-- DATA_GAP_054 Fix: Cats booked under address-like names in ClinicHQ
-- (e.g., "Old Stony Pt Rd", "5403 San Antonio Road") are missing from
-- place-based views because no place is extracted from the address name.
--
-- Problem: V2 ops.upsert_clinic_account_for_owner() creates address-type
-- accounts but doesn't extract/create places from the address-like name.
-- V1 MIG_909 had this logic but it wasn't ported to V2.
--
-- Solution:
--   1. Update ops.upsert_clinic_account_for_owner() to extract places
--   2. Backfill existing address-type accounts with resolved_place_id
--   3. Link appointments to places via clinic_accounts
--   4. Re-run entity linking for cats
--
-- Created: 2026-02-24

\echo ''
\echo '=============================================='
\echo '  MIG_2496: Address-Type Place Extraction'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. BASELINE COUNTS
-- ============================================================================

\echo '0. Baseline counts before fix:'

SELECT
  COUNT(*) as total_address_accounts,
  COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) as with_resolved_place,
  COUNT(*) FILTER (WHERE resolved_place_id IS NULL) as missing_place
FROM ops.clinic_accounts
WHERE account_type = 'address'
  AND merged_into_account_id IS NULL;

-- ============================================================================
-- 1. UPDATE UPSERT FUNCTION TO EXTRACT PLACES FOR ADDRESS-TYPE ACCOUNTS
-- ============================================================================

\echo ''
\echo '1. Updating ops.upsert_clinic_account_for_owner() to extract places...'

CREATE OR REPLACE FUNCTION ops.upsert_clinic_account_for_owner(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_resolved_person_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_account_id UUID;
  v_classification TEXT;
  v_account_type TEXT;
  v_place_id UUID;
  v_display_name TEXT;
BEGIN
  -- Build display name for potential place extraction
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));

  -- Classify the owner name
  v_classification := sot.classify_owner_name(p_first_name, p_last_name);

  -- Map classification to account_type (with NULL safety)
  v_account_type := CASE COALESCE(v_classification, 'unknown')
    WHEN 'address' THEN 'address'
    WHEN 'organization' THEN 'organization'
    WHEN 'known_org' THEN 'organization'
    WHEN 'apartment_complex' THEN 'site_name'
    WHEN 'site_name' THEN 'site_name'
    WHEN 'likely_person' THEN 'resident'
    ELSE 'unknown'
  END;

  -- ATOMIC UPSERT using INSERT ON CONFLICT
  -- Primary dedup key: source_record_id (if available)
  IF p_source_record_id IS NOT NULL THEN
    INSERT INTO ops.clinic_accounts (
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      account_type, resolved_person_id, source_system, source_record_id,
      first_appointment_date, last_appointment_date, appointment_count
    ) VALUES (
      p_first_name, p_last_name, p_email, p_phone, p_address,
      v_account_type, p_resolved_person_id, 'clinichq', p_source_record_id,
      CURRENT_DATE, CURRENT_DATE, 1
    )
    ON CONFLICT (source_system, source_record_id) WHERE source_record_id IS NOT NULL
    DO UPDATE SET
      appointment_count = COALESCE(ops.clinic_accounts.appointment_count, 0) + 1,
      last_seen_at = NOW(),
      last_appointment_date = CURRENT_DATE,
      resolved_person_id = COALESCE(ops.clinic_accounts.resolved_person_id, EXCLUDED.resolved_person_id),
      updated_at = NOW()
    RETURNING account_id INTO v_account_id;
  ELSE
    -- Fallback: dedup by name + contact (case-insensitive)
    INSERT INTO ops.clinic_accounts (
      owner_first_name, owner_last_name, owner_email, owner_phone, owner_address,
      account_type, resolved_person_id, source_system,
      first_appointment_date, last_appointment_date, appointment_count
    ) VALUES (
      p_first_name, p_last_name, p_email, p_phone, p_address,
      v_account_type, p_resolved_person_id, 'clinichq',
      CURRENT_DATE, CURRENT_DATE, 1
    )
    ON CONFLICT DO NOTHING
    RETURNING account_id INTO v_account_id;

    -- If INSERT failed due to conflict, find existing
    IF v_account_id IS NULL THEN
      SELECT account_id INTO v_account_id
      FROM ops.clinic_accounts
      WHERE LOWER(owner_first_name) = LOWER(p_first_name)
        AND LOWER(COALESCE(owner_last_name, '')) = LOWER(COALESCE(p_last_name, ''))
        AND (
          (p_email IS NOT NULL AND LOWER(owner_email) = LOWER(p_email))
          OR (p_phone IS NOT NULL AND owner_phone = p_phone)
          OR (p_email IS NULL AND p_phone IS NULL AND owner_email IS NULL AND owner_phone IS NULL)
        )
        AND merged_into_account_id IS NULL
      LIMIT 1;

      IF v_account_id IS NOT NULL THEN
        UPDATE ops.clinic_accounts
        SET appointment_count = COALESCE(appointment_count, 0) + 1,
            last_seen_at = NOW(),
            last_appointment_date = CURRENT_DATE,
            resolved_person_id = COALESCE(resolved_person_id, p_resolved_person_id),
            updated_at = NOW()
        WHERE account_id = v_account_id;
      END IF;
    END IF;
  END IF;

  -- =========================================================================
  -- DATA_GAP_054 FIX: Extract place for address-type accounts
  -- This was in V1 MIG_909 but missing from V2
  -- =========================================================================
  IF v_account_id IS NOT NULL AND v_account_type = 'address' THEN
    -- Check if account already has a resolved_place_id
    IF NOT EXISTS (
      SELECT 1 FROM ops.clinic_accounts
      WHERE account_id = v_account_id AND resolved_place_id IS NOT NULL
    ) THEN
      -- Try to find or create a place from the address-like name
      -- First try: Use the owner_address if it's more complete
      IF p_address IS NOT NULL AND LENGTH(TRIM(p_address)) > 10 THEN
        v_place_id := sot.find_or_create_place_deduped(
          p_formatted_address := TRIM(p_address),
          p_source_system := 'clinichq'
        );
      END IF;

      -- Fallback: Use the display_name (address-as-name)
      IF v_place_id IS NULL AND LENGTH(v_display_name) > 5 THEN
        v_place_id := sot.find_or_create_place_deduped(
          p_formatted_address := v_display_name,
          p_source_system := 'clinichq'
        );
      END IF;

      -- Link account to place
      IF v_place_id IS NOT NULL THEN
        UPDATE ops.clinic_accounts
        SET resolved_place_id = v_place_id,
            updated_at = NOW()
        WHERE account_id = v_account_id;
      END IF;
    END IF;
  END IF;

  RETURN v_account_id;
END;
$$;

COMMENT ON FUNCTION ops.upsert_clinic_account_for_owner IS
'Creates or updates a clinic_account for ANY ClinicHQ owner.

DATA_GAP_053 Fix: Tracks ALL owners (not just pseudo-profiles).
DATA_GAP_054 Fix: Extracts places for address-type accounts.

For address-type accounts (e.g., "Old Stony Pt Rd", "5403 San Antonio Road"):
- Creates/finds a place from the address-like name
- Sets resolved_place_id so cats can be linked to the location

Returns account_id for linking to appointment.owner_account_id.';

\echo '   Updated ops.upsert_clinic_account_for_owner()'

-- ============================================================================
-- 2. BACKFILL: EXTRACT PLACES FOR EXISTING ADDRESS-TYPE ACCOUNTS
-- ============================================================================

\echo ''
\echo '2. Backfilling places for existing address-type accounts...'

WITH address_accounts AS (
  SELECT
    ca.account_id,
    ca.display_name,
    ca.owner_address
  FROM ops.clinic_accounts ca
  WHERE ca.account_type = 'address'
    AND ca.resolved_place_id IS NULL
    AND ca.merged_into_account_id IS NULL
    -- Only process accounts with reasonable display names
    AND LENGTH(TRIM(ca.display_name)) > 5
),
place_extraction AS (
  SELECT
    aa.account_id,
    -- Try owner_address first, fallback to display_name
    COALESCE(
      CASE WHEN aa.owner_address IS NOT NULL AND LENGTH(TRIM(aa.owner_address)) > 10
           THEN sot.find_or_create_place_deduped(TRIM(aa.owner_address), 'clinichq')
      END,
      sot.find_or_create_place_deduped(aa.display_name, 'clinichq')
    ) as place_id
  FROM address_accounts aa
),
updated AS (
  UPDATE ops.clinic_accounts ca
  SET resolved_place_id = pe.place_id,
      updated_at = NOW()
  FROM place_extraction pe
  WHERE ca.account_id = pe.account_id
    AND pe.place_id IS NOT NULL
  RETURNING ca.account_id
)
SELECT COUNT(*) as accounts_updated FROM updated;

-- ============================================================================
-- 3. LINK APPOINTMENTS TO PLACES VIA CLINIC_ACCOUNTS
-- ============================================================================

\echo ''
\echo '3. Linking appointments to places via clinic_accounts.resolved_place_id...'

WITH appointment_place_links AS (
  UPDATE ops.appointments a
  SET inferred_place_id = ca.resolved_place_id,
      resolution_status = 'linked_via_account'
  FROM ops.clinic_accounts ca
  WHERE a.owner_account_id = ca.account_id
    AND a.inferred_place_id IS NULL
    AND ca.resolved_place_id IS NOT NULL
    AND ca.account_type = 'address'
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_linked FROM appointment_place_links;

-- ============================================================================
-- 4. RE-RUN CAT-PLACE LINKING FOR NEWLY LINKED APPOINTMENTS
-- ============================================================================

\echo ''
\echo '4. Running cat-place linking for affected appointments...'

SELECT * FROM sot.link_cats_to_appointment_places();

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '5a. Address-type accounts after fix:'
SELECT
  COUNT(*) as total_address_accounts,
  COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) as with_resolved_place,
  COUNT(*) FILTER (WHERE resolved_place_id IS NULL) as still_missing_place
FROM ops.clinic_accounts
WHERE account_type = 'address'
  AND merged_into_account_id IS NULL;

\echo ''
\echo '5b. Sample address-type accounts with places:'
SELECT
  ca.display_name as account_name,
  p.display_name as place_name,
  p.formatted_address,
  ca.appointment_count
FROM ops.clinic_accounts ca
LEFT JOIN sot.places p ON p.place_id = ca.resolved_place_id
WHERE ca.account_type = 'address'
  AND ca.merged_into_account_id IS NULL
  AND ca.resolved_place_id IS NOT NULL
ORDER BY ca.appointment_count DESC
LIMIT 10;

\echo ''
\echo '5c. Checking for "Old Stony Pt Rd" specifically:'
SELECT
  ca.display_name as account_name,
  ca.account_type,
  ca.resolved_place_id,
  p.display_name as place_name,
  p.formatted_address,
  ca.appointment_count,
  ca.cat_count
FROM ops.clinic_accounts ca
LEFT JOIN sot.places p ON p.place_id = ca.resolved_place_id
WHERE ca.display_name ILIKE '%stony%' OR ca.display_name ILIKE '%old stony%'
ORDER BY ca.appointment_count DESC;

\echo ''
\echo '5d. Cats now linked to places from address-type accounts:'
SELECT
  COUNT(DISTINCT cp.cat_id) as cats_linked,
  COUNT(*) as total_links
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE EXISTS (
  SELECT 1 FROM ops.clinic_accounts ca
  WHERE ca.resolved_place_id = p.place_id
    AND ca.account_type = 'address'
);

-- ============================================================================
-- 6. SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2496 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'DATA_GAP_054 Fix Applied:'
\echo ''
\echo '1. Updated ops.upsert_clinic_account_for_owner():'
\echo '   - Now extracts places for address-type accounts'
\echo '   - Sets resolved_place_id on clinic_accounts'
\echo ''
\echo '2. Backfilled existing address-type accounts:'
\echo '   - Extracted places from display_name/owner_address'
\echo '   - Linked accounts to places'
\echo ''
\echo '3. Linked appointments to places:'
\echo '   - Set inferred_place_id via clinic_accounts.resolved_place_id'
\echo ''
\echo '4. Re-ran entity linking:'
\echo '   - Cats should now appear in place-based views'
\echo ''
\echo 'Examples of address-type accounts:'
\echo '   - "Old Stony Pt Rd" (colony site)'
\echo '   - "5403 San Antonio Road" (trapping site)'
\echo '   - Any address used as owner name in ClinicHQ'
\echo ''
