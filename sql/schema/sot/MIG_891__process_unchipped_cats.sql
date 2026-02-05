\echo '=== MIG_891: Process Unchipped Cats from ClinicHQ ==='
\echo ''
\echo 'Problem: Cats euthanized before microchipping (e.g., cancer cases) are silently'
\echo 'dropped by process_clinichq_cat_info() because it filters for microchip length >= 9.'
\echo ''
\echo 'Solution: New function process_clinichq_unchipped_cats() that uses enrich_cat()'
\echo 'with clinichq_animal_id as the stable identifier. Marks cats with needs_microchip = TRUE.'
\echo 'Zero changes to existing chipped cat pipeline - purely additive.'
\echo ''

-- ==============================================================
-- Step 0: Fix enrich_cat() to include source_table in cat_identifiers INSERT
-- (source_table column was added after MIG_244 but enrich_cat wasn't updated)
-- ==============================================================

CREATE OR REPLACE FUNCTION trapper.enrich_cat(
  -- Identifiers (provide at least one)
  p_microchip TEXT DEFAULT NULL,
  p_clinic_animal_id TEXT DEFAULT NULL,
  p_airtable_id TEXT DEFAULT NULL,
  -- Cat details
  p_name TEXT DEFAULT NULL,
  p_sex TEXT DEFAULT NULL, -- 'male', 'female', 'unknown'
  p_altered_status TEXT DEFAULT NULL, -- 'altered', 'intact', 'unknown'
  p_breed TEXT DEFAULT NULL,
  p_primary_color TEXT DEFAULT NULL,
  p_secondary_color TEXT DEFAULT NULL,
  p_birth_year INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  -- Ownership
  p_ownership_type TEXT DEFAULT NULL, -- 'owned', 'community', 'feral', 'stray'
  -- Linking
  p_owner_person_id UUID DEFAULT NULL, -- Link to owner
  p_place_id UUID DEFAULT NULL, -- Link to place
  -- Event tracking (optional)
  p_event_date DATE DEFAULT NULL,
  -- Tracking
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  cat_id UUID,
  is_new BOOLEAN,
  matched_by TEXT
) AS $$
DECLARE
  v_cat_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_matched_by TEXT := NULL;
  v_display_name TEXT;
  v_norm_microchip TEXT;
  v_source_table TEXT;
BEGIN
  -- Determine source_table based on source_system
  v_source_table := CASE
    WHEN p_source_system = 'clinichq' THEN 'cat_info'
    WHEN p_source_system = 'airtable' THEN 'cats'
    WHEN p_source_system = 'shelterluv' THEN 'animals'
    WHEN p_source_system = 'petlink' THEN 'pets'
    ELSE 'unknown'
  END;

  -- Normalize microchip
  v_norm_microchip := NULLIF(regexp_replace(upper(trim(p_microchip)), '[^A-Z0-9]', '', 'g'), '');

  -- Build display name
  v_display_name := COALESCE(
    NULLIF(trim(p_name), ''),
    CASE WHEN v_norm_microchip IS NOT NULL THEN 'Cat-' || substring(v_norm_microchip, 1, 8) ELSE NULL END,
    CASE WHEN p_clinic_animal_id IS NOT NULL THEN 'Cat-' || p_clinic_animal_id ELSE NULL END,
    'Unknown Cat'
  );

  -- Try to match by microchip first (most reliable)
  IF v_norm_microchip IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND upper(regexp_replace(ci.id_value, '[^A-Z0-9]', '', 'g')) = v_norm_microchip
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'microchip';
    END IF;
  END IF;

  -- Try clinic animal ID if no microchip match
  IF v_cat_id IS NULL AND p_clinic_animal_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = p_clinic_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'clinichq_animal_id';
    END IF;
  END IF;

  -- Try Airtable ID if still no match
  IF v_cat_id IS NULL AND p_airtable_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'airtable_id'
      AND ci.id_value = p_airtable_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'airtable_id';
    END IF;
  END IF;

  -- No match - create new cat
  IF v_cat_id IS NULL THEN
    -- Require at least one identifier
    IF v_norm_microchip IS NULL AND p_clinic_animal_id IS NULL AND p_airtable_id IS NULL THEN
      RAISE EXCEPTION 'Cannot create cat without at least one identifier (microchip, clinic_animal_id, or airtable_id)';
    END IF;

    INSERT INTO trapper.sot_cats (
      display_name,
      sex,
      altered_status,
      breed,
      primary_color,
      secondary_color,
      birth_year,
      notes,
      ownership_type,
      data_source,
      created_at,
      updated_at
    ) VALUES (
      v_display_name,
      COALESCE(p_sex, 'unknown'),
      COALESCE(p_altered_status, 'unknown'),
      p_breed,
      p_primary_color,
      p_secondary_color,
      p_birth_year,
      p_notes,
      COALESCE(p_ownership_type, 'unknown'),
      p_source_system::trapper.data_source,
      NOW(),
      NOW()
    )
    RETURNING sot_cats.cat_id INTO v_cat_id;

    v_is_new := TRUE;
    v_matched_by := 'new';

    -- Add identifiers (now including source_table)
    IF v_norm_microchip IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'microchip', v_norm_microchip, p_source_system, v_source_table);
    END IF;

    IF p_clinic_animal_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'clinichq_animal_id', p_clinic_animal_id, p_source_system, v_source_table);
    END IF;

    IF p_airtable_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'airtable_id', p_airtable_id, p_source_system, v_source_table);
    END IF;
  ELSE
    -- ENRICH existing cat: add missing identifiers and update fields
    IF v_norm_microchip IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = v_cat_id AND id_type = 'microchip'
    ) THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'microchip', v_norm_microchip, p_source_system, v_source_table);
    END IF;

    IF p_clinic_animal_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = v_cat_id AND id_type = 'clinichq_animal_id'
    ) THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system, source_table)
      VALUES (v_cat_id, 'clinichq_animal_id', p_clinic_animal_id, p_source_system, v_source_table);
    END IF;

    -- Update cat with better data (fill in missing fields)
    UPDATE trapper.sot_cats c
    SET
      display_name = CASE WHEN c.display_name IS NULL OR c.display_name = 'Unknown Cat' OR c.display_name LIKE 'Cat-%' THEN COALESCE(NULLIF(trim(p_name), ''), c.display_name) ELSE c.display_name END,
      sex = CASE WHEN c.sex IS NULL OR c.sex = 'unknown' THEN COALESCE(p_sex, c.sex) ELSE c.sex END,
      altered_status = CASE WHEN c.altered_status IS NULL OR c.altered_status = 'unknown' THEN COALESCE(p_altered_status, c.altered_status) ELSE c.altered_status END,
      breed = COALESCE(c.breed, p_breed),
      primary_color = COALESCE(c.primary_color, p_primary_color),
      secondary_color = COALESCE(c.secondary_color, p_secondary_color),
      birth_year = COALESCE(c.birth_year, p_birth_year),
      ownership_type = CASE WHEN c.ownership_type IS NULL OR c.ownership_type = 'unknown' THEN COALESCE(p_ownership_type, c.ownership_type) ELSE c.ownership_type END,
      updated_at = NOW()
    WHERE c.cat_id = v_cat_id;
  END IF;

  -- Link to owner if provided
  IF p_owner_person_id IS NOT NULL THEN
    INSERT INTO trapper.cat_owner_relationships (cat_id, person_id, relationship_type, is_current, source_system, source_record_id)
    VALUES (v_cat_id, p_owner_person_id, 'owner', TRUE, p_source_system, p_source_record_id)
    ON CONFLICT (cat_id, person_id, relationship_type) DO UPDATE
    SET is_current = TRUE, updated_at = NOW();
  END IF;

  -- Link to place if provided
  IF p_place_id IS NOT NULL THEN
    INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system)
    VALUES (v_cat_id, p_place_id, 'residence', p_source_system)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_cat_id, v_is_new, v_matched_by;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_cat IS
