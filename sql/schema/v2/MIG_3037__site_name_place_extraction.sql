-- MIG_3037: Colony Site Detection — Site-Name Account Place Extraction
--
-- DATA_GAP_058 Root Cause Fix
--
-- Industry research (2026-04-01):
--   - Dynamics 365 Field Service: "Functional Locations" are first-class entities
--     separate from Accounts — the WHERE is distinct from the WHO
--   - ShelterLuv Field Services: Colony = Case (long-lived entity with location + roles)
--   - RescueGroups: Location > Colony > Animals hierarchy
--   - Cat Stats: Colony IS the primary entity, not cats or people
--   - NONE of these systems treat colony sites as "person creation failures"
--
-- Atlas's gap: When classify_owner_name() returns 'site_name', the system's
-- response is to NOT create a person — but it doesn't create the right
-- PLACE entity either. Colony sites should be first-class managed locations.
--
-- Problem: MIG_2496 (DATA_GAP_054) added place extraction for address-type
-- ClinicHQ accounts, but ONLY for account_type = 'address'. Site-name accounts
-- (like "Old Possum Brewing FFSC", "Silveira Ranch") also have valid addresses
-- in their owner_address field but never get places extracted.
--
-- Failure chain for site_name accounts:
--   1. classify_owner_name() → 'site_name' (e.g., contains FFSC, Ranch, Farm)
--   2. account_type = 'site_name', resolved_person_id = NULL
--   3. Place extraction guarded by: IF v_account_type = 'address' → SKIPS site_name
--   4. resolved_place_id stays NULL → inferred_place_id on appointments = NULL
--   5. link_cats_to_appointment_places() requires inferred_place_id → CATS SKIPPED
--   6. link_cats_to_places() requires person chain → no person exists → CATS SKIPPED
--   7. Cats exist but are invisible on map
--
-- Fix (3 layers):
--   Layer 1: Plumbing — extend place extraction to site_name accounts
--   Layer 2: Semantics — add is_colony_site flag to places, auto-set from site_name accounts
--   Layer 3: Linking — ensure cat-place linking works for colony sites
--
-- Created: 2026-04-01

\echo ''
\echo '=============================================='
\echo '  MIG_3037: Colony Site Detection'
\echo '=============================================='
\echo ''

-- ============================================================================
-- LAYER 2: Add is_colony_site to sot.places
-- (Must come before Layer 1 so backfill can set the flag)
-- ============================================================================

\echo 'Layer 2: Adding is_colony_site column to sot.places...'

ALTER TABLE sot.places ADD COLUMN IF NOT EXISTS is_colony_site BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN sot.places.is_colony_site IS
'TRUE = this place is a known colony feeding/trapping site managed by FFSC.
Auto-set when place is created from a site_name clinic account.
Enables cat-place linking regardless of place_kind (MIG_3037).
Industry pattern: Dynamics 365 Functional Location / ShelterLuv Case.';

-- Index for colony site queries (Beacon map filtering)
CREATE INDEX IF NOT EXISTS idx_places_colony_site
ON sot.places (is_colony_site) WHERE is_colony_site = TRUE AND merged_into_place_id IS NULL;

-- ============================================================================
-- 0. BASELINE: How many site_name accounts are missing places?
-- ============================================================================

\echo '0. Baseline — site_name accounts missing resolved_place_id:'

SELECT
  account_type,
  COUNT(*) as total_accounts,
  COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) as with_place,
  COUNT(*) FILTER (WHERE resolved_place_id IS NULL) as missing_place,
  COUNT(*) FILTER (WHERE resolved_place_id IS NULL AND owner_address IS NOT NULL
                   AND LENGTH(TRIM(owner_address)) > 10) as fixable_with_address
FROM ops.clinic_accounts
WHERE account_type IN ('site_name', 'organization', 'address')
  AND merged_into_account_id IS NULL
GROUP BY account_type
ORDER BY account_type;

\echo ''
\echo 'Sample site_name accounts without places:'
SELECT display_name, owner_address, owner_email, appointment_count,
       resolved_place_id, resolved_person_id
FROM ops.clinic_accounts
WHERE account_type = 'site_name'
  AND merged_into_account_id IS NULL
  AND resolved_place_id IS NULL
ORDER BY appointment_count DESC
LIMIT 20;

-- ============================================================================
-- 1. FIX: Update upsert_clinic_account_for_owner()
--    Extend place extraction from 'address' to 'address' + 'site_name'
-- ============================================================================

