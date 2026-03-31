-- MIG_2975: Stored procedure for ClinicHQ post-processing
-- FFS-736: Moves ~1,200 lines of SQL from the TS process route into a
-- transactional PL/pgSQL function. Eliminates Vercel's 300s timeout for
-- the heaviest work by running entirely in the database.
--
-- Called by: apps/web/src/app/api/ingest/process/[id]/route.ts (Phase 3c)
-- Runs in caller's transaction (implicit in PL/pgSQL).
-- CRITICAL steps throw on error. SUPPLEMENTARY steps use BEGIN...EXCEPTION.
-- Returns JSONB with per-step counters matching the existing results object.

CREATE OR REPLACE FUNCTION ops.run_clinichq_post_processing(
  p_upload_id UUID,
  p_source_table TEXT
) RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}'::JSONB;
  v_count INT;
  v_count2 INT;
  v_step INT := 0;
  v_birth_interval_days INT;
BEGIN

  -- ==========================================================================
  -- cat_info post-processing
  -- ==========================================================================
  IF p_source_table = 'cat_info' THEN

    -- CRITICAL: Step 1 — Create cats from microchips
    v_step := v_step + 1;
    v_results := v_results || jsonb_build_object('_step_num', v_step, '_current_step', 'Creating cats from microchips...');
    UPDATE ops.file_uploads SET post_processing_results = v_results WHERE upload_id = p_upload_id;

    WITH cat_data AS (
      SELECT DISTINCT ON (ci.payload->>'Microchip Number')
        ci.payload->>'Microchip Number' as microchip,
        NULLIF(TRIM(ci.payload->>'Animal Name'), '') as name,
        NULLIF(TRIM(ci.payload->>'Sex'), '') as sex,
        NULLIF(TRIM(ci.payload->>'Breed'), '') as breed,
        NULLIF(TRIM(ci.payload->>'Primary Color'), '') as color,
        CASE
          WHEN TRIM(ci.payload->>'Spay Neuter Status') IN ('Yes', 'No') THEN TRIM(ci.payload->>'Spay Neuter Status')
          ELSE NULL
        END as altered_status,
        NULLIF(TRIM(ci.payload->>'Secondary Color'), '') as secondary_color,
        NULLIF(TRIM(ci.payload->>'Number'), '') as clinichq_animal_id,
        CASE TRIM(oi.payload->>'Ownership')
          WHEN 'Community Cat (Feral)' THEN 'feral'
          WHEN 'Community Cat (Friendly)' THEN 'community'
          WHEN 'Owned' THEN 'owned'
          WHEN 'Foster' THEN 'foster'
          WHEN 'Shelter' THEN 'unknown'
          WHEN 'Misc 1' THEN 'unknown'
          WHEN 'Misc 2' THEN 'unknown'
          WHEN 'Misc 3' THEN 'unknown'
          ELSE NULL
        END as ownership_type
      FROM ops.staged_records ci
      LEFT JOIN ops.staged_records oi ON
        oi.source_system = 'clinichq'
        AND oi.source_table = 'owner_info'
        AND oi.payload->>'Microchip Number' = ci.payload->>'Microchip Number'
        AND oi.file_upload_id = p_upload_id
      WHERE ci.source_system = 'clinichq'
        AND ci.source_table = 'cat_info'
        AND ci.payload->>'Microchip Number' IS NOT NULL
        AND TRIM(ci.payload->>'Microchip Number') != ''
        AND LENGTH(TRIM(ci.payload->>'Microchip Number')) >= 9
        AND ci.file_upload_id = p_upload_id
      ORDER BY ci.payload->>'Microchip Number', ci.created_at DESC
    ),
    created_cats AS (
      SELECT
        cd.*,
        sot.find_or_create_cat_by_microchip(
          p_microchip := cd.microchip,
          p_name := cd.name,
          p_sex := cd.sex,
          p_breed := cd.breed,
          p_altered_status := cd.altered_status,
          p_color := cd.color,
          p_source_system := 'clinichq',
          p_clinichq_animal_id := cd.clinichq_animal_id,
          p_ownership_type := cd.ownership_type,
          p_secondary_color := cd.secondary_color
        ) as cat_id
      FROM cat_data cd
      WHERE cd.microchip IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM created_cats WHERE cat_id IS NOT NULL;
    v_results := v_results || jsonb_build_object('cats_created_or_matched', v_count);

    -- SUPPLEMENTARY: Step 2 — Update sex on existing cats
    v_step := v_step + 1;
    BEGIN
      UPDATE sot.cats c
      SET sex = sr.payload->>'Sex'
      FROM ops.staged_records sr
      JOIN sot.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE ci.cat_id = c.cat_id
        AND sr.source_system = 'clinichq'
        AND sr.source_table = 'cat_info'
        AND sr.file_upload_id = p_upload_id
        AND sr.payload->>'Sex' IS NOT NULL
        AND sr.payload->>'Sex' != ''
        AND LOWER(c.sex) IS DISTINCT FROM LOWER(sr.payload->>'Sex');
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('sex_updates', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('sex_updates_error', SQLERRM);
    END;

    -- CRITICAL: Step 1b — Recheck cats (microchip in Animal Name)
    v_step := v_step + 1;
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
    SELECT DISTINCT ON (rd.clinichq_animal_id)
      existing_ci.cat_id,
      'clinichq_animal_id',
      rd.clinichq_animal_id,
      'clinichq',
      NOW()
    FROM (
      SELECT
        ci.payload->>'Number' as clinichq_animal_id,
        ci.payload->>'Animal Name' as embedded_microchip
      FROM ops.staged_records ci
      WHERE ci.source_system = 'clinichq'
        AND ci.source_table = 'cat_info'
        AND ci.file_upload_id = p_upload_id
        AND (ci.payload->>'Microchip Number' IS NULL OR TRIM(ci.payload->>'Microchip Number') = '')
        AND ci.payload->>'Animal Name' ~ '^[0-9]{15}$'
    ) rd
    JOIN sot.cat_identifiers existing_ci ON existing_ci.id_value = rd.embedded_microchip AND existing_ci.id_type = 'microchip'
    WHERE NOT EXISTS (
      SELECT 1 FROM sot.cat_identifiers ci2
      WHERE ci2.id_value = rd.clinichq_animal_id AND ci2.id_type = 'clinichq_animal_id'
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('recheck_cats_matched', v_count);

    -- CRITICAL: Step 1b-bis — First-visit with microchip in Animal Name
    v_step := v_step + 1;
    WITH first_visit_chip AS (
      SELECT DISTINCT ON (ci.payload->>'Animal Name')
        TRIM(ci.payload->>'Animal Name') AS microchip_from_name,
        NULLIF(TRIM(ci.payload->>'Number'), '') AS clinichq_animal_id,
        NULLIF(TRIM(ci.payload->>'Sex'), '') AS sex,
        NULLIF(TRIM(ci.payload->>'Breed'), '') AS breed,
        NULLIF(TRIM(ci.payload->>'Primary Color'), '') AS color,
        ci.source_row_id
      FROM ops.staged_records ci
      WHERE ci.source_system = 'clinichq'
        AND ci.source_table = 'cat_info'
        AND ci.file_upload_id = p_upload_id
        AND (ci.payload->>'Microchip Number' IS NULL OR TRIM(ci.payload->>'Microchip Number') = '')
        AND ci.payload->>'Animal Name' ~ '^[0-9]{15}$'
        AND NOT EXISTS (
          SELECT 1 FROM sot.cat_identifiers ex
          WHERE ex.id_value = TRIM(ci.payload->>'Animal Name')
            AND ex.id_type = 'microchip'
        )
      ORDER BY ci.payload->>'Animal Name', ci.created_at DESC
    ),
    created_cats AS (
      INSERT INTO sot.cats (
        cat_id, microchip, sex, breed, primary_color,
        clinichq_animal_id, source_system, source_record_id,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(), fvc.microchip_from_name, LOWER(fvc.sex), fvc.breed, fvc.color,
        fvc.clinichq_animal_id, 'clinichq', fvc.source_row_id, NOW(), NOW()
      FROM first_visit_chip fvc
      RETURNING cat_id, microchip, clinichq_animal_id
    )
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
    SELECT cc.cat_id, 'microchip', cc.microchip, 'clinichq', NOW()
    FROM created_cats cc
    UNION ALL
    SELECT cc.cat_id, 'clinichq_animal_id', cc.clinichq_animal_id, 'clinichq', NOW()
    FROM created_cats cc
    WHERE cc.clinichq_animal_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('first_visit_microchip_cats_created', v_count);

    -- CRITICAL: Step 1c — Create cats WITHOUT microchips
    v_step := v_step + 1;
    WITH no_chip_cats AS (
      SELECT DISTINCT ON (ci.payload->>'Number')
        NULLIF(TRIM(ci.payload->>'Number'), '') as clinichq_animal_id,
        NULLIF(TRIM(ci.payload->>'Animal Name'), '') as name,
        NULLIF(TRIM(ci.payload->>'Sex'), '') as sex,
        NULLIF(TRIM(ci.payload->>'Breed'), '') as breed,
        NULLIF(TRIM(ci.payload->>'Primary Color'), '') as color,
        NULLIF(TRIM(ci.payload->>'Secondary Color'), '') as secondary_color,
        CASE TRIM(oi.payload->>'Ownership')
          WHEN 'Community Cat (Feral)' THEN 'feral'
          WHEN 'Community Cat (Friendly)' THEN 'community'
          WHEN 'Owned' THEN 'owned'
          WHEN 'Foster' THEN 'foster'
          ELSE NULL
        END as ownership_type
      FROM ops.staged_records ci
      LEFT JOIN ops.staged_records oi ON
        oi.source_system = 'clinichq'
        AND oi.source_table = 'owner_info'
        AND oi.payload->>'Number' = ci.payload->>'Number'
        AND oi.file_upload_id = p_upload_id
      WHERE ci.source_system = 'clinichq'
        AND ci.source_table = 'cat_info'
        AND ci.file_upload_id = p_upload_id
        AND (ci.payload->>'Microchip Number' IS NULL OR TRIM(ci.payload->>'Microchip Number') = '')
        AND NOT (ci.payload->>'Animal Name' ~ '^[0-9]{15}$')
        AND ci.payload->>'Number' IS NOT NULL
        AND TRIM(ci.payload->>'Number') != ''
        AND NOT EXISTS (
          SELECT 1 FROM sot.cat_identifiers existing
          WHERE existing.id_value = ci.payload->>'Number'
            AND existing.id_type = 'clinichq_animal_id'
        )
      ORDER BY ci.payload->>'Number', ci.created_at DESC
    ),
    inserted_cats AS (
      INSERT INTO sot.cats (
        cat_id, name, sex, breed, primary_color, secondary_color,
        clinichq_animal_id, ownership_type, source_system, source_record_id,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(), ncc.name, LOWER(ncc.sex), ncc.breed, ncc.color, ncc.secondary_color,
        ncc.clinichq_animal_id, ncc.ownership_type, 'clinichq', ncc.clinichq_animal_id, NOW(), NOW()
      FROM no_chip_cats ncc
      RETURNING cat_id, clinichq_animal_id
    )
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
    SELECT ic.cat_id, 'clinichq_animal_id', ic.clinichq_animal_id, 'clinichq', NOW()
    FROM inserted_cats ic
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('cats_created_without_chip', v_count);

    -- CRITICAL: Step 3 — Link orphaned appointments to cats via microchip
    v_step := v_step + 1;
    UPDATE ops.appointments a
    SET cat_id = sot.get_canonical_cat_id(ci.cat_id)
    FROM ops.staged_records sr
    JOIN sot.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE a.appointment_number = sr.payload->>'Number'
      AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND a.cat_id IS NULL
      AND sr.payload->>'Microchip Number' IS NOT NULL
      AND TRIM(sr.payload->>'Microchip Number') != '';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('orphaned_appointments_linked', v_count);

    -- CRITICAL: Step 3b — Link appointments to cats via clinichq_animal_id
    v_step := v_step + 1;
    UPDATE ops.appointments a
    SET cat_id = sot.get_canonical_cat_id(ci.cat_id)
    FROM sot.cat_identifiers ci
    WHERE ci.id_value = a.appointment_number
      AND ci.id_type = 'clinichq_animal_id'
      AND a.cat_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('appointments_linked_by_animal_id', v_count);

    -- SUPPLEMENTARY: Step 4 — Extract weight vitals
    v_step := v_step + 1;
    BEGIN
      INSERT INTO ops.cat_vitals (
        cat_id, recorded_at, weight_lbs, source_system, source_record_id
      )
      SELECT DISTINCT ON (ci.cat_id)
        ci.cat_id,
        COALESCE((sr.payload->>'Date')::timestamp with time zone, NOW()),
        (sr.payload->>'Weight')::numeric(5,2),
        'clinichq',
        'cat_info_' || sr.source_row_id
      FROM ops.staged_records sr
      JOIN sot.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'cat_info'
        AND sr.file_upload_id = p_upload_id
        AND sr.payload->>'Weight' IS NOT NULL
        AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
        AND (sr.payload->>'Weight')::numeric > 0
        AND NOT EXISTS (
          SELECT 1 FROM ops.cat_vitals cv
          WHERE cv.cat_id = ci.cat_id AND cv.source_record_id = 'cat_info_' || sr.source_row_id
        )
      ORDER BY ci.cat_id, (sr.payload->>'Date')::date DESC NULLS LAST
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('weight_vitals_created', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('weight_vitals_error', SQLERRM);
    END;

  -- ==========================================================================
  -- owner_info post-processing
  -- ==========================================================================
  ELSIF p_source_table = 'owner_info' THEN

    -- CRITICAL: Step 0 — Create clinic_accounts for ALL owners
    v_step := v_step + 1;
    v_results := v_results || jsonb_build_object('_step_num', v_step, '_current_step', 'Creating clinic accounts...');
    UPDATE ops.file_uploads SET post_processing_results = v_results WHERE upload_id = p_upload_id;

    WITH all_owners AS (
      SELECT DISTINCT ON (
        COALESCE(LOWER(TRIM(payload->>'Owner First Name')), '') || '|' ||
        COALESCE(LOWER(TRIM(payload->>'Owner Last Name')), '') || '|' ||
        COALESCE(LOWER(TRIM(payload->>'Owner Email')), '') || '|' ||
        COALESCE(sot.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone')), '')
      )
        payload->>'Owner First Name' as first_name,
        payload->>'Owner Last Name' as last_name,
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
        sot.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone,
        NULLIF(TRIM(payload->>'Owner Address'), '') as address,
        payload->>'Number' as appointment_number
      FROM ops.staged_records
      WHERE source_system = 'clinichq'
        AND source_table = 'owner_info'
        AND file_upload_id = p_upload_id
        AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
      ORDER BY
        COALESCE(LOWER(TRIM(payload->>'Owner First Name')), '') || '|' ||
        COALESCE(LOWER(TRIM(payload->>'Owner Last Name')), '') || '|' ||
        COALESCE(LOWER(TRIM(payload->>'Owner Email')), '') || '|' ||
        COALESCE(sot.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone')), ''),
        (payload->>'Date')::date DESC NULLS LAST
    ),
    created_accounts AS (
      SELECT ao.*,
        ops.upsert_clinic_account_for_owner(
          ao.first_name, ao.last_name, ao.email, ao.phone, ao.address, ao.appointment_number, NULL
        ) as account_id
      FROM all_owners ao
    )
    SELECT COUNT(*) INTO v_count FROM created_accounts WHERE account_id IS NOT NULL;
    v_results := v_results || jsonb_build_object('clinic_accounts_created', v_count);

    -- CRITICAL: Step 1 — Create REAL PEOPLE
    v_step := v_step + 1;
    WITH owner_data AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), sot.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))))
        payload->>'Owner First Name' as first_name,
        payload->>'Owner Last Name' as last_name,
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
        sot.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone,
        NULLIF(TRIM(payload->>'Owner Address'), '') as address,
        payload->>'Number' as appointment_number
      FROM ops.staged_records
      WHERE source_system = 'clinichq'
        AND source_table = 'owner_info'
        AND file_upload_id = p_upload_id
        AND (
          (payload->>'Owner Email' IS NOT NULL AND TRIM(payload->>'Owner Email') != '')
          OR (payload->>'Owner Phone' IS NOT NULL AND TRIM(payload->>'Owner Phone') != '')
          OR (payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(payload->>'Owner Cell Phone') != '')
        )
        AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
        AND sot.should_be_person(
          payload->>'Owner First Name',
          payload->>'Owner Last Name',
          NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''),
          sot.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone'))
        )
      ORDER BY COALESCE(NULLIF(LOWER(TRIM(payload->>'Owner Email')), ''), sot.norm_phone_us(COALESCE(payload->>'Owner Cell Phone', payload->>'Owner Phone'))),
               (payload->>'Date')::date DESC NULLS LAST
    ),
    created_people AS (
      SELECT
        od.*, sot.find_or_create_person(od.email, od.phone, od.first_name, od.last_name, od.address, 'clinichq') as created_person_id
      FROM owner_data od
      WHERE od.first_name IS NOT NULL
    ),
    updated_accounts AS (
      UPDATE ops.clinic_accounts ca
      SET resolved_person_id = cp.created_person_id, account_type = 'resident', updated_at = NOW()
      FROM created_people cp
      WHERE ca.owner_first_name = cp.first_name
        AND COALESCE(ca.owner_last_name, '') = COALESCE(cp.last_name, '')
        AND (
          (cp.email IS NOT NULL AND ca.owner_email = cp.email)
          OR (cp.phone IS NOT NULL AND ca.owner_phone = cp.phone)
        )
        AND ca.merged_into_account_id IS NULL
        AND cp.created_person_id IS NOT NULL
      RETURNING ca.account_id
    )
    SELECT COUNT(*) INTO v_count FROM created_people WHERE created_person_id IS NOT NULL;
    v_results := v_results || jsonb_build_object('people_created_or_matched', v_count);

    -- CRITICAL: Step 2 — Create places from addresses
    v_step := v_step + 1;
    WITH owner_addresses AS (
      SELECT DISTINCT ON (TRIM(payload->>'Owner Address'))
        TRIM(payload->>'Owner Address') as address,
        NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
        sot.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone
      FROM ops.staged_records
      WHERE source_system = 'clinichq'
        AND source_table = 'owner_info'
        AND file_upload_id = p_upload_id
        AND payload->>'Owner Address' IS NOT NULL
        AND TRIM(payload->>'Owner Address') != ''
        AND LENGTH(TRIM(payload->>'Owner Address')) > 10
      ORDER BY TRIM(payload->>'Owner Address'), (payload->>'Date')::date DESC NULLS LAST
    ),
    created_places AS (
      SELECT oa.*,
        sot.find_or_create_place_deduped(oa.address, NULL, NULL, NULL, 'clinichq') as place_id
      FROM owner_addresses oa
    )
    SELECT COUNT(*) INTO v_count FROM created_places WHERE place_id IS NOT NULL;
    v_results := v_results || jsonb_build_object('places_created_or_matched', v_count);

    -- CRITICAL: Step 3 — Link people to places
    v_step := v_step + 1;
    -- MIG_3022: Added last_confirmed_at + ON CONFLICT UPDATE to bump freshness.
    -- Every ClinicHQ batch that re-reports an owner at an address bumps
    -- last_confirmed_at, so stale addresses naturally fall behind.
    INSERT INTO sot.person_place (person_id, place_id, relationship_type, confidence, source_system, source_table, last_confirmed_at)
    SELECT DISTINCT
      pi.person_id, p.place_id,
      CASE WHEN sot.is_excluded_from_cat_place_linking(pi.person_id) THEN 'trapper_at' ELSE 'resident' END,
      CASE WHEN sot.is_excluded_from_cat_place_linking(pi.person_id) THEN 0.3 ELSE 0.7 END,
      'clinichq', 'owner_info', NOW()
    FROM ops.staged_records sr
    JOIN sot.person_identifiers pi ON (
      (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
      OR (pi.id_type = 'phone' AND pi.id_value_norm = sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
    )
    JOIN sot.places p ON p.normalized_address = sot.normalize_address(sr.payload->>'Owner Address')
      AND p.merged_into_place_id IS NULL
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.file_upload_id = p_upload_id
      AND sr.payload->>'Owner Address' IS NOT NULL
      AND TRIM(sr.payload->>'Owner Address') != ''
    ON CONFLICT (person_id, place_id, relationship_type) DO UPDATE SET
      last_confirmed_at = NOW(),
      updated_at = NOW();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('person_place_links', v_count);

    -- CRITICAL: Step 4 — Link appointments to people
    v_step := v_step + 1;
    UPDATE ops.appointments a
    SET person_id = pi.person_id
    FROM ops.staged_records sr
    JOIN sot.person_identifiers pi ON (
      (pi.id_type = 'email'
       AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '')
       AND NOT EXISTS (
         SELECT 1 FROM sot.data_engine_soft_blacklist sbl
         WHERE sbl.identifier_norm = pi.id_value_norm AND sbl.identifier_type = 'email'
       )
      )
      OR (pi.id_type = 'phone'
       AND pi.id_value_norm = sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
       AND NOT EXISTS (
         SELECT 1 FROM sot.data_engine_soft_blacklist sbl
         WHERE sbl.identifier_norm = pi.id_value_norm AND sbl.identifier_type = 'phone'
       )
       AND (
         sr.payload->>'Owner Address' IS NULL
         OR sr.payload->>'Owner Address' = ''
         OR EXISTS (
           SELECT 1 FROM sot.people p2
           JOIN sot.places pl ON pl.place_id = p2.primary_address_id
           WHERE p2.person_id = pi.person_id
             AND pl.formatted_address IS NOT NULL
             AND similarity(LOWER(pl.formatted_address), LOWER(sr.payload->>'Owner Address')) > 0.5
         )
         OR NOT EXISTS (
           SELECT 1 FROM sot.people p3
           WHERE p3.person_id = pi.person_id AND p3.primary_address_id IS NOT NULL
         )
       )
      )
    )
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.file_upload_id = p_upload_id
      AND a.appointment_number = sr.payload->>'Number'
      AND a.person_id IS NULL
      -- FFS-747: Do NOT set person_id when appointment belongs to org/site/address account
      AND NOT EXISTS (
        SELECT 1 FROM ops.clinic_accounts ca
        WHERE ca.account_id = a.owner_account_id
          AND ca.account_type IN ('organization', 'site_name', 'address')
          AND ca.resolved_person_id IS NULL
          AND ca.merged_into_account_id IS NULL
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('appointments_linked_to_people', v_count);

    -- SUPPLEMENTARY: Step 4c — Backfill owner fields
    v_step := v_step + 1;
    BEGIN
      UPDATE ops.appointments a
      SET
        client_name = NULLIF(TRIM(
          COALESCE(NULLIF(TRIM(sr.payload->>'Owner First Name'), ''), '') || ' ' ||
          COALESCE(NULLIF(TRIM(sr.payload->>'Owner Last Name'), ''), '')
        ), ''),
        owner_email = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
        owner_phone = sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Phone', ''), sr.payload->>'Owner Cell Phone')),
        owner_first_name = COALESCE(NULLIF(TRIM(sr.payload->>'Owner First Name'), ''), a.owner_first_name),
        owner_last_name = COALESCE(NULLIF(TRIM(sr.payload->>'Owner Last Name'), ''), a.owner_last_name),
        owner_address = COALESCE(NULLIF(TRIM(sr.payload->>'Owner Address'), ''), a.owner_address)
      FROM ops.staged_records sr
      WHERE sr.source_system = 'clinichq'
        AND sr.source_table = 'owner_info'
        AND sr.file_upload_id = p_upload_id
        AND sr.payload->>'Number' = a.appointment_number
        AND (a.client_name IS NULL OR a.owner_email IS NULL OR a.owner_phone IS NULL
             OR a.owner_first_name IS NULL OR a.owner_last_name IS NULL OR a.owner_address IS NULL)
        AND (sr.payload->>'Owner First Name' IS NOT NULL OR sr.payload->>'Owner Last Name' IS NOT NULL
             OR sr.payload->>'Owner Email' IS NOT NULL OR sr.payload->>'Owner Phone' IS NOT NULL
             OR sr.payload->>'Owner Cell Phone' IS NOT NULL OR sr.payload->>'Owner Address' IS NOT NULL);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('owner_fields_backfilled', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('owner_fields_backfill_error', SQLERRM);
    END;

    -- CRITICAL: Step 4b — Link ALL appointments to clinic_accounts
    v_step := v_step + 1;
    UPDATE ops.appointments a
    SET owner_account_id = ca.account_id
    FROM ops.staged_records sr
    JOIN ops.clinic_accounts ca ON (
      ca.owner_first_name = sr.payload->>'Owner First Name'
      AND COALESCE(ca.owner_last_name, '') = COALESCE(sr.payload->>'Owner Last Name', '')
      AND (
        (sr.payload->>'Owner Email' IS NOT NULL AND ca.owner_email = LOWER(TRIM(sr.payload->>'Owner Email')))
        OR (sr.payload->>'Owner Phone' IS NOT NULL AND ca.owner_phone = sot.norm_phone_us(sr.payload->>'Owner Phone'))
        OR (sr.payload->>'Owner Cell Phone' IS NOT NULL AND ca.owner_phone = sot.norm_phone_us(sr.payload->>'Owner Cell Phone'))
        OR (sr.payload->>'Owner Email' IS NULL AND sr.payload->>'Owner Phone' IS NULL AND sr.payload->>'Owner Cell Phone' IS NULL
            AND ca.owner_email IS NULL AND ca.owner_phone IS NULL)
      )
      AND ca.merged_into_account_id IS NULL
    )
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.file_upload_id = p_upload_id
      AND a.appointment_number = sr.payload->>'Number'
      AND a.owner_account_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('appointments_linked_to_accounts', v_count);

    -- SUPPLEMENTARY: Step 4d — Owner change detection (legacy)
    v_step := v_step + 1;
    BEGIN
      INSERT INTO ops.review_queue (
        entity_type, entity_id, review_type, priority, status, notes,
        old_person_id, match_confidence, change_context, source_system, source_record_id
      )
      SELECT
        'person', a.person_id,
        CASE
          WHEN pi_email.id_value_norm IS NOT NULL AND NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '') IS NOT NULL
               AND pi_email.id_value_norm != NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '')
               AND pi_phone.id_value_norm IS NOT NULL
               AND sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')) IS NOT NULL
               AND pi_phone.id_value_norm != sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
          THEN 'owner_transfer' ELSE 'owner_change'
        END,
        CASE
          WHEN pi_email.id_value_norm != NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '')
               AND pi_phone.id_value_norm != sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
          THEN 10 ELSE 5
        END,
        'pending',
        'Owner info change detected via batch ingest: ' || COALESCE(p.display_name, 'unknown') || ' → ' ||
          COALESCE(TRIM((sr.payload->>'Owner First Name') || ' ' || (sr.payload->>'Owner Last Name')), 'unknown'),
        a.person_id, 0.60,
        jsonb_build_object(
          'old_name', p.display_name,
          'new_name', TRIM((sr.payload->>'Owner First Name') || ' ' || (sr.payload->>'Owner Last Name')),
          'old_email', pi_email.id_value_norm,
          'new_email', NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
          'old_phone', pi_phone.id_value_norm,
          'new_phone', sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')),
          'appointment_number', sr.payload->>'Number',
          'detection_source', 'batch_ingest'
        ),
        'clinichq', sr.payload->>'Number'
      FROM ops.staged_records sr
      JOIN ops.appointments a ON a.appointment_number = sr.payload->>'Number' AND a.person_id IS NOT NULL
      JOIN sot.people p ON p.person_id = a.person_id
      LEFT JOIN sot.person_identifiers pi_email ON pi_email.person_id = a.person_id AND pi_email.id_type = 'email' AND pi_email.confidence >= 0.5
      LEFT JOIN sot.person_identifiers pi_phone ON pi_phone.person_id = a.person_id AND pi_phone.id_type = 'phone'
      WHERE sr.source_system = 'clinichq' AND sr.source_table = 'owner_info' AND sr.file_upload_id = p_upload_id
        AND (
          (pi_email.id_value_norm IS NOT NULL AND NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '') IS NOT NULL
           AND pi_email.id_value_norm != NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
          OR
          (pi_phone.id_value_norm IS NOT NULL
           AND sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')) IS NOT NULL
           AND pi_phone.id_value_norm != sot.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'))
           AND (pi_email.id_value_norm IS NULL OR NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '') IS NULL
                OR pi_email.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '')))
        )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('owner_changes_detected_legacy', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('owner_change_detection_legacy_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Step 4e — Classify FFSC program bookings
    v_step := v_step + 1;
    BEGIN
      UPDATE ops.appointments a
      SET ffsc_program = ops.classify_ffsc_booking(a.client_name)
      WHERE a.ffsc_program IS NULL
        AND a.client_name IS NOT NULL
        AND ops.classify_ffsc_booking(a.client_name) IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ops.staged_records sr
          WHERE sr.file_upload_id = p_upload_id AND sr.source_table = 'owner_info'
            AND sr.payload->>'Number' = a.appointment_number
        );
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('ffsc_bookings_classified', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('ffsc_classification_error', SQLERRM);
    END;

    -- CRITICAL: Step 5 — Link cats to people via appointments
    v_step := v_step + 1;
    INSERT INTO sot.person_cat (cat_id, person_id, relationship_type, confidence, source_system, source_table)
    SELECT DISTINCT a.cat_id, a.person_id, 'caretaker', 0.8, 'clinichq', 'owner_info'
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.person_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = a.cat_id AND pc.person_id = a.person_id
      )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('cat_person_links', v_count);

    -- SUPPLEMENTARY: Step 6 — Detect owner changes (function)
    v_step := v_step + 1;
    BEGIN
      SELECT * INTO v_count FROM ops.detect_owner_changes(p_upload_id);
      -- detect_owner_changes returns a record; extract from result
      v_results := v_results || jsonb_build_object('owner_changes_v2', 'completed');
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('owner_change_detection_error', SQLERRM);
    END;

  -- ==========================================================================
  -- appointment_info post-processing
  -- ==========================================================================
  ELSIF p_source_table = 'appointment_info' THEN

    -- CRITICAL: Step 0 — Link orphaned appointments (pre-link)
    v_step := v_step + 1;
    v_results := v_results || jsonb_build_object('_step_num', v_step, '_current_step', 'Pre-linking orphaned appointments...');
    UPDATE ops.file_uploads SET post_processing_results = v_results WHERE upload_id = p_upload_id;

    UPDATE ops.appointments a
    SET cat_id = sot.get_canonical_cat_id(ci.cat_id)
    FROM ops.staged_records sr
    JOIN sot.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE a.appointment_number = sr.payload->>'Number'
      AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND sr.file_upload_id = p_upload_id
      AND a.cat_id IS NULL
      AND sr.payload->>'Microchip Number' IS NOT NULL
      AND TRIM(sr.payload->>'Microchip Number') != '';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('orphaned_appointments_linked_pre', v_count);

    -- CRITICAL: Step 1 — Create/update appointments
    v_step := v_step + 1;
    INSERT INTO ops.appointments (
      cat_id, appointment_date, appointment_number, service_type,
      is_spay, is_neuter, is_alteration, vet_name, technician, temperature, medical_notes,
      is_lactating, is_pregnant, is_in_heat,
      has_uri, has_dental_disease, has_ear_issue, has_eye_issue,
      has_skin_issue, has_mouth_issue, has_fleas, has_ticks,
      has_tapeworms, has_ear_mites, has_ringworm,
      has_polydactyl, has_bradycardia, has_too_young_for_rabies,
      has_cryptorchid, has_hernia, has_pyometra, has_ear_tip,
      felv_fiv_result, body_composition_score, no_surgery_reason, death_type,
      total_invoiced, subsidy_value, clinichq_appointment_id,
      data_source, source_system, source_record_id, source_row_hash
    )
    SELECT
      sot.get_canonical_cat_id(c.cat_id),
      TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'),
      sr.payload->>'Number',
      COALESCE(sr.payload->>'All Services', sr.payload->>'Service / Subsidy'),
      sot.is_positive_value(sr.payload->>'Spay'),
      sot.is_positive_value(sr.payload->>'Neuter'),
      sot.is_positive_value(sr.payload->>'Spay') OR sot.is_positive_value(sr.payload->>'Neuter'),
      sr.payload->>'Vet Name',
      sr.payload->>'Technician',
      CASE WHEN sr.payload->>'Temperature' ~ '^[0-9]+\.?[0-9]*$' THEN (sr.payload->>'Temperature')::NUMERIC(4,1) ELSE NULL END,
      sr.payload->>'Internal Medical Notes',
      sot.is_positive_value(sr.payload->>'Lactating') OR sot.is_positive_value(sr.payload->>'Lactating_2'),
      sot.is_positive_value(sr.payload->>'Pregnant'),
      sot.is_positive_value(sr.payload->>'In Heat'),
      sot.is_positive_value(COALESCE(sr.payload->>'URI', sr.payload->>'Upper Respiratory Issue')),
      sot.is_positive_value(sr.payload->>'Dental Disease'),
      sot.is_positive_value(COALESCE(sr.payload->>'Ear Issue', sr.payload->>'Ear infections')),
      sot.is_positive_value(sr.payload->>'Eye Issue'),
      sot.is_positive_value(sr.payload->>'Skin Issue'),
      sot.is_positive_value(sr.payload->>'Mouth Issue'),
      sot.is_positive_value(COALESCE(sr.payload->>'Fleas', sr.payload->>'Fleas/Ticks')),
      sot.is_positive_value(sr.payload->>'Ticks'),
      sot.is_positive_value(sr.payload->>'Tapeworms'),
      sot.is_positive_value(sr.payload->>'Ear mites'),
      sot.is_positive_value(sr.payload->>'Wood''s Lamp Ringworm Test'),
      sot.is_positive_value(sr.payload->>'Polydactyl'),
      sot.is_positive_value(sr.payload->>'Bradycardia Intra-Op'),
      sot.is_positive_value(sr.payload->>'Too young for rabies'),
      sot.is_positive_value(sr.payload->>'Cryptorchid'),
      sot.is_positive_value(sr.payload->>'Hernia'),
      sot.is_positive_value(sr.payload->>'Pyometra'),
      COALESCE(sr.payload->>'All Services', sr.payload->>'Service / Subsidy') ILIKE '%ear tip%',
      NULLIF(TRIM(sr.payload->>'FeLV/FIV (SNAP test, in-house)'), ''),
      NULLIF(TRIM(sr.payload->>'Body Composition Score'), ''),
      NULLIF(TRIM(sr.payload->>'No Surgery Reason'), ''),
      NULLIF(TRIM(sr.payload->>'Death Type'), ''),
      CASE WHEN sr.payload->>'Total Invoiced' ~ '^[\$]?[0-9]+\.?[0-9]*$'
           THEN REPLACE(sr.payload->>'Total Invoiced', '$', '')::NUMERIC(10,2) ELSE NULL END,
      CASE WHEN sr.payload->>'Sub Value' ~ '^[\$]?[0-9]+\.?[0-9]*$'
           THEN REPLACE(sr.payload->>'Sub Value', '$', '')::NUMERIC(10,2) ELSE NULL END,
      TO_CHAR(TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'), 'YYYY-MM-DD') || '_' || (sr.payload->>'Microchip Number'),
      'clinichq', 'clinichq',
      (sr.payload->>'Number') || '_' ||
        EXTRACT(MONTH FROM TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'))::INT || '-' ||
        EXTRACT(DAY FROM TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'))::INT || '-' ||
        EXTRACT(YEAR FROM TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'))::INT,
      sr.row_hash
    FROM ops.staged_records sr
    LEFT JOIN sot.cat_identifiers ci_mc ON ci_mc.id_value = sr.payload->>'Microchip Number' AND ci_mc.id_type = 'microchip'
    LEFT JOIN sot.cat_identifiers ci_aid ON ci_aid.id_value = sr.payload->>'Number' AND ci_aid.id_type = 'clinichq_animal_id'
    LEFT JOIN sot.cats c ON c.cat_id = COALESCE(ci_mc.cat_id, ci_aid.cat_id)
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND sr.file_upload_id = p_upload_id
      AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
      AND sr.payload->>'Number' IS NOT NULL AND sr.payload->>'Number' != ''
    ON CONFLICT (appointment_number, appointment_date)
      WHERE appointment_number IS NOT NULL
    DO UPDATE SET
      cat_id = COALESCE(EXCLUDED.cat_id, ops.appointments.cat_id),
      service_type = CASE
        WHEN ops.appointments.service_type IS NULL THEN EXCLUDED.service_type
        WHEN EXCLUDED.service_type IS NOT NULL AND ops.appointments.service_type NOT ILIKE '%' || EXCLUDED.service_type || '%'
        THEN ops.appointments.service_type || '; ' || EXCLUDED.service_type
        ELSE ops.appointments.service_type
      END,
      has_uri = ops.appointments.has_uri OR EXCLUDED.has_uri,
      has_dental_disease = ops.appointments.has_dental_disease OR EXCLUDED.has_dental_disease,
      has_ear_issue = ops.appointments.has_ear_issue OR EXCLUDED.has_ear_issue,
      has_eye_issue = ops.appointments.has_eye_issue OR EXCLUDED.has_eye_issue,
      has_skin_issue = ops.appointments.has_skin_issue OR EXCLUDED.has_skin_issue,
      has_mouth_issue = ops.appointments.has_mouth_issue OR EXCLUDED.has_mouth_issue,
      has_fleas = ops.appointments.has_fleas OR EXCLUDED.has_fleas,
      has_ticks = ops.appointments.has_ticks OR EXCLUDED.has_ticks,
      has_tapeworms = ops.appointments.has_tapeworms OR EXCLUDED.has_tapeworms,
      has_ear_mites = ops.appointments.has_ear_mites OR EXCLUDED.has_ear_mites,
      has_ringworm = ops.appointments.has_ringworm OR EXCLUDED.has_ringworm,
      has_polydactyl = ops.appointments.has_polydactyl OR EXCLUDED.has_polydactyl,
      has_bradycardia = ops.appointments.has_bradycardia OR EXCLUDED.has_bradycardia,
      has_too_young_for_rabies = ops.appointments.has_too_young_for_rabies OR EXCLUDED.has_too_young_for_rabies,
      has_cryptorchid = ops.appointments.has_cryptorchid OR EXCLUDED.has_cryptorchid,
      has_hernia = ops.appointments.has_hernia OR EXCLUDED.has_hernia,
      has_pyometra = ops.appointments.has_pyometra OR EXCLUDED.has_pyometra,
      has_ear_tip = ops.appointments.has_ear_tip OR EXCLUDED.has_ear_tip,
      felv_fiv_result = COALESCE(ops.appointments.felv_fiv_result, EXCLUDED.felv_fiv_result),
      body_composition_score = COALESCE(ops.appointments.body_composition_score, EXCLUDED.body_composition_score),
      no_surgery_reason = COALESCE(ops.appointments.no_surgery_reason, EXCLUDED.no_surgery_reason),
      death_type = COALESCE(EXCLUDED.death_type, ops.appointments.death_type),
      total_invoiced = COALESCE(ops.appointments.total_invoiced, EXCLUDED.total_invoiced),
      subsidy_value = COALESCE(ops.appointments.subsidy_value, EXCLUDED.subsidy_value),
      clinichq_appointment_id = COALESCE(ops.appointments.clinichq_appointment_id, EXCLUDED.clinichq_appointment_id),
      source_row_hash = EXCLUDED.source_row_hash,
      updated_at = NOW();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('new_appointments', v_count);

    -- CRITICAL: Create spay procedures
    v_step := v_step + 1;
    INSERT INTO ops.cat_procedures (
      cat_id, appointment_id, procedure_type, procedure_date, status,
      performed_by, technician, is_spay, is_neuter, source_system, source_record_id
    )
    SELECT a.cat_id, a.appointment_id, 'spay', a.appointment_date, 'completed',
           a.vet_name, a.technician, TRUE, FALSE, 'clinichq', a.appointment_number
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.service_type ILIKE '%spay%'
      AND NOT EXISTS (
        SELECT 1 FROM ops.cat_procedures cp WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE
      )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('new_spays', v_count);

    -- CRITICAL: Create neuter procedures
    v_step := v_step + 1;
    INSERT INTO ops.cat_procedures (
      cat_id, appointment_id, procedure_type, procedure_date, status,
      performed_by, technician, is_spay, is_neuter, source_system, source_record_id
    )
    SELECT a.cat_id, a.appointment_id, 'neuter', a.appointment_date, 'completed',
           a.vet_name, a.technician, FALSE, TRUE, 'clinichq', a.appointment_number
    FROM ops.appointments a
    WHERE a.cat_id IS NOT NULL AND a.service_type ILIKE '%neuter%'
      AND NOT EXISTS (
        SELECT 1 FROM ops.cat_procedures cp WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE
      )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('new_neuters', v_count);

    -- CRITICAL: Create test results
    v_step := v_step + 1;
    INSERT INTO ops.cat_test_results (
      cat_id, appointment_id, test_type, test_date, result, result_detail,
      felv_status, fiv_status, source_system, source_record_id
    )
    SELECT
      a.cat_id, a.appointment_id, 'felv_fiv_combo', a.appointment_date,
      CASE
        WHEN a.felv_fiv_result ILIKE '%positive%' THEN 'positive'::ops.test_result
        WHEN a.felv_fiv_result ILIKE '%negative%' THEN 'negative'::ops.test_result
        ELSE 'inconclusive'::ops.test_result
      END,
      a.felv_fiv_result,
      CASE WHEN SPLIT_PART(a.felv_fiv_result, '/', 1) ILIKE '%positive%' THEN 'positive'
           WHEN SPLIT_PART(a.felv_fiv_result, '/', 1) ILIKE '%negative%' THEN 'negative' ELSE NULL END,
      CASE WHEN SPLIT_PART(a.felv_fiv_result, '/', 2) ILIKE '%positive%' THEN 'positive'
           WHEN SPLIT_PART(a.felv_fiv_result, '/', 2) ILIKE '%negative%' THEN 'negative' ELSE NULL END,
      'clinichq', a.appointment_number
    FROM ops.appointments a
    WHERE a.felv_fiv_result IS NOT NULL AND a.felv_fiv_result != '' AND a.cat_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ops.cat_test_results ctr
        WHERE ctr.appointment_id = a.appointment_id AND ctr.test_type = 'felv_fiv_combo'
      )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_results := v_results || jsonb_build_object('test_results_created', v_count);

    -- SUPPLEMENTARY: Fix procedures by sex
    v_step := v_step + 1;
    BEGIN
      UPDATE ops.cat_procedures cp SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
      FROM sot.cats c WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE AND LOWER(c.sex) = 'male';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE ops.cat_procedures cp SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
      FROM sot.cats c WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE AND LOWER(c.sex) = 'female';
      GET DIAGNOSTICS v_count2 = ROW_COUNT;
      v_results := v_results || jsonb_build_object('fixed_males', v_count, 'fixed_females', v_count2);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('fix_procedures_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Update altered_status
    v_step := v_step + 1;
    BEGIN
      UPDATE sot.cats c SET altered_status = 'spayed'
      FROM ops.appointments a WHERE a.cat_id = c.cat_id AND a.is_spay = TRUE
        AND LOWER(c.sex) = 'female' AND c.altered_status IS DISTINCT FROM 'spayed';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      UPDATE sot.cats c SET altered_status = 'neutered'
      FROM ops.appointments a WHERE a.cat_id = c.cat_id AND a.is_neuter = TRUE
        AND LOWER(c.sex) = 'male' AND c.altered_status IS DISTINCT FROM 'neutered';
      GET DIAGNOSTICS v_count2 = ROW_COUNT;
      v_results := v_results || jsonb_build_object('marked_altered', v_count + v_count2);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('altered_status_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Enrich with weight/age
    v_step := v_step + 1;
    BEGIN
      UPDATE ops.appointments a
      SET
        cat_weight_lbs = CASE WHEN ci.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
          THEN (ci.payload->>'Weight')::NUMERIC(5,2) ELSE a.cat_weight_lbs END,
        cat_age_years = CASE WHEN ci.payload->>'Age Years' ~ '^[0-9]+$'
          THEN (ci.payload->>'Age Years')::INTEGER ELSE a.cat_age_years END,
        cat_age_months = CASE WHEN ci.payload->>'Age Months' ~ '^[0-9]+\.?[0-9]*$'
          THEN ROUND((ci.payload->>'Age Months')::NUMERIC)::INTEGER ELSE a.cat_age_months END,
        updated_at = NOW()
      FROM ops.staged_records ci
      JOIN ops.file_uploads fu_ci ON fu_ci.upload_id = ci.file_upload_id
      JOIN ops.file_uploads fu_me ON fu_me.batch_id = fu_ci.batch_id
      WHERE ci.source_system = 'clinichq' AND ci.source_table = 'cat_info'
        AND fu_me.upload_id = p_upload_id
        AND ci.payload->>'Microchip Number' = SPLIT_PART(a.clinichq_appointment_id, '_', 2)
        AND TO_DATE(ci.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
        AND (a.cat_weight_lbs IS NULL OR a.cat_age_years IS NULL OR a.cat_age_months IS NULL);
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('enriched_with_weight', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('enrich_weight_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Altered status 2nd pass
    v_step := v_step + 1;
    BEGIN
      UPDATE sot.cats c SET altered_status = 'spayed'
      WHERE c.altered_status IS DISTINCT FROM 'spayed'
        AND EXISTS (SELECT 1 FROM ops.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE);
      UPDATE sot.cats c SET altered_status = 'neutered'
      WHERE c.altered_status IS DISTINCT FROM 'neutered'
        AND EXISTS (SELECT 1 FROM ops.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('altered_status_2_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Link to trappers
    v_step := v_step + 1;
    BEGIN
      PERFORM sot.link_appointments_to_trappers();
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('trapper_linking_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Extract embedded microchips
    v_step := v_step + 1;
    BEGIN
      PERFORM ops.extract_and_link_microchips_from_animal_name();
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('embedded_microchip_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Create appointment vitals
    v_step := v_step + 1;
    BEGIN
      INSERT INTO ops.cat_vitals (
        cat_id, appointment_id, recorded_at,
        temperature_f, is_pregnant, is_lactating, is_in_heat,
        source_system, source_record_id
      )
      SELECT a.cat_id, a.appointment_id, a.appointment_date::timestamp with time zone,
             a.temperature, a.is_pregnant, a.is_lactating, a.is_in_heat,
             'clinichq', 'appointment_' || a.appointment_number
      FROM ops.appointments a
      WHERE a.cat_id IS NOT NULL
        AND (a.temperature IS NOT NULL OR a.is_pregnant = TRUE OR a.is_lactating = TRUE OR a.is_in_heat = TRUE)
        AND NOT EXISTS (SELECT 1 FROM ops.cat_vitals cv WHERE cv.appointment_id = a.appointment_id)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_results := v_results || jsonb_build_object('appointment_vitals_created', v_count);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('vitals_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Flow observations
    v_step := v_step + 1;
    BEGIN
      PERFORM ops.flow_appointment_observations();
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('observations_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Sync cat attributes
    v_step := v_step + 1;
    BEGIN
      PERFORM ops.sync_cats_from_appointments();
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('cat_sync_error', SQLERRM);
    END;

    -- SUPPLEMENTARY: Queue AI extraction
    v_step := v_step + 1;
    BEGIN
      PERFORM ops.queue_appointment_extraction(100, 10);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('ai_queue_error', SQLERRM);
    END;

  END IF; -- source_table dispatch

  -- Update final results
  v_results := v_results || jsonb_build_object('_step_num', v_step, '_current_step', 'completed');
  UPDATE ops.file_uploads SET post_processing_results = v_results WHERE upload_id = p_upload_id;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.run_clinichq_post_processing(UUID, TEXT) IS
  'FFS-736: Stored procedure for ClinicHQ post-processing. Runs all entity creation, '
  'linking, and enrichment steps in the database (no timeout). Called per-file after staging.';