'Universal function to add or update a cat from any data source.
Handles identity matching by microchip/clinic_id, enrichment, and linking.
Use this from ALL sync scripts that process cat data.

MIG_891: Updated to include source_table in cat_identifiers INSERT.';

-- ==============================================================
-- Step 1: Create the unchipped cat processing function
-- ==============================================================

CREATE OR REPLACE FUNCTION trapper.process_clinichq_unchipped_cats(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := jsonb_build_object(
    'cats_created', 0,
    'cats_matched', 0,
    'appointments_linked', 0,
    'records_processed', 0,
    'records_skipped_no_id', 0
  );
  v_record RECORD;
  v_cat_result RECORD;
  v_cat_id UUID;
  v_is_new BOOLEAN;
  v_cats_created INT := 0;
  v_cats_matched INT := 0;
  v_appointments_linked INT := 0;
  v_records_processed INT := 0;
  v_records_skipped_no_id INT := 0;
BEGIN
  -- Process staged records that:
  -- 1. Are from clinichq cat_info
  -- 2. Have no valid microchip (NULL, empty, or < 9 chars)
  -- 3. Have not been processed yet
  -- 4. Have a usable identifier (source_row_id for clinic animal ID)
  -- 5. Don't already have a cat linked to their appointment (chipped pipeline didn't handle them)

  FOR v_record IN
    SELECT
      sr.id AS staged_record_id,
      sr.source_row_id,
      sr.payload,
      NULLIF(TRIM(sr.payload->>'Patient Name'), '') as cat_name,
      NULLIF(TRIM(sr.payload->>'Sex'), '') as cat_sex,
      NULLIF(TRIM(sr.payload->>'Breed'), '') as cat_breed,
      NULLIF(TRIM(sr.payload->>'Color'), '') as cat_color,
      NULLIF(TRIM(sr.payload->>'Secondary Color'), '') as cat_secondary_color,
      CASE
        WHEN TRIM(sr.payload->>'Spay Neuter Status') IN ('Yes', 'No') THEN TRIM(sr.payload->>'Spay Neuter Status')
        ELSE NULL
      END as altered_status,
      sr.payload->>'Number' as appointment_number,
      sr.payload->>'Date' as appointment_date_str
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'cat_info'
      AND sr.processed_at IS NULL
      -- Unchipped: NULL, empty, or too short microchip
      AND (
        sr.payload->>'Microchip Number' IS NULL
        OR TRIM(sr.payload->>'Microchip Number') = ''
        OR LENGTH(TRIM(sr.payload->>'Microchip Number')) < 9
      )
    ORDER BY sr.created_at
    LIMIT p_batch_size
  LOOP
    -- Skip records without a usable identifier
    IF v_record.source_row_id IS NULL OR TRIM(v_record.source_row_id) = '' THEN
      v_records_skipped_no_id := v_records_skipped_no_id + 1;
      -- Mark as processed anyway to avoid infinite loop
      UPDATE trapper.staged_records
      SET processed_at = NOW()
      WHERE id = v_record.staged_record_id;
      CONTINUE;
    END IF;

    -- Check if appointment already has a cat_id (chipped pipeline already handled it)
    IF v_record.appointment_number IS NOT NULL THEN
      PERFORM 1 FROM trapper.sot_appointments a
      WHERE a.appointment_number = v_record.appointment_number
        AND a.cat_id IS NOT NULL;
      IF FOUND THEN
        -- Already has a cat - skip and mark as processed
        UPDATE trapper.staged_records
        SET processed_at = NOW()
        WHERE id = v_record.staged_record_id;
        v_records_processed := v_records_processed + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Create or match cat using enrich_cat() with clinic_animal_id
    SELECT * INTO v_cat_result
    FROM trapper.enrich_cat(
      p_microchip := NULL,
      p_clinic_animal_id := v_record.source_row_id,
      p_airtable_id := NULL,
      p_name := v_record.cat_name,
      p_sex := v_record.cat_sex,
      p_altered_status := v_record.altered_status,
      p_breed := v_record.cat_breed,
      p_primary_color := v_record.cat_color,
      p_secondary_color := v_record.cat_secondary_color,
      p_birth_year := NULL,
      p_notes := NULL,
      p_ownership_type := NULL,
      p_owner_person_id := NULL,
      p_place_id := NULL,
      p_source_system := 'clinichq',
      p_source_record_id := v_record.source_row_id
    );

    v_cat_id := v_cat_result.cat_id;
    v_is_new := v_cat_result.is_new;

    IF v_cat_id IS NOT NULL THEN
      -- Update the cat to mark needs_microchip = TRUE
      UPDATE trapper.sot_cats
      SET needs_microchip = TRUE,
          updated_at = NOW()
      WHERE cat_id = v_cat_id
        AND needs_microchip IS DISTINCT FROM TRUE;

      IF v_is_new THEN
        v_cats_created := v_cats_created + 1;
      ELSE
        v_cats_matched := v_cats_matched + 1;
      END IF;

      -- Link cat to appointment if we have an appointment number
      IF v_record.appointment_number IS NOT NULL THEN
        UPDATE trapper.sot_appointments
        SET cat_id = v_cat_id,
            updated_at = NOW()
        WHERE appointment_number = v_record.appointment_number
          AND cat_id IS NULL;

        IF FOUND THEN
          v_appointments_linked := v_appointments_linked + 1;
        END IF;
      END IF;
    END IF;

    -- Mark staged record as processed
    UPDATE trapper.staged_records
    SET processed_at = NOW()
    WHERE id = v_record.staged_record_id;

    v_records_processed := v_records_processed + 1;
  END LOOP;

  v_results := jsonb_build_object(
    'cats_created', v_cats_created,
    'cats_matched', v_cats_matched,
    'appointments_linked', v_appointments_linked,
    'records_processed', v_records_processed,
    'records_skipped_no_id', v_records_skipped_no_id
  );

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_unchipped_cats IS
'Process ClinicHQ cat_info records for cats WITHOUT valid microchips.

