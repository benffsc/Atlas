\echo '=== MIG_513: Enrich People from VolunteerHub ==='
\echo 'Adds phone identifiers and place relationships from VolunteerHub data'
\echo ''

-- ============================================================================
-- PROBLEM:
-- VolunteerHub has rich volunteer data (addresses, multiple phones, skills)
-- but this data isn't being used to enrich person records.
--
-- SOLUTION:
-- 1. Match VolunteerHub users to existing people via email
-- 2. Add additional phone identifiers (Home Phone, Mobile Phone)
-- 3. Create person_place_relationships from street addresses
-- ============================================================================

-- ============================================================================
-- PART 1: Create enrichment function
-- ============================================================================

\echo '1. Creating enrichment function...'

CREATE OR REPLACE FUNCTION trapper.enrich_from_volunteerhub(
    p_batch_size INT DEFAULT 100
)
RETURNS JSONB AS $$
DECLARE
    v_processed INT := 0;
    v_phones_added INT := 0;
    v_places_added INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_record RECORD;
    v_person_id UUID;
    v_place_id UUID;
    v_phone_norm TEXT;
    v_address TEXT;
BEGIN
    -- Process each VolunteerHub user
    FOR v_record IN
        SELECT
            sr.id as staged_id,
            sr.source_row_id,
            sr.payload->>'Email' as email,
            sr.payload->>'Name - FirstName' as first_name,
            sr.payload->>'Name - LastName' as last_name,
            sr.payload->>'Mobile Phone' as mobile_phone,
            sr.payload->>'Home Phone' as home_phone,
            sr.payload->>'Street Address  - Address1' as street1,
            sr.payload->>'Street Address  - Address2' as street2,
            sr.payload->>'Street Address  - City' as city,
            sr.payload->>'Street Address  - State' as state,
            sr.payload->>'Street Address  - PostalCode' as zip,
            sr.is_processed
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'volunteerhub'
          AND sr.source_table = 'users'
          AND sr.payload->>'Email' IS NOT NULL
          AND TRIM(sr.payload->>'Email') != ''
        LIMIT p_batch_size
    LOOP
        v_processed := v_processed + 1;

        BEGIN
            -- Find person by email
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = LOWER(TRIM(v_record.email))
              AND sp.merged_into_person_id IS NULL
            LIMIT 1;

            IF v_person_id IS NULL THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            -- Add Mobile Phone if not exists
            IF v_record.mobile_phone IS NOT NULL AND TRIM(v_record.mobile_phone) != '' THEN
                v_phone_norm := trapper.norm_phone_us(v_record.mobile_phone);
                IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) = 10 THEN
                    INSERT INTO trapper.person_identifiers (
                        person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
                    ) VALUES (
                        v_person_id, 'phone', v_phone_norm, v_record.mobile_phone, 'volunteerhub', 0.9
                    )
                    ON CONFLICT (id_type, id_value_norm) DO NOTHING;

                    IF FOUND THEN
                        v_phones_added := v_phones_added + 1;
                    END IF;
                END IF;
            END IF;

            -- Add Home Phone if not exists and different from mobile
            IF v_record.home_phone IS NOT NULL AND TRIM(v_record.home_phone) != '' THEN
                v_phone_norm := trapper.norm_phone_us(v_record.home_phone);
                IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) = 10 THEN
                    INSERT INTO trapper.person_identifiers (
                        person_id, id_type, id_value_norm, id_value_raw, source_system, confidence
                    ) VALUES (
                        v_person_id, 'phone', v_phone_norm, v_record.home_phone, 'volunteerhub', 0.8
                    )
                    ON CONFLICT (id_type, id_value_norm) DO NOTHING;

                    IF FOUND THEN
                        v_phones_added := v_phones_added + 1;
                    END IF;
                END IF;
            END IF;

            -- Add place relationship if address exists and person doesn't have one
            IF v_record.street1 IS NOT NULL AND TRIM(v_record.street1) != ''
               AND v_record.city IS NOT NULL AND TRIM(v_record.city) != '' THEN

                -- Check if person already has a place relationship
                IF NOT EXISTS (
                    SELECT 1 FROM trapper.person_place_relationships
                    WHERE person_id = v_person_id
                ) THEN
                    -- Build full address
                    v_address := CONCAT_WS(', ',
                        TRIM(v_record.street1),
                        NULLIF(TRIM(COALESCE(v_record.street2, '')), ''),
                        TRIM(v_record.city),
                        TRIM(COALESCE(v_record.state, 'CA')),
                        TRIM(v_record.zip)
                    );

                    -- Find or create place
                    v_place_id := trapper.find_or_create_place_deduped(
                        v_address,
                        NULL,  -- name
                        NULL,  -- lat
                        NULL,  -- lng
                        'volunteerhub'
                    );

                    IF v_place_id IS NOT NULL THEN
                        INSERT INTO trapper.person_place_relationships (
                            person_id,
                            place_id,
                            role,
                            source_system,
                            confidence,
                            note
                        ) VALUES (
                            v_person_id,
                            v_place_id,
                            'resident',
                            'volunteerhub',
                            0.85,
                            'Enriched from VolunteerHub volunteer profile'
                        )
                        ON CONFLICT DO NOTHING;

                        IF FOUND THEN
                            v_places_added := v_places_added + 1;
                        END IF;
                    END IF;
                END IF;
            END IF;

            -- Mark as processed
            UPDATE trapper.staged_records
            SET is_processed = TRUE, processed_at = NOW()
            WHERE id = v_record.staged_id
              AND is_processed = FALSE;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing VolunteerHub user %: %', v_record.source_row_id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'phones_added', v_phones_added,
        'places_added', v_places_added,
        'skipped', v_skipped,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_from_volunteerhub IS
'Enriches person records with additional phones and addresses from VolunteerHub volunteer profiles.';

-- ============================================================================
-- PART 2: Run the enrichment
-- ============================================================================

\echo ''
\echo '2. Running VolunteerHub enrichment...'

DO $$
DECLARE
    v_result JSONB;
    v_batch INT := 0;
BEGIN
    LOOP
        v_result := trapper.enrich_from_volunteerhub(100);
        v_batch := v_batch + 1;

        RAISE NOTICE 'Batch %: %', v_batch, v_result;

        EXIT WHEN (v_result->>'processed')::INT = 0 OR v_batch >= 20;
    END LOOP;
END $$;

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '3. Verification...'

SELECT
    'Phone identifiers from volunteerhub' as metric,
    COUNT(*) as count
FROM trapper.person_identifiers
WHERE source_system = 'volunteerhub'
  AND id_type = 'phone'
UNION ALL
SELECT
    'Place relationships from volunteerhub',
    COUNT(*)
FROM trapper.person_place_relationships
WHERE source_system = 'volunteerhub';

-- Check Claire specifically
\echo ''
\echo 'Claire Simpson identifiers after enrichment:'
SELECT
    id_type,
    id_value_norm,
    source_system
FROM trapper.person_identifiers
WHERE person_id = '7a9a8d77-a44f-4459-8286-645979838d00'
ORDER BY id_type, source_system;

\echo ''
\echo '=== MIG_513 Complete ==='
\echo ''

SELECT trapper.record_migration(513, 'MIG_513__enrich_from_volunteerhub');