\echo ''
\echo '1. Updating upsert_clinic_account_for_owner() — adding site_name place extraction...'

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
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));

  v_classification := sot.classify_owner_name(p_first_name, p_last_name);

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
  -- MIG_3037 FIX: Extract places for BOTH address AND site_name accounts
  -- (was: only 'address' — DATA_GAP_054 / MIG_2496)
  -- site_name accounts (FFSC trapping sites, ranches, farms) have valid
  -- owner_address fields that should become places on the map.
  -- =========================================================================
  IF v_account_id IS NOT NULL AND v_account_type IN ('address', 'site_name') THEN
    -- Check if account already has a resolved_place_id
    IF NOT EXISTS (
      SELECT 1 FROM ops.clinic_accounts
      WHERE account_id = v_account_id AND resolved_place_id IS NOT NULL
    ) THEN
      -- Try owner_address first (more complete than display_name)
      IF p_address IS NOT NULL AND LENGTH(TRIM(p_address)) > 10 THEN
        v_place_id := sot.find_or_create_place_deduped(
          p_formatted_address := TRIM(p_address),
          p_source_system := 'clinichq'
        );
      END IF;

      -- Fallback: Use the display_name (address-as-name) — only for address type
      IF v_place_id IS NULL AND v_account_type = 'address' AND LENGTH(v_display_name) > 5 THEN
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

        -- Layer 2: Mark as colony site if from site_name account
        -- Industry pattern: colony sites are first-class managed locations
        IF v_account_type = 'site_name' THEN
          UPDATE sot.places
          SET is_colony_site = TRUE
          WHERE place_id = v_place_id
            AND NOT is_colony_site;  -- Don't re-update
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_account_id;
END;
$$;

COMMENT ON FUNCTION ops.upsert_clinic_account_for_owner IS
'Creates or updates a clinic_account for ANY ClinicHQ owner.

DATA_GAP_053: Tracks ALL owners (not just pseudo-profiles).
DATA_GAP_054: Extracts places for address-type accounts.
DATA_GAP_058 (MIG_3037): Also extracts places for site_name accounts.

For address/site_name accounts with valid owner_address:
- Creates/finds a place from the address
- Sets resolved_place_id so appointments get inferred_place_id
- Enables cat-place linking via link_cats_to_appointment_places()';

-- ============================================================================
-- 2. BACKFILL: Extract places for existing site_name accounts
-- ============================================================================

\echo ''
\echo '2. Backfilling places for existing site_name accounts...'

DO $$
DECLARE
  v_account RECORD;
  v_place_id UUID;
  v_updated INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_account IN
    SELECT account_id, display_name, owner_address
    FROM ops.clinic_accounts
    WHERE account_type = 'site_name'
      AND resolved_place_id IS NULL
      AND merged_into_account_id IS NULL
      AND owner_address IS NOT NULL
      AND LENGTH(TRIM(owner_address)) > 10
  LOOP
    BEGIN
      v_place_id := sot.find_or_create_place_deduped(
        p_formatted_address := TRIM(v_account.owner_address),
        p_source_system := 'clinichq'
      );

      IF v_place_id IS NOT NULL THEN
        UPDATE ops.clinic_accounts
        SET resolved_place_id = v_place_id, updated_at = NOW()
        WHERE account_id = v_account.account_id;

        -- Layer 2: Mark as colony site
        UPDATE sot.places SET is_colony_site = TRUE
        WHERE place_id = v_place_id AND NOT is_colony_site;

        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error processing site_name account %: %', v_account.display_name, SQLERRM;
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Backfilled % site_name accounts with places (% skipped)', v_updated, v_skipped;
END $$;

-- Also mark existing places that are already linked to site_name accounts
\echo ''
\echo '2b. Marking existing site_name-linked places as colony sites...'

UPDATE sot.places pl
SET is_colony_site = TRUE
FROM ops.clinic_accounts ca
WHERE ca.resolved_place_id = pl.place_id
  AND ca.account_type = 'site_name'
  AND ca.merged_into_account_id IS NULL
  AND pl.merged_into_place_id IS NULL
  AND NOT pl.is_colony_site;

-- ============================================================================
-- 3. BACKFILL: Link appointments to places via site_name accounts
--    (MIG_2496 Step 3 only did this for account_type = 'address')
-- ============================================================================

\echo ''
\echo '3. Linking appointments to places via site_name clinic_accounts...'

