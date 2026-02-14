-- MIG_313: ClinicHQ SQL Processor Functions
--
-- Converts TypeScript processing logic from /api/ingest/process/[id]/route.ts
-- into SQL functions for the unified processing pipeline.
--
-- These functions process staged_records and create/link SOT entities.
-- They are designed to be idempotent and order-independent.
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_313__clinichq_sql_processors.sql

\echo ''
\echo '=============================================='
\echo 'MIG_313: ClinicHQ SQL Processor Functions'
\echo '=============================================='
\echo ''

-- ==============================================================
-- PHASE 1: Process cat_info
-- ==============================================================

\echo 'Creating process_clinichq_cat_info function...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_cat_info(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 1: Create cats from microchips using find_or_create_cat_by_microchip
  WITH cat_data AS (
    SELECT DISTINCT ON (payload->>'Microchip Number')
      payload->>'Microchip Number' as microchip,
      NULLIF(TRIM(payload->>'Patient Name'), '') as name,
      NULLIF(TRIM(payload->>'Sex'), '') as sex,
      NULLIF(TRIM(payload->>'Breed'), '') as breed,
      NULLIF(TRIM(payload->>'Color'), '') as color
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'cat_info'
      AND payload->>'Microchip Number' IS NOT NULL
      AND TRIM(payload->>'Microchip Number') != ''
      AND LENGTH(TRIM(payload->>'Microchip Number')) >= 9
      AND processed_at IS NULL
    ORDER BY payload->>'Microchip Number', created_at DESC
    LIMIT p_batch_size
  ),
  created_cats AS (
    SELECT
      cd.*,
      trapper.find_or_create_cat_by_microchip(
        cd.microchip,
        cd.name,
        cd.sex,
        cd.breed,
        NULL,  -- altered_status
        cd.color,
        NULL,  -- secondary_color
        NULL,  -- ownership_type
        'clinichq'
      ) as cat_id
    FROM cat_data cd
    WHERE cd.microchip IS NOT NULL
  )
  SELECT COUNT(*) INTO v_count FROM created_cats WHERE cat_id IS NOT NULL;
  v_results := v_results || jsonb_build_object('cats_created_or_matched', v_count);

  -- Step 2: Update sex on existing cats from cat_info records
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET sex = sr.payload->>'Sex'
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE ci.cat_id = c.cat_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND sr.payload->>'Sex' IS NOT NULL
      AND sr.payload->>'Sex' != ''
      AND LOWER(c.sex) IS DISTINCT FROM LOWER(sr.payload->>'Sex')
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('sex_updates', v_count);

  -- Step 3: Link orphaned appointments to cats via microchip
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE a.appointment_number = sr.payload->>'Number'
      AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND a.cat_id IS NULL
      AND sr.payload->>'Microchip Number' IS NOT NULL
      AND TRIM(sr.payload->>'Microchip Number') != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('orphaned_appointments_linked', v_count);

  -- Step 4: Extract weight from cat_info into cat_vitals
  WITH inserts AS (
    INSERT INTO trapper.cat_vitals (
      cat_id, recorded_at, weight_lbs, source_system, source_record_id
    )
    SELECT DISTINCT ON (ci.cat_id)
      ci.cat_id,
      COALESCE(
        (sr.payload->>'Date')::timestamp with time zone,
        NOW()
      ),
      (sr.payload->>'Weight')::numeric(5,2),
      'clinichq',
      'cat_info_' || sr.source_row_id
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON
      ci.id_value = sr.payload->>'Microchip Number'
      AND ci.id_type = 'microchip'
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND sr.payload->>'Weight' IS NOT NULL
      AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
      AND (sr.payload->>'Weight')::numeric > 0
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_vitals cv
        WHERE cv.cat_id = ci.cat_id
          AND cv.source_record_id = 'cat_info_' || sr.source_row_id
      )
    ORDER BY ci.cat_id, (sr.payload->>'Date')::date DESC NULLS LAST
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('weight_vitals_created', v_count);

  -- Mark records as processed
  UPDATE trapper.staged_records
  SET processed_at = NOW()
  WHERE source_system = 'clinichq'
    AND source_table = 'cat_info'
    AND processed_at IS NULL
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND LENGTH(TRIM(payload->>'Microchip Number')) >= 9;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_cat_info IS
'Process ClinicHQ cat_info staged records.
- Creates cats via find_or_create_cat_by_microchip
- Updates sex on existing cats
- Links orphaned appointments to cats
- Extracts weight into cat_vitals

