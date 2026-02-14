\echo '=== MIG_861: Capture altered_status + secondary_color from cat_info ingest ==='
\echo ''
\echo 'Problem: process_clinichq_cat_info() passed NULL for altered_status and'
\echo 'secondary_color even though the raw payload has "Spay Neuter Status" (37k Yes)'
\echo 'and "Secondary Color" (19k+ records). This left gaps for cats without procedures.'
\echo ''
\echo 'Fix: Extract and pass these fields, plus add backfill updates for existing cats.'
\echo ''

-- ==============================================================
-- Step 1: Replace process_clinichq_cat_info with full field capture
-- ==============================================================

CREATE OR REPLACE FUNCTION trapper.process_clinichq_cat_info(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 1: Create cats from microchips using find_or_create_cat_by_microchip
  -- Now passes altered_status and secondary_color from payload
  WITH cat_data AS (
    SELECT DISTINCT ON (payload->>'Microchip Number')
      payload->>'Microchip Number' as microchip,
      NULLIF(TRIM(payload->>'Patient Name'), '') as name,
      NULLIF(TRIM(payload->>'Sex'), '') as sex,
      NULLIF(TRIM(payload->>'Breed'), '') as breed,
      NULLIF(TRIM(payload->>'Color'), '') as color,
      -- Map Spay Neuter Status: Yes/No are useful, Unknown/DidNotAsk/empty are NULL
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
        cd.altered_status,    -- was NULL, now from Spay Neuter Status
        cd.color,
        cd.secondary_color,   -- was NULL, now from Secondary Color
        NULL,                 -- ownership_type (not in cat_info export)
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

  -- Step 2b: Backfill secondary_color on existing cats where NULL
  WITH updates AS (
    UPDATE trapper.sot_cats c
    SET secondary_color = NULLIF(TRIM(sr.payload->>'Secondary Color'), '')
    FROM trapper.staged_records sr
    JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
    WHERE ci.cat_id = c.cat_id
      AND sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND c.secondary_color IS NULL
      AND sr.payload->>'Secondary Color' IS NOT NULL
      AND TRIM(sr.payload->>'Secondary Color') != ''
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('secondary_color_backfills', v_count);

  -- Step 2c: Backfill altered_status on existing cats where NULL
  -- Only fills Yes/No from cat_info; procedure-derived spayed/neutered takes priority
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
      AND c.altered_status IS NULL
      AND TRIM(sr.payload->>'Spay Neuter Status') IN ('Yes', 'No')
    RETURNING c.cat_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('altered_status_backfills', v_count);

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
- Creates cats via find_or_create_cat_by_microchip (all fields including altered_status, secondary_color)
- Updates sex on existing cats
- Backfills secondary_color and altered_status where NULL
- Links orphaned appointments to cats
- Extracts weight into cat_vitals

MIG_861: Now captures Spay Neuter Status → altered_status and Secondary Color → secondary_color.
Appointment processing (spayed/neutered from procedures) takes priority via IS DISTINCT FROM.
Idempotent and safe to re-run.';

-- ==============================================================
-- Step 2: One-time backfill for existing cats
-- ==============================================================

\echo 'Backfilling secondary_color on existing cats...'

WITH updates AS (
  UPDATE trapper.sot_cats c
  SET secondary_color = NULLIF(TRIM(sr.payload->>'Secondary Color'), '')
  FROM trapper.staged_records sr
  JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
  WHERE ci.cat_id = c.cat_id
    AND sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND c.secondary_color IS NULL
    AND sr.payload->>'Secondary Color' IS NOT NULL
    AND TRIM(sr.payload->>'Secondary Color') != ''
  RETURNING c.cat_id
)
SELECT COUNT(*) AS backfilled FROM updates;

\echo 'Backfilling altered_status on cats where NULL (Yes/No only, not overwriting spayed/neutered)...'

WITH updates AS (
  UPDATE trapper.sot_cats c
  SET altered_status = TRIM(sr.payload->>'Spay Neuter Status')
  FROM trapper.staged_records sr
  JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number' AND ci.id_type = 'microchip'
  WHERE ci.cat_id = c.cat_id
    AND sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND c.altered_status IS NULL
    AND TRIM(sr.payload->>'Spay Neuter Status') IN ('Yes', 'No')
  RETURNING c.cat_id
)
SELECT COUNT(*) AS backfilled FROM updates;

\echo ''
\echo '=== MIG_861 complete ==='
\echo 'process_clinichq_cat_info() now captures altered_status and secondary_color.'
\echo 'Backfill applied for existing cats with NULL values.'
\echo 'Appointment processing (spayed/neutered) still takes priority.'
