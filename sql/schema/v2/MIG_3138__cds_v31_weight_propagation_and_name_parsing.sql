-- MIG_3138: CDS v3.1 Sprint 2 — Weight Propagation + Animal Name Intelligence
--
-- FFS-1470: Weight propagation for unchipped cats
--   Step 4b in cat_info post-processing: join via appointments.cat_id (not microchip)
--   Also backfill appointments.cat_weight_lbs from cat_info for ALL appointments
--
-- FFS-1471: Extract chips from Animal Name in find_or_create_cat_by_clinichq_id
--   When Animal Name contains a 15-digit chip, route to find_or_create_cat_by_microchip
--
-- FFS-1467: Parse compound Animal Name
--   New function ops.parse_compound_animal_name() extracts person name, quoted cat name,
--   shelter ID, and microchip from patterns like:
--     "April Lofgren/A412067 'Popeye' 981020047017895"
--     "A441413 - 981020053852813"
--     "Kvothe A438239 - 981020053860655"
--   New post-processing step applies parsed names to cats
--
-- Created: 2026-05-14

\echo ''
\echo '=============================================='
\echo '  MIG_3138: CDS v3.1 Weight + Name Parsing'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ops.parse_compound_animal_name() — FFS-1467
-- ============================================================================

\echo '1. Creating ops.parse_compound_animal_name()...'

CREATE OR REPLACE FUNCTION ops.parse_compound_animal_name(p_raw_name TEXT)
RETURNS JSONB AS $$
DECLARE
  v_name TEXT;
  v_result JSONB := '{}'::JSONB;
  v_chip TEXT;
  v_shelter_id TEXT;
  v_quoted_name TEXT;
  v_person_name TEXT;
  v_remainder TEXT;
BEGIN
  v_name := NULLIF(TRIM(p_raw_name), '');
  IF v_name IS NULL THEN RETURN v_result; END IF;

  -- Extract 15-digit microchip
  v_chip := (regexp_match(v_name, '([0-9]{15})'))[1];
  IF v_chip IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('microchip', v_chip);
    -- Remove chip from working string
    v_remainder := TRIM(regexp_replace(v_name, '[0-9]{15}', '', 'g'));
  ELSE
    v_remainder := v_name;
  END IF;

  -- Extract shelter ID (A followed by 4-8 digits)
  v_shelter_id := (regexp_match(v_remainder, '([A-Z][0-9]{4,8})'))[1];
  IF v_shelter_id IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('shelter_id', v_shelter_id);
    v_remainder := TRIM(regexp_replace(v_remainder, '[A-Z][0-9]{4,8}', '', 'g'));
  END IF;

  -- Extract quoted cat name ("name")
  v_quoted_name := (regexp_match(v_remainder, '"([^"]+)"'))[1];
  IF v_quoted_name IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('cat_name', TRIM(v_quoted_name));
    v_remainder := TRIM(regexp_replace(v_remainder, '"[^"]*"', '', 'g'));
  END IF;

  -- Extract person name (before first /)
  IF v_remainder ~ '/' THEN
    v_person_name := TRIM(split_part(v_remainder, '/', 1));
    IF v_person_name != '' AND v_person_name !~ '^[0-9]' THEN
      v_result := v_result || jsonb_build_object('person_name', v_person_name);
    END IF;
    v_remainder := TRIM(split_part(v_remainder, '/', 2));
  END IF;

  -- Clean remainder: strip separators, extra spaces
  v_remainder := TRIM(regexp_replace(v_remainder, '[\-\s]+$', '', 'g'));
  v_remainder := TRIM(regexp_replace(v_remainder, '^[\-\s]+', '', 'g'));
  v_remainder := TRIM(regexp_replace(v_remainder, '\s+', ' ', 'g'));

  -- If there's a meaningful remainder and no cat_name yet, use it
  IF v_remainder IS NOT NULL AND v_remainder != '' AND NOT v_result ? 'cat_name' THEN
    -- Only set if it looks like a name (not just numbers or punctuation)
    IF v_remainder ~ '[a-zA-Z]{2,}' THEN
      v_result := v_result || jsonb_build_object('cat_name', v_remainder);
    END IF;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION ops.parse_compound_animal_name IS
'FFS-1467: Parses compound ClinicHQ Animal Name fields.
Extracts: microchip (15-digit), shelter_id (A+digits), cat_name (quoted),
person_name (before /). Examples:
  "April Lofgren/A412067 ""Popeye"" 981020047017895"
  → {microchip, shelter_id, cat_name: Popeye, person_name: April Lofgren}
  "A441413 - 981020053852813"
  → {microchip, shelter_id}';

