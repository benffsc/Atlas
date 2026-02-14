\echo '=== MIG_512: Convert Address Identifiers to Place Relationships ==='
\echo 'Creates person_place_relationships from existing address identifiers'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Some people have addresses stored as id_type='address' in person_identifiers
-- but don't have corresponding person_place_relationships.
-- This breaks cross-source enrichment in the data engine.
--
-- SOLUTION:
-- 1. Find people with address identifiers but no place relationships
-- 2. Find or create places for those addresses
-- 3. Create person_place_relationships
-- ============================================================================

-- ============================================================================
-- PART 1: Create function to process address identifiers
-- ============================================================================

\echo '1. Creating process function...'

CREATE OR REPLACE FUNCTION trapper.process_address_identifiers_to_place_relationships(
    p_batch_size INT DEFAULT 100
)
RETURNS JSONB AS $$
DECLARE
    v_processed INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_record RECORD;
    v_place_id UUID;
BEGIN
    -- Find people with address identifiers but no place relationships
    FOR v_record IN
        SELECT
            pi.person_id,
            pi.id_value_norm as address,
            pi.id_value_raw as address_raw,
            pi.source_system
        FROM trapper.person_identifiers pi
        JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
        WHERE pi.id_type = 'address'
          AND sp.merged_into_person_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM trapper.person_place_relationships ppr
              WHERE ppr.person_id = pi.person_id
          )
        LIMIT p_batch_size
    LOOP
        v_processed := v_processed + 1;

        BEGIN
            -- Find or create place for this address
            v_place_id := trapper.find_or_create_place_deduped(
                COALESCE(v_record.address_raw, v_record.address),
                NULL,  -- name
                NULL,  -- lat
                NULL,  -- lng
                v_record.source_system
            );

            IF v_place_id IS NULL THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- Create person_place_relationship
            INSERT INTO trapper.person_place_relationships (
                person_id,
                place_id,
                role,
                source_system,
                confidence,
                note
            ) VALUES (
                v_record.person_id,
                v_place_id,
                'resident',
                v_record.source_system,
                0.9,
                'Created from address identifier backfill'
            )
            ON CONFLICT DO NOTHING;

            v_created := v_created + 1;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing person %: %', v_record.person_id, SQLERRM;
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

COMMENT ON FUNCTION trapper.process_address_identifiers_to_place_relationships IS
'Converts address identifiers to person_place_relationships for data engine enrichment.';

-- ============================================================================
-- PART 2: Run the processor
-- ============================================================================

\echo ''
\echo '2. Processing address identifiers...'

DO $$
DECLARE
    v_result JSONB;
    v_batch INT := 0;
BEGIN
    LOOP
        v_result := trapper.process_address_identifiers_to_place_relationships(50);
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
    'People with address identifiers' as metric,
    COUNT(DISTINCT person_id) as count
FROM trapper.person_identifiers
WHERE id_type = 'address'
UNION ALL
SELECT
    'People with address but NO place relationship',
    COUNT(DISTINCT pi.person_id)
FROM trapper.person_identifiers pi
WHERE pi.id_type = 'address'
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_place_relationships ppr
      WHERE ppr.person_id = pi.person_id
  );

-- Check Claire specifically
\echo ''
\echo 'Claire Simpson place relationships:'
SELECT
    ppr.role,
    ppr.confidence,
    pl.formatted_address,
    ppr.source_system
FROM trapper.person_place_relationships ppr
JOIN trapper.places pl ON pl.place_id = ppr.place_id
WHERE ppr.person_id = '7a9a8d77-a44f-4459-8286-645979838d00';

\echo ''
\echo '=== MIG_512 Complete ==='
\echo ''

SELECT trapper.record_migration(512, 'MIG_512__address_identifiers_to_place_relationships');
