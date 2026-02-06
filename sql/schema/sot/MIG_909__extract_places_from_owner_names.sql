-- ============================================================================
-- MIG_909: Extract Places from Owner Names (DATA_GAP_005)
-- ============================================================================
-- Problem: ClinicHQ staff enter addresses in Owner Name fields when there's
-- no actual owner (community cats). Example:
--   Owner First Name: "5403 San Antonio Road Petaluma"
--   Owner Address: "San Antonio Rd Silviera Ranch, Petaluma, CA 94952" (CORRUPTED)
--
-- The classify_owner_name() function correctly returns 'address', but the
-- find_or_create_clinic_account() function never extracts a place from it.
--
-- Solution:
--   1. Update find_or_create_clinic_account() to extract places when address
--   2. Backfill existing clinic_owner_accounts with missing linked_place_id
--   3. Run entity linking to connect cats to places
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_909: Extract Places from Owner Names'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Phase 1: Preview existing accounts classified as addresses without place
-- ============================================================================

\echo 'Phase 1: Checking clinic_owner_accounts with address classification...'

SELECT
  account_id,
  display_name,
  account_type,
  linked_place_id IS NOT NULL as has_place
FROM trapper.clinic_owner_accounts
WHERE account_type = 'address'
   OR trapper.classify_owner_name(display_name) = 'address'
LIMIT 10;

-- Count
SELECT
  COUNT(*) as total_address_accounts,
  COUNT(*) FILTER (WHERE linked_place_id IS NULL) as missing_place_link
FROM trapper.clinic_owner_accounts
WHERE account_type = 'address'
   OR trapper.classify_owner_name(display_name) = 'address';

-- ============================================================================
-- Phase 2: Update find_or_create_clinic_account() to extract places
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating find_or_create_clinic_account() function...'