-- ============================================================================
-- 2. Update sot.find_or_create_cat_by_clinichq_id() — FFS-1471
-- ============================================================================

\echo '2. Updating sot.find_or_create_cat_by_clinichq_id() with chip extraction...'

CREATE OR REPLACE FUNCTION sot.find_or_create_cat_by_clinichq_id(
    p_clinichq_animal_id TEXT,
    p_name TEXT DEFAULT NULL,
    p_sex TEXT DEFAULT NULL,
    p_breed TEXT DEFAULT NULL,
    p_color TEXT DEFAULT NULL,
    p_secondary_color TEXT DEFAULT NULL,
    p_ownership_type TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'clinichq'
)
RETURNS UUID AS $$
DECLARE
    v_cat_id UUID;
    v_clean_animal_id TEXT;
    v_clean_name TEXT;
    v_extracted_chip TEXT;
    v_validation RECORD;
BEGIN
    -- Clean input
    v_clean_animal_id := NULLIF(TRIM(p_clinichq_animal_id), '');

    -- Must have clinichq_animal_id
    IF v_clean_animal_id IS NULL THEN
        RAISE DEBUG 'find_or_create_cat_by_clinichq_id: No animal_id provided';
        RETURN NULL;
    END IF;

    -- Clean name
    v_clean_name := NULLIF(TRIM(p_name), '');

    -- FFS-1471: Check if name contains a 15-digit microchip
    IF v_clean_name IS NOT NULL THEN
        v_extracted_chip := (regexp_match(v_clean_name, '([0-9]{15})'))[1];

        IF v_extracted_chip IS NOT NULL THEN
            -- Validate the extracted chip
            SELECT * INTO v_validation FROM sot.validate_microchip(v_extracted_chip);

            IF v_validation.is_valid THEN
                -- Route to find_or_create_cat_by_microchip instead
                -- This handles dedup, name cleaning, identifier creation
                v_cat_id := sot.find_or_create_cat_by_microchip(
                    p_microchip := v_validation.cleaned,
                    p_name := v_clean_name,
                    p_sex := p_sex,
                    p_breed := p_breed,
                    p_color := p_color,
                    p_source_system := p_source_system,
                    p_clinichq_animal_id := v_clean_animal_id,
                    p_ownership_type := p_ownership_type,
                    p_secondary_color := p_secondary_color
                );

                IF v_cat_id IS NOT NULL THEN
                    RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Routed to microchip path for chip % → %', v_extracted_chip, v_cat_id;
                    RETURN v_cat_id;
                END IF;
                -- If microchip path returned NULL (invalid chip), fall through to clinichq_id path
            END IF;

            -- Name contained digits but chip was invalid — clean the name
            v_clean_name := 'Unknown';
        END IF;
    END IF;

    -- If name looks like just a microchip (exact match), set to Unknown
    IF v_clean_name ~ '^[0-9]{15}$' THEN
        v_clean_name := 'Unknown';
    END IF;

    -- Step 1: Check cat_identifiers for existing cat
    SELECT ci.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    JOIN sot.cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = v_clean_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Found by cat_identifiers: %', v_cat_id;
        RETURN v_cat_id;
    END IF;

    -- Step 2: Check sot.cats.clinichq_animal_id directly (denormalized column)
    SELECT c.cat_id INTO v_cat_id
    FROM sot.cats c
    WHERE c.clinichq_animal_id = v_clean_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
        RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Found by denormalized column: %', v_cat_id;

        -- Ensure identifier exists (backfill if missing)
        INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at, confidence)
        VALUES (v_cat_id, 'clinichq_animal_id', v_clean_animal_id, p_source_system, NOW(), 1.0)
        ON CONFLICT (id_type, id_value) DO NOTHING;

        RETURN v_cat_id;
    END IF;

    -- Step 3: Create new cat
    v_cat_id := gen_random_uuid();

    INSERT INTO sot.cats (
        cat_id,
        name,
        sex,
        breed,
        primary_color,
        secondary_color,
        clinichq_animal_id,
        ownership_type,
        source_system,
        source_record_id,
        created_at,
        updated_at
    ) VALUES (
        v_cat_id,
        COALESCE(v_clean_name, 'Unknown'),
        LOWER(NULLIF(TRIM(p_sex), '')),
        NULLIF(TRIM(p_breed), ''),
        NULLIF(TRIM(p_color), ''),
        NULLIF(TRIM(p_secondary_color), ''),
        v_clean_animal_id,
        CASE NULLIF(TRIM(p_ownership_type), '')
            WHEN 'Community Cat (Feral)' THEN 'feral'
            WHEN 'Community Cat (Friendly)' THEN 'community'
            WHEN 'Owned' THEN 'owned'
            WHEN 'Foster' THEN 'foster'
            ELSE NULL
        END,
        p_source_system,
        v_clean_animal_id,
        NOW(),
        NOW()
    );

    -- Create identifier
    INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at, confidence)
    VALUES (v_cat_id, 'clinichq_animal_id', v_clean_animal_id, p_source_system, NOW(), 1.0);

    RAISE DEBUG 'find_or_create_cat_by_clinichq_id: Created new cat: %', v_cat_id;

    RETURN v_cat_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Add Step 4b to cat_info post-processing — FFS-1470
