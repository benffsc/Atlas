-- MIG_282: Extract Missing Microchips from Staged Data
-- Processes staged_records from petlink.pets and clinichq.appointment_info
-- to create cats and cat_identifiers using find_or_create_cat_by_microchip()

\echo '=== MIG_282: Extract Missing Microchips ==='

-- Step 1: Extract PetLink microchips
\echo 'Step 1: Processing PetLink pets...'

DO $$
DECLARE
  v_rec RECORD;
  v_microchip TEXT;
  v_name TEXT;
  v_processed INT := 0;
  v_created INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    SELECT
      sr.source_row_id,
      sr.payload as raw_data,
      sr.created_at as source_created_at
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'petlink'
      AND sr.source_table = 'pets'
      -- Only process if not already in cat_identifiers
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = COALESCE(
            sr.payload->>'Microchip Number',
            sr.payload->>'microchip',
            sr.payload->>'Pet ID'
          )
      )
    LIMIT 10000  -- Process in batches
  LOOP
    v_processed := v_processed + 1;

    -- Extract microchip from various possible field names
    v_microchip := TRIM(COALESCE(
      v_rec.raw_data->>'Microchip Number',
      v_rec.raw_data->>'microchip',
      v_rec.raw_data->>'Pet ID'
    ));

    -- Skip if no valid microchip
    IF v_microchip IS NULL OR v_microchip = '' OR LENGTH(v_microchip) < 9 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Extract name
    v_name := TRIM(COALESCE(
      v_rec.raw_data->>'Pet Name',
      v_rec.raw_data->>'Name',
      'PetLink Cat'
    ));

    -- Create cat using centralized function
    PERFORM trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_name,
      p_sex := CASE
        WHEN UPPER(v_rec.raw_data->>'Gender') IN ('M', 'MALE') THEN 'M'
        WHEN UPPER(v_rec.raw_data->>'Gender') IN ('F', 'FEMALE') THEN 'F'
        ELSE NULL
      END,
      p_breed := v_rec.raw_data->>'Breed',
      p_primary_color := v_rec.raw_data->>'Color',
      p_source_system := 'petlink',
      p_source_table := 'pets',
      p_source_record_id := v_rec.source_row_id
    );

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'PetLink: Processed %, Created %, Skipped %', v_processed, v_created, v_skipped;
END $$;

-- Step 2: Extract ClinicHQ appointment microchips
\echo 'Step 2: Processing ClinicHQ appointments...'

DO $$
DECLARE
  v_rec RECORD;
  v_microchip TEXT;
  v_name TEXT;
  v_processed INT := 0;
  v_created INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR v_rec IN
    SELECT
      sr.source_row_id,
      sr.payload as raw_data,
      sr.created_at as source_created_at
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'appointment_info'
      -- Only process if has microchip and not already extracted
      AND (sr.payload->>'Microchip' IS NOT NULL AND sr.payload->>'Microchip' != '')
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_identifiers ci
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = TRIM(sr.payload->>'Microchip')
      )
    LIMIT 25000  -- Process in larger batch
  LOOP
    v_processed := v_processed + 1;

    v_microchip := TRIM(v_rec.raw_data->>'Microchip');

    -- Skip invalid microchips
    IF v_microchip IS NULL OR v_microchip = '' OR LENGTH(v_microchip) < 9 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Extract name
    v_name := TRIM(COALESCE(
      v_rec.raw_data->>'Animal Name',
      v_rec.raw_data->>'Name',
      'ClinicHQ Cat'
    ));

    -- Create cat using centralized function
    PERFORM trapper.find_or_create_cat_by_microchip(
      p_microchip := v_microchip,
      p_name := v_name,
      p_sex := CASE
        WHEN UPPER(v_rec.raw_data->>'Sex') IN ('M', 'MALE', 'MALE NEUTERED', 'MALE INTACT') THEN 'M'
        WHEN UPPER(v_rec.raw_data->>'Sex') IN ('F', 'FEMALE', 'FEMALE SPAYED', 'FEMALE INTACT') THEN 'F'
        ELSE NULL
      END,
      p_breed := v_rec.raw_data->>'Breed',
      p_primary_color := v_rec.raw_data->>'Color',
      p_source_system := 'clinichq',
      p_source_table := 'appointment_info',
      p_source_record_id := v_rec.source_row_id
    );

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'ClinicHQ Appointments: Processed %, Created %, Skipped %', v_processed, v_created, v_skipped;
END $$;

-- Step 3: Report results
\echo 'Step 3: Reporting extraction results...'

SELECT
  source_system,
  COUNT(*) as total_cats
FROM trapper.cat_identifiers
WHERE id_type = 'microchip'
GROUP BY source_system
ORDER BY total_cats DESC;

\echo '=== MIG_282 Complete ==='
