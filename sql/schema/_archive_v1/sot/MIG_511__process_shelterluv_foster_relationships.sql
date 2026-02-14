\echo '=== MIG_511: Process ShelterLuv Foster Relationships ==='
\echo 'Links foster people to cats based on ShelterLuv animal records'
\echo ''

-- ============================================================================
-- PROBLEM:
-- ShelterLuv animals have "Foster Person ID/Name/Email" fields but these
-- aren't being processed into person_cat_relationships.
-- 234 foster assignments in staged_records but not linked.
--
-- SOLUTION:
-- 1. Match Foster Person Email to person_identifiers to find person_id
-- 2. Match animal to sot_cats via shelterluv_id in cat_identifiers
-- 3. Create person_cat_relationships with type='foster'
-- ============================================================================

-- ============================================================================
-- PART 1: Create function to process foster relationships
-- ============================================================================

\echo '1. Creating process function...'

CREATE OR REPLACE FUNCTION trapper.process_shelterluv_foster_relationships(
    p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
    v_processed INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_animal RECORD;
    v_person_id UUID;
    v_cat_id UUID;
    v_email_norm TEXT;
    v_shelterluv_id TEXT;
BEGIN
    -- Process each animal with a foster person
    FOR v_animal IN
        SELECT
            sr.id as staged_id,
            sr.source_row_id,
            sr.payload->>'Foster Person Email' as foster_email,
            sr.payload->>'Foster Person Name' as foster_name,
            sr.payload->>'Foster Person ID' as foster_person_id,
            sr.payload->>'Name' as cat_name,
            sr.payload->>'Internal ID (API)' as internal_id
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'animals'
          AND sr.payload->>'Foster Person Email' IS NOT NULL
          AND TRIM(sr.payload->>'Foster Person Email') != ''
        LIMIT p_batch_size
    LOOP
        v_processed := v_processed + 1;

        BEGIN
            -- Normalize email
            v_email_norm := LOWER(TRIM(v_animal.foster_email));

            -- Find person by email
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = v_email_norm
              AND sp.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_person_id IS NULL THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- Find cat by shelterluv_id
            -- Try both formats: 'FFSC-A-XXXX' and 'sl_animal_FFSC-A-XXXX'
            v_shelterluv_id := v_animal.source_row_id;

            SELECT ci.cat_id INTO v_cat_id
            FROM trapper.cat_identifiers ci
            JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
            WHERE ci.id_type = 'shelterluv_id'
              AND (ci.id_value = v_shelterluv_id
                   OR ci.id_value = 'sl_animal_' || v_shelterluv_id
                   OR ci.id_value = REPLACE(v_shelterluv_id, 'sl_animal_', ''))
              AND c.merged_into_cat_id IS NULL
            LIMIT 1;

            IF v_cat_id IS NULL THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- Check if relationship already exists
            IF EXISTS (
                SELECT 1 FROM trapper.person_cat_relationships pcr
                WHERE pcr.person_id = v_person_id
                  AND pcr.cat_id = v_cat_id
                  AND pcr.relationship_type = 'foster'
            ) THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- Create the relationship
            INSERT INTO trapper.person_cat_relationships (
                person_id,
                cat_id,
                relationship_type,
                confidence,
                source_system,
                source_table
            ) VALUES (
                v_person_id,
                v_cat_id,
                'foster',
                'high',
                'shelterluv',
                'animals'
            );

            v_created := v_created + 1;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing animal %: %', v_animal.source_row_id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'created', v_created,
        'skipped', v_skipped,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_shelterluv_foster_relationships IS
'Processes ShelterLuv "Foster Person" fields into person_cat_relationships table.';

-- ============================================================================
-- PART 2: Run the processor
-- ============================================================================

\echo ''
\echo '2. Processing foster relationships...'

DO $$
DECLARE
    v_result JSONB;
    v_batch INT := 0;
BEGIN
    LOOP
        v_result := trapper.process_shelterluv_foster_relationships(200);
        v_batch := v_batch + 1;

        RAISE NOTICE 'Batch %: %', v_batch, v_result;

        EXIT WHEN (v_result->>'processed')::INT = 0 OR v_batch >= 10;
    END LOOP;
END $$;

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '3. Verification...'

SELECT
    relationship_type,
    source_system,
    COUNT(*) as count
FROM trapper.person_cat_relationships
WHERE source_system = 'shelterluv'
GROUP BY relationship_type, source_system;

-- Check Claire specifically
\echo ''
\echo 'Claire Simpson foster relationships:'
SELECT
    pcr.relationship_type,
    c.display_name as cat_name,
    pcr.created_at::date
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
WHERE pcr.person_id = '7a9a8d77-a44f-4459-8286-645979838d00';

\echo ''
\echo '=== MIG_511 Complete ==='
\echo ''

SELECT trapper.record_migration(511, 'MIG_511__process_shelterluv_foster_relationships');