--    Weight vitals for unchipped cats (join via appointment.cat_id, not microchip)
--    Also: backfill appointments.cat_weight_lbs from cat_info Weight for ALL
-- ============================================================================

\echo '3. Creating ops.propagate_weight_for_unchipped_cats()...'

CREATE OR REPLACE FUNCTION ops.propagate_weight_for_unchipped_cats(p_upload_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}'::JSONB;
  v_count INT;
BEGIN
  -- Step 4b-1: Create cat_vitals for unchipped cats via appointment.cat_id
  -- Join: cat_info.Number = appointment.appointment_number, appointment.cat_id set
  INSERT INTO ops.cat_vitals (
    cat_id, appointment_id, recorded_at, weight_lbs, source_system, source_record_id
  )
  SELECT DISTINCT ON (a.cat_id, a.appointment_id)
    a.cat_id,
    a.appointment_id,
    COALESCE(a.appointment_date::timestamp with time zone, NOW()),
    (sr.payload->>'Weight')::numeric(5,2),
    'clinichq',
    'cat_info_unchipped_' || sr.source_row_id
  FROM ops.staged_records sr
  JOIN ops.file_uploads fu ON fu.upload_id = sr.file_upload_id
  JOIN ops.appointments a ON a.appointment_number = sr.payload->>'Number'
    AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND fu.batch_id = (SELECT batch_id FROM ops.file_uploads WHERE upload_id = p_upload_id)
    AND a.cat_id IS NOT NULL
    AND a.merged_into_appointment_id IS NULL
    AND sr.payload->>'Weight' IS NOT NULL
    AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
    AND (sr.payload->>'Weight')::numeric > 0
    -- Only for cats without microchip (chipped cats handled by Step 4)
    AND NOT EXISTS (
      SELECT 1 FROM sot.cats c
      WHERE c.cat_id = a.cat_id AND c.microchip IS NOT NULL
    )
    -- Don't duplicate existing vitals for this appointment
    AND NOT EXISTS (
      SELECT 1 FROM ops.cat_vitals cv
      WHERE cv.appointment_id = a.appointment_id AND cv.weight_lbs IS NOT NULL
    )
  ORDER BY a.cat_id, a.appointment_id, sr.created_at DESC
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_results := v_results || jsonb_build_object('unchipped_weight_vitals_created', v_count);

  -- Step 4b-2: Backfill appointments.cat_weight_lbs from cat_info for ALL appointments
  UPDATE ops.appointments a
  SET
    cat_weight_lbs = (sr.payload->>'Weight')::NUMERIC(5,2),
    updated_at = NOW()
  FROM ops.staged_records sr
  JOIN ops.file_uploads fu ON fu.upload_id = sr.file_upload_id
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND fu.batch_id = (SELECT batch_id FROM ops.file_uploads WHERE upload_id = p_upload_id)
    AND sr.payload->>'Number' = a.appointment_number
    AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.cat_weight_lbs IS NULL
    AND a.merged_into_appointment_id IS NULL
    AND sr.payload->>'Weight' IS NOT NULL
    AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
    AND (sr.payload->>'Weight')::numeric > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_results := v_results || jsonb_build_object('appointments_weight_backfilled', v_count);

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.propagate_weight_for_unchipped_cats IS
'FFS-1470: Creates cat_vitals for unchipped cats by joining cat_info to appointments
via appointment_number (not microchip). Also backfills appointments.cat_weight_lbs.
Called after Step 4 in cat_info post-processing.';