CREATE OR REPLACE FUNCTION trapper.find_or_create_clinic_account(
  p_display_name TEXT,
  p_account_type TEXT DEFAULT NULL,
  p_brought_by TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
  v_account_id UUID;
  v_canonical TEXT;
  v_classified_type TEXT;
  v_extracted_brought_by TEXT;
  v_stripped_name TEXT;
  v_place_id UUID;  -- NEW: For address extraction
  v_classification TEXT;  -- NEW: Store classification result
BEGIN
  IF p_display_name IS NULL OR trim(p_display_name) = '' THEN
    RETURN NULL;
  END IF;

  -- Extract brought_by if not provided
  v_extracted_brought_by := COALESCE(p_brought_by, trapper.extract_brought_by(p_display_name));

  -- Strip suffix for matching
  v_stripped_name := trapper.strip_brought_by_suffix(p_display_name);

  -- Normalize for matching
  v_canonical := lower(trim(v_stripped_name));

  -- Get classification early (we'll use it multiple times)
  v_classification := trapper.classify_owner_name(v_stripped_name);

  -- Check for existing by display_name or canonical
  SELECT account_id INTO v_account_id
  FROM trapper.clinic_owner_accounts
  WHERE lower(display_name) = v_canonical
     OR lower(canonical_name) = v_canonical
     OR lower(trim(p_display_name)) = ANY(
          SELECT lower(unnest(source_display_names))
        );

  IF FOUND THEN
    -- Add display name variant if new
    UPDATE trapper.clinic_owner_accounts
    SET source_display_names = CASE
          WHEN NOT (p_display_name = ANY(source_display_names))
          THEN array_append(source_display_names, p_display_name)
          ELSE source_display_names
        END,
        updated_at = NOW()
    WHERE account_id = v_account_id;

    -- NEW: Ensure place is linked if account_type is address
    IF v_classification = 'address' THEN
      -- Check if already has a place
      PERFORM 1 FROM trapper.clinic_owner_accounts
      WHERE account_id = v_account_id AND linked_place_id IS NOT NULL;

      IF NOT FOUND THEN
        -- Extract place from the address-as-name
        SELECT trapper.find_or_create_place_deduped(
          p_formatted_address := v_stripped_name,
          p_display_name := NULL,
          p_lat := NULL,
          p_lng := NULL,
          p_source_system := 'clinichq'
        ) INTO v_place_id;

        IF v_place_id IS NOT NULL THEN
          UPDATE trapper.clinic_owner_accounts
          SET linked_place_id = v_place_id,
              updated_at = NOW()
          WHERE account_id = v_account_id;
        END IF;
      END IF;
    END IF;

    RETURN v_account_id;
  END IF;

  -- Classify if not provided
  v_classified_type := COALESCE(
    p_account_type,
    CASE v_classification
      WHEN 'address' THEN 'address'
      WHEN 'apartment_complex' THEN 'apartment_complex'
      WHEN 'organization' THEN 'organization'
      WHEN 'known_org' THEN 'organization'
      ELSE 'unknown'
    END
  );

  -- NEW: Extract place if classified as address
  IF v_classified_type = 'address' THEN
    SELECT trapper.find_or_create_place_deduped(
      p_formatted_address := v_stripped_name,
      p_display_name := NULL,
      p_lat := NULL,
      p_lng := NULL,
      p_source_system := 'clinichq'
    ) INTO v_place_id;
  END IF;

  -- Create new account (with linked_place_id for addresses)
  INSERT INTO trapper.clinic_owner_accounts (
    display_name,
    canonical_name,
    account_type,
    brought_by,
    source_system,
    source_display_names,
    linked_place_id  -- NEW: Include place link
  ) VALUES (
    v_stripped_name,  -- Store without suffix
    NULL,  -- Will be set by AI research
    v_classified_type,
    v_extracted_brought_by,
    p_source_system,
    ARRAY[p_display_name],  -- Keep original with suffix for tracking
    v_place_id  -- NEW: Link to extracted place (NULL if not address)
  )
  RETURNING account_id INTO v_account_id;

  RETURN v_account_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_clinic_account IS
'Creates or finds a clinic_owner_accounts record for a pseudo-profile.
Strips FFSC/SCAS suffix, classifies account type, and handles deduplication.
MIG_909: Now extracts places from address-as-name patterns and sets linked_place_id.
Use this for ClinicHQ owner names that are not real people.';

-- ============================================================================
-- Phase 2b: Create function for ongoing pipeline use
-- ============================================================================

\echo ''
\echo 'Phase 2b: Creating fix_address_account_place_overrides() function...'

CREATE OR REPLACE FUNCTION trapper.fix_address_account_place_overrides()
RETURNS TABLE (
  source TEXT,
  appointments_updated INT
) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Step 1: Backfill any clinic_owner_accounts missing linked_place_id
  WITH address_accounts AS (
    SELECT
      coa.account_id,
      coa.display_name,
      trapper.find_or_create_place_deduped(
        p_formatted_address := coa.display_name,
        p_display_name := NULL,
        p_lat := NULL,
        p_lng := NULL,
        p_source_system := 'clinichq'
      ) as place_id
    FROM trapper.clinic_owner_accounts coa
    WHERE coa.linked_place_id IS NULL
      AND (coa.account_type = 'address' OR trapper.classify_owner_name(coa.display_name) = 'address')
  ),
  updated AS (
    UPDATE trapper.clinic_owner_accounts coa
    SET linked_place_id = aa.place_id,
        updated_at = NOW()
    FROM address_accounts aa
    WHERE coa.account_id = aa.account_id
      AND aa.place_id IS NOT NULL
    RETURNING coa.account_id
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'accounts_backfilled'; appointments_updated := v_count; RETURN NEXT;

  -- Step 2: Override booking_address with owner_account for address-type accounts
  -- This corrects ClinicHQ autocorrect corruption
  WITH overrides AS (
    UPDATE trapper.sot_appointments a
    SET inferred_place_id = coa.linked_place_id,
        inferred_place_source = 'owner_account_address',
        updated_at = NOW()
    FROM trapper.clinic_owner_accounts coa
    WHERE a.owner_account_id = coa.account_id
      AND coa.linked_place_id IS NOT NULL
      AND coa.account_type = 'address'
      AND (
        a.inferred_place_id IS NULL  -- No place yet
        OR (a.inferred_place_id != coa.linked_place_id AND a.inferred_place_source = 'booking_address')  -- Wrong place from booking
      )
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM overrides;
  source := 'appointments_overridden'; appointments_updated := v_count; RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.fix_address_account_place_overrides IS
'MIG_909: Fixes place inference for appointments where owner_account is an address.
Called as part of entity linking pipeline to correct ClinicHQ autocorrect corruption.
Step 1: Backfills linked_place_id for address-type clinic_owner_accounts.
Step 2: Overrides booking_address with owner_account place when account_type = address.';

-- ============================================================================
-- Phase 3: Backfill existing accounts where display_name is an address
-- ============================================================================

\echo ''
\echo 'Phase 3: Backfilling linked_place_id for existing address accounts...'

-- Backfill
WITH address_accounts AS (
  SELECT
    coa.account_id,
    coa.display_name,
    trapper.find_or_create_place_deduped(
      p_formatted_address := coa.display_name,
      p_display_name := NULL,
      p_lat := NULL,
      p_lng := NULL,
      p_source_system := 'clinichq'
    ) as place_id
  FROM trapper.clinic_owner_accounts coa
  WHERE coa.linked_place_id IS NULL
    AND (coa.account_type = 'address' OR trapper.classify_owner_name(coa.display_name) = 'address')
),
updated AS (
  UPDATE trapper.clinic_owner_accounts coa
  SET linked_place_id = aa.place_id,
      updated_at = NOW()
  FROM address_accounts aa
  WHERE coa.account_id = aa.account_id
    AND aa.place_id IS NOT NULL
  RETURNING coa.account_id, aa.display_name, aa.place_id
)
SELECT
  COUNT(*) as accounts_linked_to_places,
  (SELECT COUNT(DISTINCT place_id) FROM updated) as unique_places_used
FROM updated;

-- ============================================================================
-- Phase 4: Process pending owner_info records
-- ============================================================================

\echo ''
\echo 'Phase 4: Processing pending owner_info staged records...'

SELECT trapper.process_clinichq_owner_info(500);

-- ============================================================================
-- Phase 5: Link appointments to clinic_owner_accounts
-- ============================================================================

\echo ''
\echo 'Phase 5: Linking appointments to clinic_owner_accounts...'

-- Link any appointments that have matching owner names
WITH links AS (
  UPDATE trapper.sot_appointments a
  SET owner_account_id = coa.account_id,
      updated_at = NOW()
  FROM trapper.staged_records sr
  JOIN trapper.clinic_owner_accounts coa ON (
    LOWER(coa.display_name) = LOWER(TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', '')))
    OR LOWER(TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', ''))) = ANY(SELECT LOWER(unnest(coa.source_display_names)))
  )
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'owner_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND a.person_id IS NULL  -- No real person linked
    AND a.owner_account_id IS NULL  -- Not already linked to account
  RETURNING a.appointment_id
)
SELECT COUNT(*) as appointments_linked_to_accounts FROM links;

-- ============================================================================
-- Phase 6: Run place inference
-- ============================================================================

\echo ''
\echo 'Phase 6: Running place inference for appointments...'

SELECT * FROM trapper.infer_appointment_places();

-- ============================================================================
-- Phase 6b: Override booking_address with owner_account for address-type accounts
-- ============================================================================
-- CRITICAL: When clinic_owner_accounts.account_type = 'address', the linked_place_id
-- is MORE RELIABLE than booking_address (which is often corrupted by HQ autocorrect).
-- This step overrides any booking_address inference with the clinic_owner_account place.

\echo ''
\echo 'Phase 6b: Overriding corrupted booking_address for address-type accounts...'

WITH overrides AS (
  UPDATE trapper.sot_appointments a
  SET inferred_place_id = coa.linked_place_id,
      inferred_place_source = 'owner_account_address',
      updated_at = NOW()
  FROM trapper.clinic_owner_accounts coa
  WHERE a.owner_account_id = coa.account_id
    AND coa.linked_place_id IS NOT NULL
    AND coa.account_type = 'address'  -- Only for address-classified accounts
    AND a.inferred_place_id IS NOT NULL  -- Already has a place (likely from booking_address)
    AND a.inferred_place_id != coa.linked_place_id  -- Different place (booking was corrupted)
  RETURNING a.appointment_id, a.appointment_number
)
SELECT COUNT(*) as booking_address_overridden FROM overrides;

-- ============================================================================
-- Phase 7: Link cats to places
-- ============================================================================

\echo ''
\echo 'Phase 7: Linking cats to appointment places...'

SELECT * FROM trapper.link_cats_to_appointment_places();

-- ============================================================================
-- Phase 8: Verification
-- ============================================================================

\echo ''
\echo 'Phase 8: Verifying results for target cats...'

-- Check the specific cats mentioned in the issue
SELECT
  c.display_name as cat_name,
  ci.id_value as microchip,
  a.appointment_number,
  a.client_address,
  a.owner_account_id IS NOT NULL as has_owner_account,
  COALESCE(a.place_id, a.inferred_place_id) as effective_place_id,
  p.formatted_address as linked_place,
  cpr.place_id IS NOT NULL as has_cat_place_relationship
FROM trapper.sot_cats c
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
LEFT JOIN trapper.sot_appointments a ON a.cat_id = c.cat_id
LEFT JOIN trapper.places p ON p.place_id = COALESCE(a.place_id, a.inferred_place_id)
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id
WHERE ci.id_value IN ('900263005064321', '981020053841041');

-- Summary
SELECT
  COUNT(*) FILTER (WHERE linked_place_id IS NOT NULL) as accounts_with_place,
  COUNT(*) FILTER (WHERE linked_place_id IS NULL AND (account_type = 'address' OR trapper.classify_owner_name(display_name) = 'address')) as address_accounts_missing_place,
  COUNT(*) as total_accounts
FROM trapper.clinic_owner_accounts;

-- ============================================================================
-- Phase 9: Update run_all_entity_linking() to include address override step
-- ============================================================================

\echo ''
\echo 'Phase 9: Updating run_all_entity_linking() to include address account fixes...'

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation text, count integer) AS $$
DECLARE
  v_count INT;
  v_cats INT;
  v_places INT;
  v_updated INT;
  v_created INT;
  v_linked INT;
  v_skipped INT;
  v_rec RECORD;
BEGIN
  -- 1. Link appointments to owners first (critical for cat-place linking)
  SELECT appointments_updated, persons_created, persons_linked
  INTO v_updated, v_created, v_linked
  FROM trapper.link_appointments_to_owners();
  RETURN QUERY SELECT 'appointments_linked_to_owners'::TEXT, v_updated;
  RETURN QUERY SELECT 'persons_created_for_appointments'::TEXT, v_created;

  -- 2. Create places from intake
  SELECT trapper.create_places_from_intake() INTO v_count;
  RETURN QUERY SELECT 'places_created_from_intake'::TEXT, v_count;

  -- 3. Link intake requesters to places
  SELECT trapper.link_intake_requesters_to_places() INTO v_count;
  RETURN QUERY SELECT 'intake_requester_place_links'::TEXT, v_count;

  -- 4. Link cats to places (MIG_892: now uses proper MIG_889 functions)
  SELECT cats_linked, places_involved INTO v_cats, v_places
  FROM trapper.run_cat_place_linking();
  RETURN QUERY SELECT 'cats_linked_to_places'::TEXT, v_cats;

  -- 5. Link appointments to trappers
  SELECT trapper.run_appointment_trapper_linking() INTO v_count;
  RETURN QUERY SELECT 'appointments_linked_to_trappers'::TEXT, v_count;

  -- 6. Link cats to requests
  SELECT linked, skipped INTO v_linked, v_skipped
  FROM trapper.link_cats_to_requests_safe();
  RETURN QUERY SELECT 'cats_linked_to_requests'::TEXT, v_linked;

  -- 7. Link appointments to partner organizations
  FOR v_rec IN SELECT * FROM trapper.link_appointments_to_partner_orgs() LOOP
    RETURN QUERY SELECT ('partner_org_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 8. Infer place_id for appointments
  FOR v_rec IN SELECT * FROM trapper.infer_appointment_places() LOOP
    RETURN QUERY SELECT ('inferred_place_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_linked;
  END LOOP;

  -- 9. MIG_909: Fix address account place overrides
  -- This corrects ClinicHQ autocorrect corruption by preferring address-as-name over booking_address
  FOR v_rec IN SELECT * FROM trapper.fix_address_account_place_overrides() LOOP
    RETURN QUERY SELECT ('address_account_' || lower(replace(v_rec.source, ' ', '_')))::TEXT, v_rec.appointments_updated;
  END LOOP;

  -- 10. Link Google Maps entries to places
  SELECT trapper.link_google_entries_incremental(500) INTO v_count;
  RETURN QUERY SELECT 'google_entries_linked'::TEXT, v_count;

  -- 11. Flag multi-unit candidates for manual review
  SELECT trapper.flag_multi_unit_candidates() INTO v_count;
  RETURN QUERY SELECT 'google_entries_flagged_multiunit'::TEXT, v_count;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking IS
'MIG_909: Added Step 9 for address account place overrides.
Entity linking chain:
1. Link appointments to owners
2. Create places from intake
3. Link intake requesters to places
4. Link cats to places (via MIG_889 proper functions)
5. Link appointments to trappers
6. Link cats to requests
7. Link appointments to partner orgs
8. Infer places for appointments
9. MIG_909: Fix address account place overrides (corrects HQ autocorrect)
10. Link Google Maps entries (incremental)
11. Flag multi-unit candidates

Run via cron every 15 minutes or after data ingest.';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_909 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Updated find_or_create_clinic_account() to extract places from address-as-names'
\echo '  2. Created fix_address_account_place_overrides() for ongoing pipeline use'
\echo '  3. Backfilled linked_place_id for existing address accounts'
\echo '  4. Processed pending owner_info records'
\echo '  5. Linked appointments to clinic_owner_accounts'
\echo '  6. Ran place inference with address override'
\echo '  7. Updated run_all_entity_linking() to include Step 9'
\echo ''
\echo 'Going forward, the pipeline will:'
\echo '  - Extract places from owner names classified as addresses'
\echo '  - Override corrupted booking_address with owner_account_address'
\echo '  - Ensure cats are linked to correct places despite HQ autocorrect'
\echo ''
\echo 'DATA_GAP_005: Address in Owner Name - RESOLVED'
\echo ''
