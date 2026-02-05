-- ============================================================================
-- MIG_888: Data Engine Email Soft Blacklist + Appointment Linking Fix
-- ============================================================================
-- Root Cause: data_engine_score_candidates() checks data_engine_soft_blacklist
-- for phones (reducing score to 0.5) but NOT for emails. Org emails like
-- marinferals@yahoo.com auto-match at full score, causing identity collisions.
--
-- Also: appointment linking (Step 6 in process_clinichq_owner_info) does raw
-- person_identifiers lookup, bypassing the Data Engine entirely. Soft-blacklisted
-- identifiers still resolve to whoever owns them.
--
-- Fixes:
-- 1. Add email soft blacklist check to data_engine_score_candidates()
-- 2. Add soft blacklist filter to appointment linking in process_clinichq_owner_info()
-- 3. Add marinferals@yahoo.com to data_engine_soft_blacklist
-- 4. Add Marin Friends of Ferals to known_organizations
-- ============================================================================

\echo '=== MIG_888: Data Engine Email Soft Blacklist ==='

-- ============================================================================
-- Phase 1: Update data_engine_score_candidates() with email soft blacklist
-- ============================================================================

\echo ''
\echo 'Phase 1: Updating data_engine_score_candidates() with email soft blacklist...'

CREATE OR REPLACE FUNCTION trapper.data_engine_score_candidates(
    p_email_norm TEXT,
    p_phone_norm TEXT,
    p_display_name TEXT,
    p_address_norm TEXT
)
RETURNS TABLE (
    person_id UUID,
    display_name TEXT,
    total_score NUMERIC,
    email_score NUMERIC,
    phone_score NUMERIC,
    name_score NUMERIC,
    address_score NUMERIC,
    household_id UUID,
    is_household_candidate BOOLEAN,
    matched_rules TEXT[],
    used_enrichment BOOLEAN,
    enrichment_source TEXT,
    score_breakdown JSONB,
    rules_applied JSONB
) AS $$
DECLARE
    v_email_blacklisted BOOLEAN := FALSE;