-- ============================================================================
-- 4. Apply compound name parsing in post-processing — FFS-1467
-- ============================================================================

\echo '4. Creating ops.apply_compound_name_parsing()...'

CREATE OR REPLACE FUNCTION ops.apply_compound_name_parsing()
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}'::JSONB;
  v_count INT := 0;
  v_shelter_count INT := 0;
  r RECORD;
  v_parsed JSONB;
BEGIN
  -- Find cats whose name looks like a compound pattern
  -- (contains / or shelter ID or quoted name + chip)
  FOR r IN
    SELECT c.cat_id, c.name, c.microchip
    FROM sot.cats c
    WHERE c.merged_into_cat_id IS NULL
      AND c.name IS NOT NULL
      AND (
        c.name ~ '[A-Z][0-9]{4,8}'  -- Has shelter ID
        OR (c.name ~ '/' AND c.name ~ '[a-zA-Z]')  -- Has slash with letters
        OR c.name ~ '"[^"]+"'  -- Has quoted name
      )
      -- Don't re-parse cats that already have clean names
      AND c.name !~ '^[A-Z][a-z]+ [A-Z][a-z]+$'  -- Not already "FirstName LastName"
  LOOP
    v_parsed := ops.parse_compound_animal_name(r.name);

    -- Update cat name if we extracted a better one
    IF v_parsed ? 'cat_name' AND (v_parsed->>'cat_name') != r.name THEN
      UPDATE sot.cats
      SET name = v_parsed->>'cat_name',
          updated_at = NOW()
      WHERE cat_id = r.cat_id
        AND (name ~ '[0-9]{5,}' OR name ~ '/' OR name ~ '"');
      GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    -- Add shelter_id as identifier if extracted
    IF v_parsed ? 'shelter_id' THEN
      INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at, confidence)
      VALUES (r.cat_id, 'previous_shelter_id', v_parsed->>'shelter_id', 'clinichq', NOW(), 0.9)
      ON CONFLICT (id_type, id_value) DO NOTHING;
      GET DIAGNOSTICS v_shelter_count = ROW_COUNT;
    END IF;
  END LOOP;

  v_results := jsonb_build_object(
    'cats_name_updated', v_count,
    'previous_shelter_ids_added', v_shelter_count
  );

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_compound_name_parsing IS
'FFS-1467: Applies compound Animal Name parsing to existing cats.
Extracts quoted cat names (e.g., "Popeye") and shelter IDs (e.g., A412067).
Updates cat names and creates shelter_id identifiers.';

-- ============================================================================
-- 5. BACKFILL: Weight vitals for existing unchipped cats — FFS-1470
-- ============================================================================

\echo '5. Backfilling weight vitals for unchipped cats...'

DO $$
DECLARE
  v_count INT;
BEGIN
  -- Create cat_vitals from cat_info for unchipped cats that have appointments
  INSERT INTO ops.cat_vitals (
    cat_id, appointment_id, recorded_at, weight_lbs, source_system, source_record_id
  )
  SELECT DISTINCT ON (a.cat_id, a.appointment_id)
    a.cat_id,
    a.appointment_id,
    a.appointment_date::timestamp with time zone,
    (sr.payload->>'Weight')::numeric(5,2),
    'clinichq',
    'cat_info_unchipped_backfill_' || sr.source_row_id
  FROM ops.staged_records sr
  JOIN ops.appointments a ON a.appointment_number = sr.payload->>'Number'
    AND a.appointment_date = TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY')
  JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND a.cat_id IS NOT NULL
    AND a.merged_into_appointment_id IS NULL
    AND c.microchip IS NULL
    AND sr.payload->>'Weight' IS NOT NULL
    AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
    AND (sr.payload->>'Weight')::numeric > 0
    AND NOT EXISTS (
      SELECT 1 FROM ops.cat_vitals cv
      WHERE cv.appointment_id = a.appointment_id AND cv.weight_lbs IS NOT NULL
    )
  ORDER BY a.cat_id, a.appointment_id, sr.created_at DESC
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % weight vitals for unchipped cats', v_count;
END $$;

-- ============================================================================
-- 6. BACKFILL: appointments.cat_weight_lbs from cat_info
-- ============================================================================

