\echo ''
\echo '=============================================='
\echo 'MIG_573: ClinicHQ Pseudo-Profile Routing'
\echo '=============================================='
\echo ''
\echo 'Updates the ClinicHQ owner_info processor to route records'
\echo 'to clinic_owner_accounts when the owner name is not a real person.'
\echo ''

-- ============================================================================
-- STEP 1: Create helper function to determine if owner should be a person
-- ============================================================================

\echo 'Creating should_be_person() function...'

CREATE OR REPLACE FUNCTION trapper.should_be_person(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_phone TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_display_name TEXT;
  v_classification TEXT;
BEGIN
  -- Must have some contact info to be a real person
  IF (p_email IS NULL OR p_email = '') AND (p_phone IS NULL OR p_phone = '') THEN
    RETURN FALSE;
  END IF;

  -- Must have at least first name
  IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
    RETURN FALSE;
  END IF;

  -- Build display name
  v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));

  -- Use existing classification function
  v_classification := trapper.classify_owner_name(v_display_name);

  -- Only create person if classified as likely_person
  RETURN v_classification = 'likely_person';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.should_be_person IS
'Determines if an owner record should be created as a person or routed to clinic_owner_accounts.
Returns TRUE only if the record has contact info AND the name looks like a real person name.';

-- ============================================================================
-- STEP 2: Update process_clinichq_owner_info to route pseudo-profiles
-- ============================================================================