BEGIN
    -- Check if incoming email is blacklisted (hard blacklist)
    IF p_email_norm IS NOT NULL AND p_email_norm != '' THEN
        v_email_blacklisted := trapper.is_blacklisted_email(p_email_norm);
    END IF;

    RETURN QUERY
    WITH
    -- Email matches (with blacklist check + confidence filter)
    -- MIG_888: Now checks data_engine_soft_blacklist for emails (same as phones)
    email_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN v_email_blacklisted THEN 0.0::NUMERIC
                -- MIG_888: Soft blacklist reduces email score to 0.5
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN v_email_blacklisted THEN 'email_blacklisted'::TEXT
                -- MIG_888: Track soft blacklist match rule
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_email_norm
                    AND sbl.identifier_type = 'email'
                ) THEN 'exact_email_soft_blacklist'::TEXT
                ELSE 'exact_email'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_email_norm IS NOT NULL
          AND p_email_norm != ''
          AND NOT v_email_blacklisted  -- Don't match on blacklisted emails
          AND pi.id_type = 'email'
          AND pi.id_value_norm = p_email_norm
          AND pi.confidence >= 0.5  -- MIG_887: Exclude low-confidence identifiers
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- Phone matches (check blacklists)
    phone_matches AS (
        SELECT DISTINCT
            pi.person_id AS matched_person_id,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.identity_phone_blacklist bl
                    WHERE bl.phone_norm = p_phone_norm
                    AND bl.allow_with_name_match = FALSE
                ) THEN 0.0::NUMERIC
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 0.5::NUMERIC
                ELSE 1.0::NUMERIC
            END as score,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
                    WHERE sbl.identifier_norm = p_phone_norm
                    AND sbl.identifier_type = 'phone'
                ) THEN 'exact_phone_soft_blacklist'::TEXT
                ELSE 'exact_phone'::TEXT
            END as rule
        FROM trapper.person_identifiers pi
        WHERE p_phone_norm IS NOT NULL
          AND p_phone_norm != ''
          AND pi.id_type = 'phone'
          AND pi.id_value_norm = p_phone_norm
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = p_phone_norm
              AND bl.allow_with_name_match = FALSE
          )
          AND EXISTS (
              SELECT 1 FROM trapper.sot_people sp
              WHERE sp.person_id = pi.person_id
              AND sp.merged_into_person_id IS NULL
          )
    ),

    -- All unique candidates from identifier matches
    all_candidates AS (
        SELECT matched_person_id FROM email_matches
        UNION
        SELECT matched_person_id FROM phone_matches
    ),

    -- Enriched address matching (cross-source)
    enriched_address_matches AS (
        SELECT DISTINCT
            ppr.person_id AS matched_person_id,
            p.formatted_address AS enriched_address,
            sp.data_source::TEXT AS address_source
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places p ON p.place_id = ppr.place_id
        JOIN trapper.sot_people sp ON sp.person_id = ppr.person_id
        WHERE ppr.person_id IN (SELECT matched_person_id FROM all_candidates)
          AND p.formatted_address IS NOT NULL
          AND p.merged_into_place_id IS NULL
          AND sp.merged_into_person_id IS NULL
    ),

    -- Calculate scores for each candidate
    scored_candidates AS (
        SELECT
            sp.person_id,
            sp.display_name,
            -- Email score: 40% weight
            COALESCE((SELECT em.score FROM email_matches em WHERE em.matched_person_id = sp.person_id), 0.0) * 0.40 AS email_component,
            -- Phone score: 25% weight
            COALESCE((SELECT pm.score FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id), 0.0) * 0.25 AS phone_component,
            -- Name similarity: 25% weight
            CASE
                WHEN p_display_name IS NULL OR p_display_name = '' THEN 0.0
                WHEN sp.display_name IS NULL OR sp.display_name = '' THEN 0.0
                ELSE trapper.name_similarity(p_display_name, sp.display_name) * 0.25
            END AS name_component,
            -- Address match: 10% weight (with enrichment from cross-source)
            CASE
                -- Direct address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM trapper.person_place_relationships ppr
                    JOIN trapper.places pl ON pl.place_id = ppr.place_id
                    WHERE ppr.person_id = sp.person_id
                    AND pl.normalized_address = p_address_norm
                    AND pl.merged_into_place_id IS NULL
                ) THEN 0.10
                -- Cross-source enriched address match
                WHEN p_address_norm IS NOT NULL AND p_address_norm != '' AND EXISTS (
                    SELECT 1 FROM enriched_address_matches eam
                    WHERE eam.matched_person_id = sp.person_id
                    AND UPPER(eam.enriched_address) = p_address_norm
                ) THEN 0.08
                ELSE 0.0
            END AS address_component,
            -- Household detection
            hm.household_id,
            CASE
                WHEN hm.household_id IS NOT NULL THEN TRUE
                ELSE FALSE
            END AS is_household_candidate,
            -- Track matched rules
            ARRAY_REMOVE(ARRAY[
                (SELECT em.rule FROM email_matches em WHERE em.matched_person_id = sp.person_id),
                (SELECT pm.rule FROM phone_matches pm WHERE pm.matched_person_id = sp.person_id),
                CASE WHEN EXISTS (
                    SELECT 1 FROM enriched_address_matches eam
                    WHERE eam.matched_person_id = sp.person_id
                ) THEN 'enriched_address' ELSE NULL END
            ], NULL) AS matched_rules,
            -- Check if enrichment was used
            EXISTS (
                SELECT 1 FROM enriched_address_matches eam
                WHERE eam.matched_person_id = sp.person_id
            ) AS used_enrichment,
            (SELECT eam.address_source FROM enriched_address_matches eam
             WHERE eam.matched_person_id = sp.person_id LIMIT 1) AS enrichment_source
        FROM all_candidates ac
        JOIN trapper.sot_people sp ON sp.person_id = ac.matched_person_id
        LEFT JOIN trapper.household_members hm ON hm.person_id = sp.person_id
        WHERE sp.merged_into_person_id IS NULL
    )

    SELECT
        sc.person_id,
        sc.display_name,
        (sc.email_component + sc.phone_component + sc.name_component + sc.address_component)::NUMERIC AS total_score,
        sc.email_component AS email_score,
        sc.phone_component AS phone_score,
        sc.name_component AS name_score,
        sc.address_component AS address_score,
        sc.household_id,
        sc.is_household_candidate,
        sc.matched_rules,
        sc.used_enrichment,
        sc.enrichment_source,
        jsonb_build_object(
            'email', sc.email_component,
            'phone', sc.phone_component,
            'name', sc.name_component,
            'address', sc.address_component
        ) AS score_breakdown,
        '[]'::JSONB AS rules_applied
    FROM scored_candidates sc
    WHERE (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) > 0
    ORDER BY (sc.email_component + sc.phone_component + sc.name_component + sc.address_component) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.data_engine_score_candidates(TEXT, TEXT, TEXT, TEXT) IS
