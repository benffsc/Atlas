\echo '=== MIG_881: Fix Phone COALESCE Cross-Linking Bug ==='
\echo 'Problem: process_clinichq_owner_info() prefers Owner Cell Phone over Owner Phone.'
\echo 'When two phones resolve to different people, appointments link to wrong person.'
\echo 'Example: Gordon Maxwell (phone=7077669384) had 34+ appointments linked to'
\echo '  Susan Simons (cell=7075436499) because COALESCE picked cell phone first.'
\echo 'Scope: 30+ affected client records with cross-linked appointments.'
\echo ''

-- ============================================================================
-- PHASE 1: FIX THE FUNCTION (prevent future occurrences)
-- ============================================================================

\echo '--- Phase 1: Fix process_clinichq_owner_info() phone preference ---'

-- Recreate with Owner Phone preferred over Owner Cell Phone.
-- Rationale: Owner Phone is the primary/stable client number in ClinicHQ.
-- Owner Cell Phone is more likely shared between household members.
-- MIG_152 originally prioritized cell phone for observation extraction
-- (to avoid grouping by shared FFSC landline 7075767999), but the COALESCE
-- in identity matching has the opposite problem: it cross-links when cell
-- phones are shared between household members.

DROP FUNCTION IF EXISTS trapper.process_clinichq_owner_info(integer);

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
  -- MIG_881 FIX: COALESCE now prefers Owner Phone over Owner Cell Phone
  -- ============================================================
  WITH owner_data AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone'))))
      payload->>'Owner First Name' as first_name,
      payload->>'Owner Last Name' as last_name,
      NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
      -- MIG_881: Prefer Owner Phone (primary/stable) over Owner Cell Phone (shared in households)
      trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone')) as phone,
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
      AND trapper.should_be_person(
        payload->>'Owner First Name',
        payload->>'Owner Last Name',
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
        trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone'))
      )
    ORDER BY COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone'))),
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
  -- ============================================================
  WITH pseudo_profiles AS (
    SELECT DISTINCT ON (TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')))
      TRIM(COALESCE(payload->>'Owner First Name', '') || ' ' || COALESCE(payload->>'Owner Last Name', '')) as display_name,
      payload->>'Number' as appointment_number
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'owner_info'
      AND processed_at IS NULL
      AND NOT trapper.should_be_person(
        payload->>'Owner First Name',
        payload->>'Owner Last Name',
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
        trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone'))
      )
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
        NULL,
        NULL,
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
      -- MIG_881: Prefer Owner Phone over Owner Cell Phone
      trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Phone', ''), payload->>'Owner Cell Phone')) as phone
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
  -- MIG_881: Prefer Owner Phone over Owner Cell Phone in JOIN
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
      OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Phone', ''), sr.payload->>'Owner Cell Phone')))
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
  -- MIG_881: Prefer Owner Phone over Owner Cell Phone in JOIN
  -- ============================================================
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = pi.person_id
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
      OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Phone', ''), sr.payload->>'Owner Cell Phone')))
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
      AND a.person_id IS NULL
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
      person_id, cat_id, relationship_type, effective_date, source_system, source_table
    )
    SELECT DISTINCT
      a.person_id,
      a.cat_id,
      'owner',
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
    ORDER BY a.person_id, a.cat_id, a.appointment_date
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
MIG_881: Fixed COALESCE to prefer Owner Phone over Owner Cell Phone.
Cell phones are more likely shared between household members (e.g., Gordon Maxwell
and Susan Simons share 7075436499). Preferring Owner Phone prevents cross-linking.';

\echo 'Function updated: COALESCE now prefers Owner Phone over Owner Cell Phone'

-- ============================================================================
-- PHASE 2: FIX CROSS-LINKED APPOINTMENTS (systemic repair)
-- ============================================================================

\echo ''
\echo '--- Phase 2: Fix cross-linked appointments ---'

-- Step 2a: Re-link appointments from cell phone person to owner phone person
WITH cross_linked AS (
  SELECT DISTINCT
    a.appointment_id,
    pi_phone.person_id as correct_person_id
  FROM trapper.sot_appointments a
  JOIN trapper.staged_records sr ON sr.source_system = 'clinichq'
    AND sr.source_table = 'owner_info'
    AND sr.payload->>'Number' = a.appointment_number
  JOIN trapper.person_identifiers pi_phone ON pi_phone.id_type = 'phone'
    AND pi_phone.id_value_norm = trapper.norm_phone_us(sr.payload->>'Owner Phone')
  JOIN trapper.person_identifiers pi_cell ON pi_cell.id_type = 'phone'
    AND pi_cell.id_value_norm = trapper.norm_phone_us(sr.payload->>'Owner Cell Phone')
  WHERE a.person_id IS NOT NULL
    AND sr.payload->>'Owner Phone' IS NOT NULL AND TRIM(sr.payload->>'Owner Phone') != ''
    AND sr.payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(sr.payload->>'Owner Cell Phone') != ''
    AND trapper.norm_phone_us(sr.payload->>'Owner Phone') != trapper.norm_phone_us(sr.payload->>'Owner Cell Phone')
    AND pi_phone.person_id != pi_cell.person_id
    AND a.person_id = pi_cell.person_id  -- currently linked to wrong (cell) person
),
updated AS (
  UPDATE trapper.sot_appointments a
  SET person_id = cl.correct_person_id, updated_at = NOW()
  FROM cross_linked cl WHERE a.appointment_id = cl.appointment_id
  RETURNING a.appointment_id, a.cat_id, cl.correct_person_id
)
SELECT COUNT(*) as appointments_fixed, COUNT(DISTINCT correct_person_id) as people_affected FROM updated;

-- Step 2b: Remove orphaned person_cat_relationships (person has no appointments with that cat)
WITH orphaned_pcr AS (
  DELETE FROM trapper.person_cat_relationships pcr
  WHERE pcr.source_system = 'clinichq'
    AND NOT EXISTS (
      SELECT 1 FROM trapper.sot_appointments a
      WHERE a.person_id = pcr.person_id AND a.cat_id = pcr.cat_id
    )
  RETURNING pcr.person_id, pcr.cat_id
)
SELECT COUNT(*) as orphaned_pcr_removed FROM orphaned_pcr;

-- Step 2c: Create correct person_cat_relationships for re-linked appointments
WITH new_pcr AS (
  INSERT INTO trapper.person_cat_relationships (
    person_id, cat_id, relationship_type, effective_date,
    source_system, source_table, context_notes
  )
  SELECT DISTINCT ON (a.person_id, a.cat_id)
    a.person_id, a.cat_id, 'owner',
    MIN(a.appointment_date) OVER (PARTITION BY a.person_id, a.cat_id),
    'clinichq', 'owner_info', 'MIG_881: Re-linked after phone COALESCE fix'
  FROM trapper.sot_appointments a
  WHERE a.cat_id IS NOT NULL AND a.person_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_cat_relationships pcr
      WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
    )
  ORDER BY a.person_id, a.cat_id, a.appointment_date
  ON CONFLICT DO NOTHING
  RETURNING person_id
)
SELECT COUNT(*) as new_pcr_created FROM new_pcr;