Idempotent and safe to re-run.';

-- ==============================================================
-- PHASE 2: Process owner_info
-- ==============================================================

\echo 'Creating process_clinichq_owner_info function...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_owner_info(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 1: Create people using find_or_create_person
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
      AND (
        (payload->>'Owner Email' IS NOT NULL AND TRIM(payload->>'Owner Email') != '')
        OR (payload->>'Owner Phone' IS NOT NULL AND TRIM(payload->>'Owner Phone') != '')
        OR (payload->>'Owner Cell Phone' IS NOT NULL AND TRIM(payload->>'Owner Cell Phone') != '')
      )
      AND (payload->>'Owner First Name' IS NOT NULL AND TRIM(payload->>'Owner First Name') != '')
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

  -- Step 2: Create places from owner addresses
  WITH owner_addresses AS (
    SELECT DISTINCT ON (TRIM(payload->>'Owner Address'))
      TRIM(payload->>'Owner Address') as address,
      NULLIF(LOWER(TRIM(payload->>'Owner Email')), '') as email,
      trapper.norm_phone_us(COALESCE(NULLIF(payload->>'Owner Cell Phone', ''), payload->>'Owner Phone')) as phone
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_table = 'owner_info'
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

  -- Step 3: Link people to places via person_place_relationships
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

  -- Step 4: Backfill owner_email and owner_phone on appointments
  -- This is the CRITICAL fix for the CLI pipeline bug
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      owner_email = LOWER(TRIM(sr.payload->>'Owner Email')),
      owner_phone = trapper.norm_phone_us(sr.payload->>'Owner Phone')
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.payload->>'Number' = a.appointment_number
      AND a.owner_email IS NULL
      AND sr.payload->>'Owner Email' IS NOT NULL
      AND sr.payload->>'Owner Email' != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_owner_backfilled', v_count);

  -- Step 5: Link people to appointments via email/phone match
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
      AND a.appointment_number = sr.payload->>'Number'
      AND a.person_id IS NULL
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_linked_to_people', v_count);

  -- Step 6: Link cats to people via appointments
  WITH inserts AS (
    INSERT INTO trapper.person_cat_relationships (cat_id, person_id, relationship_type, confidence, source_system, source_table)
    SELECT DISTINCT
      a.cat_id,
      a.person_id,
      'caretaker',
      'high',
      'clinichq',
      'owner_info'
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.person_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships cpr
        WHERE cpr.cat_id = a.cat_id AND cpr.person_id = a.person_id
      )
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('cat_person_links', v_count);

  -- Mark records as processed
  UPDATE trapper.staged_records
  SET processed_at = NOW()
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND processed_at IS NULL;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_owner_info IS
'Process ClinicHQ owner_info staged records.
- Creates people via find_or_create_person
- Creates places via find_or_create_place_deduped
- Links people to places
- CRITICAL: Backfills owner_email/phone on appointments (fixes CLI pipeline bug)
- Links people to appointments
- Creates person-cat relationships

Idempotent and safe to re-run.';

-- ==============================================================
-- PHASE 3: Process appointment_info
-- ==============================================================

\echo 'Creating process_clinichq_appointment_info function...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_appointment_info(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 0: Link orphaned appointments to cats (in case cat_info was processed first)
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET cat_id = trapper.get_canonical_cat_id(ci.cat_id)
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE a.appointment_number = sr.payload->>'Number'
      AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND a.cat_id IS NULL
      AND sr.payload->>'Microchip Number' IS NOT NULL
      AND TRIM(sr.payload->>'Microchip Number') != ''
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('orphaned_appointments_linked_pre', v_count);

  -- Step 1: Create sot_appointments from staged_records
  WITH inserts AS (
    INSERT INTO trapper.sot_appointments (
      cat_id, appointment_date, appointment_number, service_type,
      is_spay, is_neuter, vet_name, technician, temperature, medical_notes,
      is_lactating, is_pregnant, is_in_heat,
      data_source, source_system, source_record_id, source_row_hash
    )
    SELECT
      trapper.get_canonical_cat_id(c.cat_id),
      TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY'),
      sr.payload->>'Number',
      COALESCE(sr.payload->>'All Services', sr.payload->>'Service / Subsidy'),
      sr.payload->>'Spay' = 'Yes',
      sr.payload->>'Neuter' = 'Yes',
      sr.payload->>'Vet Name',
      sr.payload->>'Technician',
      CASE WHEN sr.payload->>'Temperature' ~ '^[0-9]+\.?[0-9]*$'
           THEN (sr.payload->>'Temperature')::NUMERIC(4,1)
           ELSE NULL END,
      sr.payload->>'Internal Medical Notes',
      sr.payload->>'Lactating' = 'Yes' OR sr.payload->>'Lactating_2' = 'Yes',
      sr.payload->>'Pregnant' = 'Yes',
      sr.payload->>'In Heat' = 'Yes',
      'clinichq', 'clinichq', sr.source_row_id, sr.row_hash
    FROM trapper.staged_records sr
    LEFT JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    LEFT JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      AND sr.payload->>'Date' IS NOT NULL AND sr.payload->>'Date' != ''
      AND sr.processed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.sot_appointments a
        WHERE a.appointment_number = sr.payload->>'Number'
          AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
      )
    ON CONFLICT DO NOTHING
    RETURNING appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('new_appointments', v_count);

  -- Step 2: Create cat_procedures for spays
  WITH inserts AS (
    INSERT INTO trapper.cat_procedures (
      cat_id, appointment_id, procedure_type, procedure_date, status,
      performed_by, technician, is_spay, is_neuter,
      source_system, source_record_id
    )
    SELECT
      a.cat_id, a.appointment_id, 'spay', a.appointment_date,
      'completed'::trapper.procedure_status,
      a.vet_name, a.technician, TRUE, FALSE,
      'clinichq', a.appointment_number
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.service_type ILIKE '%spay%'
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_procedures cp
        WHERE cp.appointment_id = a.appointment_id AND cp.is_spay = TRUE
      )
    ON CONFLICT DO NOTHING
    RETURNING procedure_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('new_spays', v_count);

  -- Step 3: Create cat_procedures for neuters
  WITH inserts AS (
    INSERT INTO trapper.cat_procedures (
      cat_id, appointment_id, procedure_type, procedure_date, status,
      performed_by, technician, is_spay, is_neuter,
      source_system, source_record_id
    )
    SELECT
      a.cat_id, a.appointment_id, 'neuter', a.appointment_date,
      'completed'::trapper.procedure_status,
      a.vet_name, a.technician, FALSE, TRUE,
      'clinichq', a.appointment_number
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.service_type ILIKE '%neuter%'
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_procedures cp
        WHERE cp.appointment_id = a.appointment_id AND cp.is_neuter = TRUE
      )
    ON CONFLICT DO NOTHING
    RETURNING procedure_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('new_neuters', v_count);

  -- Step 4: Fix procedures based on cat sex
  WITH updates AS (
    UPDATE trapper.cat_procedures cp
    SET procedure_type = 'neuter', is_spay = FALSE, is_neuter = TRUE
    FROM trapper.sot_cats c
    WHERE cp.cat_id = c.cat_id
      AND cp.is_spay = TRUE
      AND LOWER(c.sex) = 'male'
    RETURNING cp.procedure_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('fixed_males', v_count);

  WITH updates AS (
    UPDATE trapper.cat_procedures cp
    SET procedure_type = 'spay', is_spay = TRUE, is_neuter = FALSE
    FROM trapper.sot_cats c
    WHERE cp.cat_id = c.cat_id
      AND cp.is_neuter = TRUE
      AND LOWER(c.sex) = 'female'
    RETURNING cp.procedure_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('fixed_females', v_count);

  -- Step 5: Mark altered_by_clinic
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET altered_by_clinic = TRUE
    FROM trapper.sot_appointments a
    WHERE a.cat_id = c.cat_id
      AND (a.service_type ILIKE '%Cat Spay%' OR a.service_type ILIKE '%Cat Neuter%')
      AND c.altered_by_clinic IS DISTINCT FROM TRUE
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('marked_altered_by_clinic', v_count);

  -- Step 6: Update altered_status on cats
  UPDATE trapper.sot_cats c SET altered_status = 'spayed'
  WHERE c.altered_status IS DISTINCT FROM 'spayed'
    AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_spay = TRUE);

  UPDATE trapper.sot_cats c SET altered_status = 'neutered'
  WHERE c.altered_status IS DISTINCT FROM 'neutered'
    AND EXISTS (SELECT 1 FROM trapper.cat_procedures cp WHERE cp.cat_id = c.cat_id AND cp.is_neuter = TRUE);

  -- Step 7: Link appointments to trappers
  SELECT * INTO v_count FROM trapper.link_appointments_to_trappers();
  IF v_count IS NULL THEN v_count := 0; END IF;
  v_results := v_results || jsonb_build_object('appointments_linked_to_trappers', v_count);

  -- Step 8: Create cat_vitals from appointments
  WITH inserts AS (
    INSERT INTO trapper.cat_vitals (
      cat_id, appointment_id, recorded_at,
      temperature_f, is_pregnant, is_lactating, is_in_heat,
      source_system, source_record_id
    )
    SELECT
      a.cat_id,
      a.appointment_id,
      a.appointment_date::timestamp with time zone,
      a.temperature,
      a.is_pregnant,
      a.is_lactating,
      a.is_in_heat,
      'clinichq',
      'appointment_' || a.appointment_number
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL
      AND (
        a.temperature IS NOT NULL
        OR a.is_pregnant = TRUE
        OR a.is_lactating = TRUE
        OR a.is_in_heat = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_vitals cv
        WHERE cv.appointment_id = a.appointment_id
      )
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('appointment_vitals_created', v_count);

  -- Step 9: Auto-link cats to requests based on attribution windows
  WITH inserts AS (
    INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
    SELECT DISTINCT
      r.request_id,
      a.cat_id,
      CASE
        WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
        ELSE 'wellness'::trapper.cat_link_purpose
      END,
      'Auto-linked: clinic visit ' || a.appointment_date::text || ' within request attribution window',
      'ingest_auto'
    FROM trapper.sot_appointments a
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
    JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
    LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
    WHERE a.cat_id IS NOT NULL
      -- Attribution window logic (from MIG_208)
      AND (
        -- Active request: procedure within 6 months of request creation, or future
        (r.resolved_at IS NULL AND a.appointment_date >= r.source_created_at - INTERVAL '1 month')
        OR
        -- Resolved request: procedure before resolved + 3 month buffer
        (r.resolved_at IS NOT NULL AND a.appointment_date <= r.resolved_at + INTERVAL '3 months'
         AND a.appointment_date >= r.source_created_at - INTERVAL '1 month')
      )
      -- Only link recent appointments (not historical backfill)
      AND a.appointment_date >= CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM trapper.request_cat_links rcl
        WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
      )
    ON CONFLICT (request_id, cat_id) DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('cats_linked_to_requests', v_count);

  -- Mark records as processed
  UPDATE trapper.staged_records
  SET processed_at = NOW()
  WHERE source_system = 'clinichq'
    AND source_table = 'appointment_info'
    AND processed_at IS NULL
    AND payload->>'Date' IS NOT NULL AND payload->>'Date' != '';

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_appointment_info IS
'Process ClinicHQ appointment_info staged records.
- Links orphaned appointments to cats
- Creates appointments
- Creates spay/neuter procedures
- Fixes procedures based on cat sex
- Marks altered_by_clinic
- Updates altered_status
- Links appointments to trappers
- Creates cat_vitals
- Auto-links cats to requests within attribution windows

Idempotent and safe to re-run.';

-- ==============================================================
-- PHASE 4: Master ClinicHQ Processor
-- ==============================================================

\echo 'Creating process_clinichq function...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq(
  p_source_table TEXT DEFAULT NULL,
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_table_results JSONB;
BEGIN
  -- Process in order: cat_info, owner_info, appointment_info
  -- But the individual functions are designed to be order-independent

  IF p_source_table IS NULL OR p_source_table = 'cat_info' THEN
    SELECT trapper.process_clinichq_cat_info(p_batch_size) INTO v_table_results;
    v_results := v_results || jsonb_build_object('cat_info', v_table_results);
  END IF;

  IF p_source_table IS NULL OR p_source_table = 'owner_info' THEN
    SELECT trapper.process_clinichq_owner_info(p_batch_size) INTO v_table_results;
    v_results := v_results || jsonb_build_object('owner_info', v_table_results);
  END IF;

  IF p_source_table IS NULL OR p_source_table = 'appointment_info' THEN
    SELECT trapper.process_clinichq_appointment_info(p_batch_size) INTO v_table_results;
    v_results := v_results || jsonb_build_object('appointment_info', v_table_results);
  END IF;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq IS
'Master processor for all ClinicHQ data.
- Can process all tables or a specific table
- Designed for order-independent processing
- Entity linking runs separately via run_all_entity_linking()';

-- ==============================================================
-- PHASE 5: Update process_next_job to route to processors
-- ==============================================================

\echo 'Updating process_next_job to use SQL processors...'

CREATE OR REPLACE FUNCTION trapper.process_next_job(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_job trapper.processing_jobs;
  v_result JSONB;
  v_processing_results JSONB;
  v_linking_results JSONB;
  v_error TEXT;
BEGIN
  -- Try to claim a job
  SELECT * INTO v_job FROM trapper.claim_next_job();

  IF v_job IS NULL THEN
    RETURN jsonb_build_object('status', 'no_jobs');
  END IF;

  BEGIN
    -- Route to appropriate processor based on source_system
    IF v_job.source_system = 'clinichq' THEN
      SELECT trapper.process_clinichq(v_job.source_table, p_batch_size)
      INTO v_processing_results;
    ELSE
      -- For other source systems, just run entity linking
      v_processing_results := '{}'::jsonb;
    END IF;

    -- Update heartbeat with processing results
    PERFORM trapper.update_job_heartbeat(
      v_job.job_id,
      v_job.total_records,
      v_processing_results
    );

    -- Update status to linking
    UPDATE trapper.processing_jobs
    SET status = 'linking', heartbeat_at = NOW()
    WHERE job_id = v_job.job_id;

    -- Run entity linking
    SELECT jsonb_object_agg(operation, count)
    INTO v_linking_results
    FROM trapper.run_all_entity_linking();

    -- Mark as complete
    PERFORM trapper.complete_job(v_job.job_id, v_linking_results);

    RETURN jsonb_build_object(
      'status', 'completed',
      'job_id', v_job.job_id,
      'source_system', v_job.source_system,
      'source_table', v_job.source_table,
      'processing_results', v_processing_results,
      'linking_results', v_linking_results
    );

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    PERFORM trapper.fail_job(v_job.job_id, v_error);

    RETURN jsonb_build_object(
      'status', 'failed',
      'job_id', v_job.job_id,
      'error', v_error
    );
  END;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================
-- SUMMARY
-- ==============================================================

\echo ''
\echo 'MIG_313 complete!'
\echo ''
\echo 'New functions:'
\echo '  - process_clinichq_cat_info(batch_size)'
\echo '  - process_clinichq_owner_info(batch_size)'
\echo '  - process_clinichq_appointment_info(batch_size)'
\echo '  - process_clinichq(source_table, batch_size)'
\echo ''
\echo 'Updated functions:'
\echo '  - process_next_job() - Now routes to SQL processors'
\echo ''
\echo 'Usage:'
\echo '  -- Process all ClinicHQ data'
\echo '  SELECT * FROM trapper.process_clinichq();'
\echo ''
\echo '  -- Process specific table'
\echo '  SELECT * FROM trapper.process_clinichq(''owner_info'', 1000);'
\echo ''
\echo '  -- Process through job queue'
\echo '  SELECT trapper.enqueue_processing(''clinichq'', ''owner_info'', ''manual'');'
\echo '  SELECT * FROM trapper.process_next_job();'
\echo ''