WITH appointment_place_links AS (
  UPDATE ops.appointments a
  SET inferred_place_id = ca.resolved_place_id,
      inferred_place_source = 'clinic_account_site_name'
  FROM ops.clinic_accounts ca
  WHERE a.owner_account_id = ca.account_id
    AND a.inferred_place_id IS NULL
    AND ca.resolved_place_id IS NOT NULL
    AND ca.account_type IN ('site_name', 'address')  -- MIG_3037: include site_name
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_linked FROM appointment_place_links;

-- ============================================================================
-- 4. RE-RUN CAT-PLACE LINKING
-- ============================================================================

\echo ''
\echo '4. Running cat-place linking for newly linked appointments...'

SELECT * FROM sot.link_cats_to_appointment_places();

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '5a. Account types — place coverage AFTER fix:'
SELECT
  account_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) as with_place,
  COUNT(*) FILTER (WHERE resolved_place_id IS NULL) as missing_place
FROM ops.clinic_accounts
WHERE account_type IN ('site_name', 'organization', 'address')
  AND merged_into_account_id IS NULL
GROUP BY account_type
ORDER BY account_type;

\echo ''
\echo '5b. Old Possum Brewing specifically:'
SELECT
  ca.display_name, ca.account_type, ca.owner_address,
  ca.resolved_place_id,
  pl.formatted_address as place_address, pl.place_kind,
  pl.latitude, pl.longitude
FROM ops.clinic_accounts ca
LEFT JOIN sot.places pl ON pl.place_id = ca.resolved_place_id
WHERE ca.display_name ILIKE '%possum%'
  AND ca.merged_into_account_id IS NULL;

\echo ''
\echo '5c. Cats now linked via site_name appointments:'
SELECT
  ca.display_name as site_name,
  COUNT(DISTINCT cp.cat_id) as cats_at_site,
  pl.formatted_address
FROM ops.clinic_accounts ca
JOIN sot.places pl ON pl.place_id = ca.resolved_place_id
JOIN sot.cat_place cp ON cp.place_id = pl.place_id
WHERE ca.account_type = 'site_name'
  AND ca.merged_into_account_id IS NULL
GROUP BY ca.display_name, pl.formatted_address
ORDER BY cats_at_site DESC;

\echo ''
\echo '5d. Previously skipped cats that should now be linked:'
SELECT COUNT(*) as previously_skipped_cats
FROM ops.entity_linking_skipped
WHERE entity_type = 'cat'
  AND reason = 'no_inferred_place_id'
  AND entity_id IN (
    SELECT DISTINCT a.cat_id
    FROM ops.appointments a
    JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
    WHERE ca.account_type = 'site_name'
      AND a.cat_id IS NOT NULL
  );

\echo ''
\echo '5e. Colony sites (is_colony_site = TRUE):'
SELECT COUNT(*) as total_colony_sites
FROM sot.places
WHERE is_colony_site = TRUE AND merged_into_place_id IS NULL;

\echo ''
\echo 'Colony site details:'
SELECT pl.place_id, pl.display_name, pl.formatted_address, pl.place_kind,
       pl.latitude IS NOT NULL as geocoded,
       (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = pl.place_id) as cat_count,
       ca.display_name as clinic_account_name
FROM sot.places pl
LEFT JOIN ops.clinic_accounts ca ON ca.resolved_place_id = pl.place_id
  AND ca.account_type = 'site_name' AND ca.merged_into_account_id IS NULL
WHERE pl.is_colony_site = TRUE AND pl.merged_into_place_id IS NULL
ORDER BY cat_count DESC
LIMIT 20;

\echo ''
\echo '=============================================='
\echo '  MIG_3037 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'LAYER 1 — Plumbing:'
\echo '  upsert_clinic_account_for_owner() now extracts places for'
\echo '  BOTH address AND site_name account types.'
\echo '  Backfilled existing site_name accounts → resolved_place_id.'
\echo '  Linked appointments → inferred_place_id.'
\echo ''
\echo 'LAYER 2 — Semantics:'
\echo '  Added is_colony_site BOOLEAN to sot.places.'
\echo '  Auto-set TRUE for places created from site_name clinic accounts.'
\echo '  Industry pattern: Dynamics 365 Functional Location / ShelterLuv Case.'
\echo ''
\echo 'LAYER 3 — Linking:'
\echo '  link_cats_to_appointment_places() already works for colony sites'
\echo '  (no place_kind filter). Step 2 is the PRIMARY path.'
\echo '  link_cats_to_places() (Step 3) business/outdoor_site filter is'
\echo '  correct for residential-only fallback and NOT changed here.'
\echo ''
\echo 'FUTURE: Admin UI to manually designate places as colony sites.'
\echo '  Modify link_cats_to_places() Step 3 to include is_colony_site.'
\echo '  Colony site dashboard for Beacon.'
\echo ''
