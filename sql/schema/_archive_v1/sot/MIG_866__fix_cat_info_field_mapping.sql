\echo '=== MIG_866: Fix process_clinichq_cat_info Field Name Mapping ==='
\echo 'Fixes DQ_CLINIC_001f: Wrong payload field names cause NULL name + color'
\echo ''
\echo 'Root cause: Function reads "Patient Name" and "Color" but ClinicHQ'
\echo 'payload actually has "Animal Name" and "Primary Color".'
\echo 'Result: All cats get name=Unknown and color=empty.'
\echo ''
\echo 'Also adds primary_color backfill step and fixes IS NULL checks'
\echo 'to handle empty strings (consistent with MIG_863, MIG_865).'
\echo ''

CREATE OR REPLACE FUNCTION trapper.process_clinichq_cat_info(
    p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 1: Create cats from microchips using find_or_create_cat_by_microchip
  -- MIG_866 FIX: "Patient Name" → "Animal Name", "Color" → "Primary Color"
  WITH cat_data AS (
    SELECT DISTINCT ON (payload->>'Microchip Number')
      payload->>'Microchip Number' as microchip,
      NULLIF(TRIM(payload->>'Animal Name'), '') as name,
      NULLIF(TRIM(payload->>'Sex'), '') as sex,
      NULLIF(TRIM(payload->>'Breed'), '') as breed,
      NULLIF(TRIM(payload->>'Primary Color'), '') as color,
      CASE
        WHEN TRIM(payload->>'Spay Neuter Status') IN ('Yes', 'No') THEN TRIM(payload->>'Spay Neuter Status')
        ELSE NULL
      END as altered_status,
      NULLIF(TRIM(payload->>'Secondary Color'), '') as secondary_color
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
        cd.altered_status,
        cd.color,
        cd.secondary_color,
        NULL,
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

  -- Step 2a (NEW): Backfill primary_color on existing cats where NULL or empty
  -- MIG_866: Added this step (was missing in original function)
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET primary_color = NULLIF(TRIM(sr.payload->>'Primary Color'), '')
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE ci.cat_id = c.cat_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND (c.primary_color IS NULL OR c.primary_color = '')
      AND sr.payload->>'Primary Color' IS NOT NULL
      AND TRIM(sr.payload->>'Primary Color') != ''
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('primary_color_backfills', v_count);

  -- Step 2b: Backfill secondary_color on existing cats where NULL or empty
  -- MIG_866 FIX: IS NULL → (IS NULL OR = '')
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET secondary_color = NULLIF(TRIM(sr.payload->>'Secondary Color'), '')
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE ci.cat_id = c.cat_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND (c.secondary_color IS NULL OR c.secondary_color = '')
      AND sr.payload->>'Secondary Color' IS NOT NULL
      AND TRIM(sr.payload->>'Secondary Color') != ''
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('secondary_color_backfills', v_count);

  -- Step 2c: Backfill altered_status on existing cats where NULL or empty
  -- MIG_866 FIX: IS NULL → (IS NULL OR = '')
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET altered_status = CASE
      WHEN TRIM(sr.payload->>'Spay Neuter Status') IN ('Yes', 'No') THEN TRIM(sr.payload->>'Spay Neuter Status')
      ELSE NULL
    END
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE ci.cat_id = c.cat_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND (c.altered_status IS NULL OR c.altered_status = '')
      AND TRIM(sr.payload->>'Spay Neuter Status') IN ('Yes', 'No')
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('altered_status_backfills', v_count);

  -- Step 2d (NEW): Backfill display_name on existing cats where 'Unknown'
  -- MIG_866: Catches cats that were created with wrong field mapping
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET display_name = trapper.clean_cat_name(sr.payload->>'Animal Name')
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE ci.cat_id = c.cat_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND (c.display_name = 'Unknown' OR c.display_name ~ '[0-9]{9,}')
      AND sr.payload->>'Animal Name' IS NOT NULL
      AND TRIM(sr.payload->>'Animal Name') != ''
      AND trapper.clean_cat_name(sr.payload->>'Animal Name') IS NOT NULL
      AND trapper.clean_cat_name(sr.payload->>'Animal Name') != ''
      AND trapper.clean_cat_name(sr.payload->>'Animal Name') != 'Unknown'
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('name_backfills', v_count);

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

COMMENT ON FUNCTION trapper.process_clinichq_cat_info(INT) IS
'MIG_866: Processes ClinicHQ cat_info records from staged_records.
Fixes:
1. Field mapping: "Patient Name" → "Animal Name", "Color" → "Primary Color"
   (Previous version read wrong JSON keys, resulting in NULL for name and color)
2. Added primary_color backfill step (Step 2a) — was missing entirely
3. Added display_name backfill step (Step 2d) — fixes cats stuck at "Unknown"
4. Fixed IS NULL → (IS NULL OR = empty string) in backfill steps 2b, 2c

Steps:
1. Create/update cats via find_or_create_cat_by_microchip (with correct field names)
2. Backfill sex, primary_color, secondary_color, altered_status, display_name
3. Link orphaned appointments to cats
4. Extract weight vitals';

\echo ''
\echo '=== MIG_866 Complete ==='
\echo ''
\echo 'Changes to process_clinichq_cat_info:'
\echo '  1. Step 1: Patient Name → Animal Name, Color → Primary Color'
\echo '  2. Step 2a (NEW): primary_color backfill'
\echo '  3. Step 2b: secondary_color IS NULL → (IS NULL OR = empty)'
\echo '  4. Step 2c: altered_status IS NULL → (IS NULL OR = empty)'
\echo '  5. Step 2d (NEW): display_name backfill for cats stuck at Unknown'
\echo ''
\echo 'To backfill existing cats:'
\echo '  -- Reset processed_at so Step 1 re-fires'
\echo '  UPDATE trapper.staged_records SET processed_at = NULL'
\echo '    WHERE source_system = ''clinichq'' AND source_table = ''cat_info'';'
\echo '  -- Re-run (Steps 2a-2d also fix already-processed records)'
\echo '  SELECT * FROM trapper.process_clinichq_cat_info(5000);'