\echo ''
\echo 'Updating process_clinichq_owner_info function...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_owner_info(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- ============================================================
  -- Step 1: Create REAL PEOPLE using find_or_create_person
  -- Only for records with contact info AND name looks like a person
  -- ============================================================
  WITH owner_data AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))))
      payload->>'Owner First Name' as first_name,
      payload->>'Owner Last Name' as last_name,
      NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
      trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone,
      NULLIF(TRIM(payload->>'Owner Address'), '') as address,
      payload->>'Number' as appointment_number
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'owner_info'
      AND processed_at IS NULL
      AND (
        (payload->>'Owner Email' IS NOT NULL AND TRIM(payload->>'Owner Email') != '')
        OR (payload->>'Owner Phone' IS NOT NULL AND TRIM(payload->>'Owner Phone') != '')
        OR (payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(payload->>'Owner Cell Phone') != '')
      )
      AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
      -- NEW: Only process as person if should_be_person() returns TRUE
      AND trapper.should_be_person(
        payload->>'Owner First Name',
        payload->>'Owner Last Name',
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
        trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone'))
      )
    ORDER BY COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))),
             (payload->>'Date')::date DESC NULLS LAST
    LIMIT p_batch_size
  ),
  created_people AS (
    SELECT
      od.*,
      trapper.find_or_create_person(
        od.email,
        od.phone,
        od.first_name,
        od.last_name,
        od.address,
        'clinichq'
      ) as person_id
    FROM owner_data od
    WHERE od.first_name IS NOT NULL
  )
  SELECT COUNT(*) INTO v_count FROM created_people WHERE person_id IS NOT NULL;
  v_results := v_results || jsonb_build_object('people_created_or_matched', v_count);

  -- ============================================================
  -- Step 2: Create PSEUDO-PROFILES in clinic_owner_accounts
  -- For records without contact info OR name looks like address/org
  -- ============================================================
  WITH pseudo_profiles AS (
    SELECT DISTINCT ON (TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')))
      TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')) as display_name,
      payload->>'Number' as appointment_number
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'owner_info'
      AND processed_at IS NULL
      -- Records that should NOT be people
      AND NOT trapper.should_be_person(
        payload->>'Owner First Name',
        payload->>'Owner Last Name',
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
        trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone'))
      )
      -- But do have some name
      AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
    ORDER BY TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')),
             (payload->>'Date')::date DESC NULLS LAST
    LIMIT p_batch_size
  ),
  created_accounts AS (
    SELECT
      pp.*,
      trapper.find_or_create_clinic_account(
        pp.display_name,
        NULL,  -- account_type will be auto-classified
        NULL,  -- brought_by will be auto-extracted
        'clinichq'
      ) as account_id
    FROM pseudo_profiles pp
    WHERE pp.display_name IS NOT NULL AND pp.display_name != ''
  )
  SELECT COUNT(*) INTO v_count FROM created_accounts WHERE account_id IS NOT NULL;
  v_results := v_results || jsonb_build_object('clinic_accounts_created', v_count);

  -- ============================================================
  -- Step 3: Create places from owner addresses
  -- ============================================================
  WITH owner_addresses AS (
    SELECT DISTINCT ON (TRIM(payload->>'Owner Address'))
      TRIM(payload->>'Owner Address') as address,
      NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
      trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'owner_info'
      AND processed_at IS NULL
      AND payload->>'Owner Address' IS NOT NULL
      AND TRIM(payload->>'Owner Address') != ''
      AND LENGTH(TRIM(payload->>'Owner Address')) > 10
    ORDER BY TRIM(payload->>'Owner Address'), (payload->>'Date')::date DESC NULLS LAST
    LIMIT p_batch_size
  ),
  created_places AS (
    SELECT
      oa.*,
      trapper.find_or_create_place_deduped(
        oa.address,
        NULL,
        NULL,
        NULL,
        'clinichq'
      ) as place_id
    FROM owner_addresses oa
  )
  SELECT COUNT(*) INTO v_count FROM created_places WHERE place_id IS NOT NULL;
  v_results := v_results || jsonb_build_object('places_created_or_matched', v_count);

  -- ============================================================
  -- Step 4: Link people to places via person_place_relationships
  -- ============================================================
  WITH inserts AS (
    INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
    SELECT DISTINCT
      pi.person_id,
      p.place_id,
      'resident'::trapper.person_place_role,
      0.7,
      'clinichq',
      'owner_info'
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
      OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
    )
    JOIN trapper.places p ON p.normalized_address = trapper.normalize_address(sr.payload->>'Owner Address')
      AND p.merged_into_place_id IS NULL
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NULL
      AND sr.payload->>'Owner Address' IS NOT NULL
      AND TRIM(sr.payload->>'Owner Address') != ''
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = pi.person_id AND ppr.place_id = p.place_id
      )
    ON CONFLICT DO NOTHING
    RETURNING person_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('person_place_links', v_count);

  -- ============================================================
  -- Step 5: Backfill owner_email and owner_phone on appointments
  -- ============================================================
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
      owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NULL
      AND sr.payload->>'Number' = a.appointment_number
      AND a.owner_email IS NULL
      AND sr.payload->>'Owner Email' IS NOT NULL
      AND sr.payload->>'Owner Email' != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_owner_backfilled', v_count);

  -- ============================================================
  -- Step 6: Link REAL people to appointments via email/phone
  -- ============================================================
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = pi.person_id
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
      OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
    )
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NULL
      AND a.appointment_number = sr.payload->>'Number'
      AND a.person_id IS NULL
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_linked_to_people', v_count);

  -- ============================================================
  -- Step 7: Link PSEUDO-PROFILES to appointments
  -- ============================================================
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET owner_account_id = coa.account_id
    FROM trapper.staged_records sr
    JOIN trapper.clinic_owner_accounts coa ON (
      LOWER(coa.display_name) = LOWER(TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', '')))
      OR LOWER(TRIM(COALESCE(sr.payload->>'Owner First Name', '') || ' ' || COALESCE(sr.payload->>'Owner Last Name', ''))) = ANY(SELECT LOWER(unnest(coa.source_display_names)))
    )
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NULL
      AND a.appointment_number = sr.payload->>'Number'
      AND a.person_id IS NULL  -- Only if no person linked
      AND a.owner_account_id IS NULL
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_linked_to_accounts', v_count);

  -- ============================================================
  -- Step 8: Link cats to people via appointments
  -- ============================================================
  WITH cat_person_links AS (
    INSERT INTO trapper.person_cat_relationships (
      person_id, cat_id, relationship_type, start_date, source_system, source_table
    )
    SELECT DISTINCT
      a.person_id,
      a.cat_id,
      'owner'::trapper.person_cat_relationship_type,
      a.appointment_date,
      'clinichq',
      'owner_info'
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.person_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships pcr
        WHERE pcr.person_id = a.person_id
          AND pcr.cat_id = a.cat_id
      )
    ON CONFLICT DO NOTHING
    RETURNING person_id
  )
  SELECT COUNT(*) INTO v_count FROM cat_person_links;
  v_results := v_results || jsonb_build_object('cat_person_links', v_count);

  -- ============================================================
  -- Step 9: Mark staged records as processed
  -- ============================================================
  UPDATE trapper.staged_records
  SET processed_at = NOW()
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND processed_at IS NULL;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_owner_info(INT) IS
'Process ClinicHQ owner_info staged records.
- Routes REAL PEOPLE (with contact info + person-like name) to sot_people via find_or_create_person
- Routes PSEUDO-PROFILES (addresses, orgs, apartments) to clinic_owner_accounts
- Creates places via find_or_create_place_deduped
- Links people to places
- CRITICAL: Backfills owner_email/phone on appointments
- Links people/accounts to appointments
- Creates person-cat relationships';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_573 Complete!'
\echo '=============================================='
\echo ''
\echo 'Updated:'
\echo '  - process_clinichq_owner_info() now routes pseudo-profiles to clinic_owner_accounts'
\echo '  - New should_be_person() helper function'
\echo ''
\echo 'New Processing Flow:'
\echo '  1. Owner has contact info AND name looks like person → sot_people'
\echo '  2. Owner name looks like address/org/apartment → clinic_owner_accounts'
\echo '  3. Appointments link to person_id OR owner_account_id appropriately'
\echo ''