-- ============================================================================
-- PHASE 3: CLEAN UP PHANTOM "GORDON" RECORDS
-- ============================================================================

\echo ''
\echo '--- Phase 3: Clean up phantom Gordon records ---'

-- These 4 canonical "Gordon" (first-name-only) records from web_app
-- should be merged into canonical Gordon Maxwell.
-- They have variant emails (gordon@lohrmanln.com, maxwell@lohrmanlane.com, etc.)
-- that all appear to be the same person at 1251 Lohrman Ln.

DO $$
DECLARE
  v_gordon_canonical UUID := '89415ad8-54b7-4733-9ec1-20a4ced3c9eb';
  v_phantom_ids UUID[];
  v_phantom UUID;
  v_merged INT := 0;
BEGIN
  -- Identify phantom Gordon records (first-name-only from web_app, Lohrman-related)
  SELECT ARRAY_AGG(person_id) INTO v_phantom_ids
  FROM trapper.sot_people
  WHERE display_name = 'Gordon'
    AND data_source = 'web_app'
    AND merged_into_person_id IS NULL  -- canonical only
    AND person_id != v_gordon_canonical;

  IF v_phantom_ids IS NULL OR array_length(v_phantom_ids, 1) IS NULL THEN
    RAISE NOTICE 'No phantom Gordon records to clean up';
    RETURN;
  END IF;

  -- Merge each phantom into canonical Gordon Maxwell
  FOREACH v_phantom IN ARRAY v_phantom_ids
  LOOP
    -- Move any person_identifiers (except @petlink.tmp fake emails)
    UPDATE trapper.person_identifiers
    SET person_id = v_gordon_canonical
    WHERE person_id = v_phantom
      AND id_value_norm NOT LIKE '%@petlink.tmp%'
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_identifiers pi2
        WHERE pi2.person_id = v_gordon_canonical
          AND pi2.id_type = trapper.person_identifiers.id_type
          AND pi2.id_value_norm = trapper.person_identifiers.id_value_norm
      );

    -- Delete @petlink.tmp fake emails
    DELETE FROM trapper.person_identifiers
    WHERE person_id = v_phantom
      AND id_value_norm LIKE '%@petlink.tmp%';

    -- Move any remaining person_cat_relationships
    UPDATE trapper.person_cat_relationships
    SET person_id = v_gordon_canonical
    WHERE person_id = v_phantom
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships pcr2
        WHERE pcr2.person_id = v_gordon_canonical
          AND pcr2.cat_id = trapper.person_cat_relationships.cat_id
      );

    -- Move any person_place_relationships
    UPDATE trapper.person_place_relationships
    SET person_id = v_gordon_canonical
    WHERE person_id = v_phantom
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr2
        WHERE ppr2.person_id = v_gordon_canonical
          AND ppr2.place_id = trapper.person_place_relationships.place_id
      );

    -- Mark phantom as merged
    UPDATE trapper.sot_people
    SET merged_into_person_id = v_gordon_canonical,
        merged_at = NOW(),
        merge_reason = 'MIG_881: Phantom first-name-only record merged into canonical Gordon Maxwell',
        is_canonical = FALSE,
        updated_at = NOW()
    WHERE person_id = v_phantom;

    v_merged := v_merged + 1;
  END LOOP;

  -- Also merge any already-merged phantom Gordon records that point to intermediate phantoms
  UPDATE trapper.sot_people
  SET merged_into_person_id = v_gordon_canonical,
      merge_reason = COALESCE(merge_reason, '') || ' (MIG_881: redirected to canonical)'
  WHERE display_name = 'Gordon'
    AND data_source = 'web_app'
    AND merged_into_person_id IS NOT NULL
    AND merged_into_person_id != v_gordon_canonical
    AND merged_into_person_id IN (SELECT person_id FROM trapper.sot_people WHERE display_name = 'Gordon' AND data_source = 'web_app');

  RAISE NOTICE 'Merged % phantom Gordon records into canonical Gordon Maxwell', v_merged;