'MIG_888: Added email soft blacklist check (parity with phone soft blacklist).
Shared org emails now reduce score to 0.5 instead of 1.0.
MIG_887: pi.confidence >= 0.5 filter. Weights: email 40%, phone 25%, name 25%, address 10%.';

-- ============================================================================
-- Phase 2: Update process_clinichq_owner_info() Step 6 with soft blacklist
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating process_clinichq_owner_info() with soft blacklist filter...'

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
        trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone'))
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
  -- MIG_888: Now respects data_engine_soft_blacklist
  -- Soft-blacklisted identifiers are skipped to prevent wrong person matching
  -- ============================================================
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET person_id = pi.person_id
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email'
       AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '')
       -- MIG_888: Skip soft-blacklisted emails for appointment linking
       AND NOT EXISTS (
         SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
         WHERE sbl.identifier_norm = pi.id_value_norm AND sbl.identifier_type = 'email'
       )
      )
      OR (pi.id_type = 'phone'
       AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
       -- MIG_888: Skip soft-blacklisted phones for appointment linking
       AND NOT EXISTS (
         SELECT 1 FROM trapper.data_engine_soft_blacklist sbl
         WHERE sbl.identifier_norm = pi.id_value_norm AND sbl.identifier_type = 'phone'
       )
      )
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
'MIG_888: Step 6 now respects data_engine_soft_blacklist for both email and phone.
Soft-blacklisted identifiers are skipped during appointment linking to prevent
shared org identifiers from linking appointments to the wrong person.
Routes REAL PEOPLE to sot_people, PSEUDO-PROFILES to clinic_owner_accounts.';

-- ============================================================================
-- Phase 3: Add marinferals@yahoo.com to email soft blacklist
-- ============================================================================

\echo ''
\echo 'Phase 3: Adding marinferals@yahoo.com to email soft blacklist...'

INSERT INTO trapper.data_engine_soft_blacklist (
  identifier_norm, identifier_type, reason,
  require_name_similarity, require_address_match,
  distinct_name_count, sample_names
)
VALUES (
  'marinferals@yahoo.com',
  'email',
  'Marin Friends of Ferals org email shared by Jeanie Garcia and Carlos Lopez',
  0.70,
  true,
  2,
  ARRAY['Jeanie Garcia', 'Carlos Lopez']
)
ON CONFLICT (identifier_norm, identifier_type) DO NOTHING;

-- ============================================================================
-- Phase 4: Add Marin Friends of Ferals to known_organizations
-- ============================================================================

\echo ''
\echo 'Phase 4: Adding Marin Friends of Ferals to known_organizations...'

INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES (
  'Marin Friends of Ferals',
  '%marin%feral%',
  'rescue',
  'Outside organization that performs TNR. Shared email marinferals@yahoo.com is soft-blacklisted. Known contacts: Jeanie Garcia, Carlos Lopez.'
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_888 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. data_engine_score_candidates(): email soft blacklist check added'
\echo '  2. process_clinichq_owner_info() Step 6: soft blacklist filter'
\echo '  3. marinferals@yahoo.com added to data_engine_soft_blacklist'
\echo '  4. Marin Friends of Ferals added to known_organizations'
\echo ''
\echo 'Effect: Shared org emails now score 0.5 (not 1.0) in identity resolution.'
\echo 'Appointment linking skips soft-blacklisted identifiers entirely.'
