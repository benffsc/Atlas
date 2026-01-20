-- =====================================================
-- MIG_515: SCAS Animal ID Identifier Type
-- =====================================================
-- Adds scas_animal_id as a cat identifier type so SCAS cats
-- can be found by their shelter ID (e.g., A438751) even
-- without a microchip. Also processes existing SCAS data
-- to create/link cats properly.
-- =====================================================

\echo '=========================================='
\echo 'MIG_515: SCAS Animal ID Identifier'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Create processing function for SCAS cats
-- -----------------------------------------------------

\echo ''
\echo '1. Creating SCAS cat processing function...'

CREATE OR REPLACE FUNCTION trapper.process_scas_cats(
    p_batch_size INT DEFAULT 100
)
RETURNS JSONB AS $$
DECLARE
    v_processed INT := 0;
    v_cats_created INT := 0;
    v_cats_linked INT := 0;
    v_identifiers_added INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_record RECORD;
    v_cat_id UUID;
    v_existing_cat_id UUID;
    v_microchip TEXT;
    v_scas_id TEXT;
BEGIN
    -- Process SCAS records from owner_info
    FOR v_record IN
        SELECT DISTINCT ON (payload->>'Owner First Name')
            sr.id as staged_id,
            sr.source_row_id,
            TRIM(sr.payload->>'Owner First Name') as scas_animal_id,
            TRIM(sr.payload->>'Microchip Number') as microchip,
            sr.payload->>'Patient Name' as patient_name,
            MIN((sr.payload->>'Date')::date) OVER (PARTITION BY sr.payload->>'Owner First Name') as first_visit
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND sr.payload->>'Owner Last Name' = 'SCAS'
          AND sr.payload->>'Owner First Name' IS NOT NULL
          AND TRIM(sr.payload->>'Owner First Name') != ''
          -- Only process records that look like SCAS animal IDs (start with A and have numbers)
          AND TRIM(sr.payload->>'Owner First Name') ~ '^A[0-9]+'
        ORDER BY sr.payload->>'Owner First Name',
                 CASE WHEN LENGTH(TRIM(COALESCE(sr.payload->>'Microchip Number', ''))) >= 9 THEN 0 ELSE 1 END,
                 (sr.payload->>'Date')::date DESC
        LIMIT p_batch_size
    LOOP
        v_processed := v_processed + 1;
        v_scas_id := v_record.scas_animal_id;
        v_microchip := CASE
            WHEN LENGTH(COALESCE(v_record.microchip, '')) >= 9 THEN v_record.microchip
            ELSE NULL
        END;

        BEGIN
            -- Check if cat already exists via SCAS animal ID
            SELECT ci.cat_id INTO v_existing_cat_id
            FROM trapper.cat_identifiers ci
            JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
            WHERE ci.id_type = 'scas_animal_id'
              AND ci.id_value = v_scas_id
            LIMIT 1;

            IF v_existing_cat_id IS NOT NULL THEN
                -- Cat already exists with this SCAS ID
                v_cat_id := v_existing_cat_id;
                v_cats_linked := v_cats_linked + 1;
            ELSE
                -- Check if cat exists via microchip
                IF v_microchip IS NOT NULL THEN
                    SELECT ci.cat_id INTO v_existing_cat_id
                    FROM trapper.cat_identifiers ci
                    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
                    WHERE ci.id_type = 'microchip'
                      AND ci.id_value = v_microchip
                    LIMIT 1;
                END IF;

                IF v_existing_cat_id IS NOT NULL THEN
                    -- Cat exists via microchip, just add SCAS ID
                    v_cat_id := v_existing_cat_id;
                    v_cats_linked := v_cats_linked + 1;
                ELSE
                    -- Create new cat (only if no microchip - cats with microchips should already exist)
                    IF v_microchip IS NULL THEN
                        INSERT INTO trapper.sot_cats (
                            display_name,
                            data_source
                        ) VALUES (
                            COALESCE(NULLIF(TRIM(v_record.patient_name), ''), v_scas_id),
                            'clinichq'
                        )
                        RETURNING cat_id INTO v_cat_id;

                        v_cats_created := v_cats_created + 1;
                    ELSE
                        -- Has microchip but not found - skip, let regular pipeline handle it
                        v_skipped := v_skipped + 1;
                        CONTINUE;
                    END IF;
                END IF;
            END IF;

            -- Add SCAS animal ID identifier if not exists
            INSERT INTO trapper.cat_identifiers (
                cat_id, id_type, id_value, source_system, source_table
            ) VALUES (
                v_cat_id, 'scas_animal_id', v_scas_id, 'clinichq', 'owner_info'
            )
            ON CONFLICT (id_type, id_value) DO NOTHING;

            IF FOUND THEN
                v_identifiers_added := v_identifiers_added + 1;
            END IF;

            -- Add microchip identifier if we have one and it doesn't exist
            IF v_microchip IS NOT NULL THEN
                INSERT INTO trapper.cat_identifiers (
                    cat_id, id_type, id_value, source_system, source_table
                ) VALUES (
                    v_cat_id, 'microchip', v_microchip, 'clinichq', 'owner_info'
                )
                ON CONFLICT (id_type, id_value) DO NOTHING;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing SCAS cat %: %', v_scas_id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'cats_created', v_cats_created,
        'cats_linked', v_cats_linked,
        'identifiers_added', v_identifiers_added,
        'skipped', v_skipped,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_scas_cats IS
'Processes SCAS cats from staged_records, creating sot_cats entries and scas_animal_id identifiers.';

-- -----------------------------------------------------
-- PART 2: Run the processor
-- -----------------------------------------------------

\echo ''
\echo '2. Processing SCAS cats...'

DO $$
DECLARE
    v_result JSONB;
    v_batch INT := 0;
    v_total_created INT := 0;
    v_total_linked INT := 0;
    v_total_identifiers INT := 0;
BEGIN
    LOOP
        v_result := trapper.process_scas_cats(100);
        v_batch := v_batch + 1;

        v_total_created := v_total_created + (v_result->>'cats_created')::INT;
        v_total_linked := v_total_linked + (v_result->>'cats_linked')::INT;
        v_total_identifiers := v_total_identifiers + (v_result->>'identifiers_added')::INT;

        RAISE NOTICE 'Batch %: %', v_batch, v_result;

        EXIT WHEN (v_result->>'processed')::INT = 0 OR v_batch >= 20;
    END LOOP;

    RAISE NOTICE 'Summary - Created: %, Linked: %, Identifiers: %', v_total_created, v_total_linked, v_total_identifiers;
END $$;

-- -----------------------------------------------------
-- PART 3: Verification
-- -----------------------------------------------------

\echo ''
\echo '3. Verification...'

SELECT
    'SCAS animal ID identifiers' as metric,
    COUNT(*) as count
FROM trapper.cat_identifiers
WHERE id_type = 'scas_animal_id'
UNION ALL
SELECT
    'Cats with SCAS ID but no microchip',
    COUNT(DISTINCT ci.cat_id)
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'scas_animal_id'
  AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci2
      WHERE ci2.cat_id = ci.cat_id AND ci2.id_type = 'microchip'
  )
UNION ALL
SELECT
    'Cats with both SCAS ID and microchip',
    COUNT(DISTINCT ci.cat_id)
FROM trapper.cat_identifiers ci
WHERE ci.id_type = 'scas_animal_id'
  AND EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci2
      WHERE ci2.cat_id = ci.cat_id AND ci2.id_type = 'microchip'
  );

\echo ''
\echo '=== MIG_515 Complete ==='
\echo ''

SELECT trapper.record_migration(515, 'MIG_515__scas_animal_id_identifier');