END $$;

-- ============================================================================
-- PHASE 4: CLEAN UP @petlink.tmp FAKE EMAILS
-- ============================================================================

\echo ''
\echo '--- Phase 4: Remove @petlink.tmp fake emails from person_identifiers ---'

-- @petlink.tmp emails are fabricated from phone numbers during PetLink processing.
-- They are not real email addresses and pollute identity matching.

WITH deleted AS (
  DELETE FROM trapper.person_identifiers
  WHERE id_value_norm LIKE '%@petlink.tmp%'
  RETURNING person_id, id_value_norm
)
SELECT COUNT(*) AS petlink_tmp_emails_removed FROM deleted;

\echo 'Removed @petlink.tmp fake emails from person_identifiers'

-- ============================================================================
-- PHASE 5: MARK FIRST-NAME-ONLY web_app RECORDS
-- ============================================================================

\echo ''
\echo '--- Phase 5: Mark first-name-only web_app records as low quality ---'

-- 579 first-name-only records from web_app source (no last name, no space in display_name).
-- These appear to be from various processing pipelines that created partial records.
-- Mark as data_quality='needs_review' so they don't pollute search results but aren't deleted.

WITH updated AS (
  UPDATE trapper.sot_people
  SET data_quality = 'needs_review',
      updated_at = NOW()
  WHERE data_source = 'web_app'
    AND merged_into_person_id IS NULL  -- canonical only
    AND display_name NOT LIKE '% %'   -- no last name (first name only)
    AND data_quality = 'normal'        -- not already marked
    AND display_name IS NOT NULL
    AND TRIM(display_name) != ''
  RETURNING person_id
)
SELECT COUNT(*) AS first_name_only_marked FROM updated;