Handles cats that were euthanized before microchipping (cancer cases, etc.)
that would otherwise be silently dropped by process_clinichq_cat_info().

Key features:
- Uses enrich_cat() with clinichq_animal_id as stable identifier
- Sets needs_microchip = TRUE on created cats
- Links cats to their appointments via appointment_number
- Skips records where chipped pipeline already linked a cat
- Idempotent: safe to re-run (enrich_cat does SELECT-before-INSERT)

Does NOT modify existing chipped cat pipeline - purely additive.

MIG_891: Created for tracking unchipped cats safely.';

-- ==============================================================
-- Step 2: Count how many unchipped records exist (diagnostic)
-- ==============================================================

\echo ''
\echo 'Counting unprocessed unchipped cat_info records...'

SELECT
  COUNT(*) FILTER (WHERE processed_at IS NULL) AS unprocessed,
  COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS already_processed,
  COUNT(*) FILTER (WHERE source_row_id IS NULL OR TRIM(source_row_id) = '') AS missing_id,
  COUNT(*) AS total
FROM trapper.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'cat_info'
  AND (
    payload->>'Microchip Number' IS NULL
    OR TRIM(payload->>'Microchip Number') = ''
    OR LENGTH(TRIM(payload->>'Microchip Number')) < 9
  );

-- ==============================================================
-- Step 3: Show baseline chipped cat count for verification
-- ==============================================================

\echo ''
\echo 'Current cat counts (for comparison after backfill):'

SELECT
  COUNT(*) AS total_cats,
  COUNT(*) FILTER (WHERE needs_microchip = TRUE) AS needs_microchip_true,
  COUNT(*) FILTER (WHERE needs_microchip = FALSE OR needs_microchip IS NULL) AS has_microchip
FROM trapper.sot_cats
WHERE merged_into_cat_id IS NULL;

\echo ''
\echo '=== MIG_891 complete ==='
\echo ''
\echo 'To process unchipped cats, run:'
\echo '  SELECT * FROM trapper.process_clinichq_unchipped_cats(500);'
\echo ''
\echo 'The function will also be called automatically by the entity-linking cron.'
