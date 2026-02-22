-- MIG_2443: Fix Place Creation for Non-Person Addresses
--
-- Problem: process_clinichq_owner_info() only creates places inside the
-- person-creation loop. If should_be_person() returns FALSE (org, address name),
-- the address is skipped and NO PLACE is created. This caused 319+ addresses
-- to never become places, breaking cat-place linking.
--
-- The TS ingest route correctly creates places for ALL addresses (Step 2),
-- but the SQL processor (cron catch-up) did not.
--
-- Solution: Add a separate step to create places for ALL addresses,
-- regardless of whether a person is created.
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  MIG_2443: Fix Place Creation for Non-Person Addresses'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE HELPER FUNCTION: Create places from ALL owner_info addresses
-- ============================================================================

\echo '1. Creating ops.process_clinichq_addresses()...'

CREATE OR REPLACE FUNCTION ops.process_clinichq_addresses(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE(
    places_created INT,
    appointments_linked INT,
    records_processed INT
) AS $$
DECLARE
    v_places_created INT := 0;
    v_appointments_linked INT := 0;
    v_records_processed INT := 0;
    v_record RECORD;
    v_place_id UUID;
BEGIN
    -- Process ALL owner_info records with addresses (regardless of should_be_person)
    -- This ensures places are created even for orgs, addresses-as-names, etc.
    FOR v_record IN
        SELECT DISTINCT ON (TRIM(sr.payload->>'Owner Address'))
            sr.id as staged_id,
            TRIM(sr.payload->>'Owner Address') as address,
            sr.payload->>'Number' as appointment_number
        FROM ops.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND sr.payload->>'Owner Address' IS NOT NULL
          AND TRIM(sr.payload->>'Owner Address') != ''
          AND LENGTH(TRIM(sr.payload->>'Owner Address')) > 10
          -- Check if a place already exists for this address
          AND NOT EXISTS (
              SELECT 1 FROM sot.places p
              WHERE p.normalized_address = sot.normalize_address(TRIM(sr.payload->>'Owner Address'))
                AND p.merged_into_place_id IS NULL
          )
        ORDER BY TRIM(sr.payload->>'Owner Address'), sr.created_at DESC
        LIMIT p_batch_size
    LOOP
        v_records_processed := v_records_processed + 1;

        -- Create place
        v_place_id := sot.find_or_create_place_deduped(
            v_record.address,
            NULL,  -- display_name
            NULL,  -- lat
            NULL,  -- lng
            'clinichq'
        );

        IF v_place_id IS NOT NULL THEN
            v_places_created := v_places_created + 1;
        END IF;
    END LOOP;

    -- Link appointments to newly created places
    SELECT COALESCE(SUM(CASE WHEN lap.source = 'owner_address' THEN lap.appointments_linked ELSE 0 END), 0)
    INTO v_appointments_linked
    FROM sot.link_appointments_to_places() lap;

    places_created := v_places_created;
    appointments_linked := v_appointments_linked;
    records_processed := v_records_processed;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.process_clinichq_addresses IS
'Creates places from ALL owner_info addresses, regardless of should_be_person().
This ensures places are created even for orgs, addresses-as-names, etc.
Then links appointments to the newly created places.
Called by entity-linking cron after process_clinichq_owner_info().';

\echo '   Created ops.process_clinichq_addresses()'

-- ============================================================================
-- 2. ADD TO REQUIRED FUNCTIONS REGISTRY
-- ============================================================================

\echo ''
\echo '2. Adding to required_functions registry...'

INSERT INTO ops.required_functions (function_name, schema_name, description, called_by, migration_source, is_critical)
VALUES (
    'process_clinichq_addresses',
    'ops',
    'Creates places from ALL owner_info addresses regardless of should_be_person()',
    'entity-linking cron',
    'MIG_2443',
    FALSE  -- Non-critical since TS route also creates places
)
ON CONFLICT (function_name) DO UPDATE SET
    description = EXCLUDED.description,
    called_by = EXCLUDED.called_by,
    migration_source = EXCLUDED.migration_source;

\echo '   Added to registry'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing ops.process_clinichq_addresses():'
SELECT * FROM ops.process_clinichq_addresses(100);

\echo ''
\echo '=============================================='
\echo '  MIG_2443 Complete!'
\echo '=============================================='
\echo ''
\echo 'The entity-linking cron should now call:'
\echo '  1. ops.process_clinichq_cat_info()'
\echo '  2. ops.process_clinichq_owner_info()'
\echo '  3. ops.process_clinichq_addresses()  <-- NEW'
\echo '  4. ops.process_clinichq_unchipped_cats()'
\echo '  5. sot.run_all_entity_linking()'
\echo ''