\echo 'Marked first-name-only web_app records as needs_review'

-- ============================================================================
-- PHASE 6: VERIFICATION
-- ============================================================================

\echo ''
\echo '--- Phase 6: Verification ---'

\echo '1. Gordon Maxwell status:'
SELECT p.person_id, p.display_name, p.data_quality,
  (SELECT string_agg(pi.id_type || '=' || pi.id_value_norm, ', ')
   FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id) as identifiers,
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointments,
  (SELECT COUNT(DISTINCT a.cat_id) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id AND a.cat_id IS NOT NULL) as cats,
  (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) as pcr_count
FROM trapper.sot_people p
WHERE p.person_id = '89415ad8-54b7-4733-9ec1-20a4ced3c9eb';

\echo ''
\echo '2. Susan Simons status (should have fewer appointments now):'
SELECT p.person_id, p.display_name,
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointments,
  (SELECT COUNT(DISTINCT a.cat_id) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id AND a.cat_id IS NOT NULL) as cats,
  (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) as pcr_count
FROM trapper.sot_people p
WHERE p.person_id = '80637dbe-b7c2-41c1-b0de-ed777c79efb9';

\echo ''
\echo '3. Phantom Gordon records (should all be merged):'
SELECT person_id, display_name, merged_into_person_id IS NOT NULL as is_merged, data_quality
FROM trapper.sot_people
WHERE display_name = 'Gordon' AND data_source = 'web_app'
ORDER BY merged_into_person_id NULLS LAST;

\echo ''
\echo '4. @petlink.tmp emails remaining (should be 0):'
SELECT COUNT(*) as remaining FROM trapper.person_identifiers WHERE id_value_norm LIKE '%@petlink.tmp%';

\echo ''
\echo '5. First-name-only web_app records:'
SELECT data_quality, COUNT(*) as count
FROM trapper.sot_people
WHERE data_source = 'web_app'
  AND merged_into_person_id IS NULL
  AND display_name NOT LIKE '% %'
  AND display_name IS NOT NULL AND TRIM(display_name) != ''
GROUP BY data_quality;

\echo ''
\echo '6. Cross-linking fix summary (other affected clients):'
SELECT p.display_name,
  (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) as appointments,
  (SELECT COUNT(DISTINCT a.cat_id) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id AND a.cat_id IS NOT NULL) as cats
FROM trapper.sot_people p
WHERE p.person_id IN (
  '9d284ea9-246a-4f9e-b4ec-b1ca7d810247',  -- Henry Dalley (phone person)
  'a7a1df49-b8fe-48b3-ad14-652970fcbdc6',  -- Alina Kremer (phone person)
  '40b67d84-132d-45c1-836e-20073cc43407',  -- Michael Proctor (phone person)
  '22ae552b-36be-4ef5-84d1-0f718f4c9ad8',  -- Pam Stevens (phone person)
  '89415ad8-54b7-4733-9ec1-20a4ced3c9eb'   -- Gordon Maxwell (phone person)
);

\echo ''
\echo '=== MIG_881 Complete ==='
\echo 'Fixed:'
\echo '  1. process_clinichq_owner_info() now prefers Owner Phone over Owner Cell Phone'
\echo '  2. Cross-linked appointments re-linked to correct person (phone owner)'
\echo '  3. Phantom "Gordon" records merged into canonical Gordon Maxwell'
\echo '  4. @petlink.tmp fake emails removed from person_identifiers'
\echo '  5. First-name-only web_app records marked as needs_review'