\echo '6. Backfilling appointments.cat_weight_lbs from cat_info...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE ops.appointments a
  SET
    cat_weight_lbs = (sr.payload->>'Weight')::NUMERIC(5,2),
    updated_at = NOW()
  FROM ops.staged_records sr
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND sr.payload->>'Number' = a.appointment_number
    AND TO_DATE(sr.payload->>'Date', 'MM/DD/YYYY') = a.appointment_date
    AND a.cat_weight_lbs IS NULL
    AND a.merged_into_appointment_id IS NULL
    AND sr.payload->>'Weight' IS NOT NULL
    AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
    AND (sr.payload->>'Weight')::numeric > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % appointments with cat_weight_lbs', v_count;
END $$;

-- ============================================================================
-- 7. BACKFILL: Apply compound name parsing to existing cats — FFS-1467
-- ============================================================================

\echo '7. Applying compound name parsing to existing cats...'

DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := ops.apply_compound_name_parsing();
  RAISE NOTICE 'Compound name parsing: %', v_result;
END $$;

-- ============================================================================
-- 8. GRANT PERMISSIONS
-- ============================================================================

\echo '8. Granting permissions...'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION ops.parse_compound_animal_name TO service_role;
    GRANT EXECUTE ON FUNCTION ops.propagate_weight_for_unchipped_cats TO service_role;
    GRANT EXECUTE ON FUNCTION ops.apply_compound_name_parsing TO service_role;
    GRANT EXECUTE ON FUNCTION sot.find_or_create_cat_by_clinichq_id(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
  END IF;
END $$;

-- ============================================================================
-- 9. VERIFICATION
-- ============================================================================

\echo ''
\echo '9. Verification...'

-- Test parse_compound_animal_name
DO $$
DECLARE
  v JSONB;
BEGIN
  -- Test Popeye pattern
  v := ops.parse_compound_animal_name('April Lofgren/A412067 "Popeye" 981020047017895');
  ASSERT v->>'microchip' = '981020047017895', 'Should extract microchip';
  ASSERT v->>'shelter_id' = 'A412067', 'Should extract shelter_id';
  ASSERT v->>'cat_name' = 'Popeye', 'Should extract quoted cat name';
  ASSERT v->>'person_name' = 'April Lofgren', 'Should extract person name before /';

  -- Test shelter ID + chip
  v := ops.parse_compound_animal_name('A441413 - 981020053852813');
  ASSERT v->>'microchip' = '981020053852813', 'Should extract microchip';
  ASSERT v->>'shelter_id' = 'A441413', 'Should extract shelter_id';

  -- Test name with shelter ID
  v := ops.parse_compound_animal_name('Kvothe A438239 - 981020053860655');
  ASSERT v->>'microchip' = '981020053860655', 'Should extract microchip';
  ASSERT v->>'shelter_id' = 'A438239', 'Should extract shelter_id';
  ASSERT v->>'cat_name' = 'Kvothe', 'Should extract cat name';

  -- Test simple name (no compound)
  v := ops.parse_compound_animal_name('Mittens');
  ASSERT v = '{}'::JSONB OR v->>'cat_name' = 'Mittens', 'Simple name should pass through';

  -- Test NULL
  v := ops.parse_compound_animal_name(NULL);
  ASSERT v = '{}'::JSONB, 'NULL should return empty object';

  RAISE NOTICE 'All parse_compound_animal_name tests passed';
END $$;

-- Verify functions exist
DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'parse_compound_animal_name'
  )), 'Function ops.parse_compound_animal_name() not found';

  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'propagate_weight_for_unchipped_cats'
  )), 'Function ops.propagate_weight_for_unchipped_cats() not found';

  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops' AND p.proname = 'apply_compound_name_parsing'
  )), 'Function ops.apply_compound_name_parsing() not found';

  RAISE NOTICE 'All functions verified';
END $$;

-- Show backfill results
SELECT 'cat_vitals for unchipped cats' AS metric,
  COUNT(*) FILTER (WHERE cv.source_record_id LIKE 'cat_info_unchipped%') AS backfilled
FROM ops.cat_vitals cv;

SELECT 'appointments with cat_weight_lbs' AS metric,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE cat_weight_lbs IS NOT NULL) AS has_weight,
  COUNT(*) FILTER (WHERE cat_weight_lbs IS NULL AND cat_id IS NOT NULL) AS missing_weight
FROM ops.appointments
WHERE merged_into_appointment_id IS NULL;

\echo ''
\echo '=============================================='
\echo '  MIG_3138 COMPLETE'
\echo '=============================================='
\echo ''
