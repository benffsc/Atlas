-- MIG_2865: Re-run foster cross-match after ShelterLuv data ingestion (FFS-265)
--
-- MIG_2857 produced 0 matches because:
-- 1. source.shelterluv_raw was empty (data never ingested)
-- 2. Field paths were wrong (Microchip vs Microchips[0].Id, Foster.Email vs AssociatedPerson)
--
-- After FFS-300 (initial sync) and FFS-301 (processing) populated 24,624 records,
-- this migration re-runs the cross-match with correct ShelterLuv API field paths:
--
-- ShelterLuv API field mapping (discovered during ingestion):
--   Microchip: payload#>>'{Microchips,0,Id}' (array of {Id, Issuer, ImplantUnixTime})
--   Foster name: payload#>>'{AssociatedPerson,FirstName}' / '{AssociatedPerson,LastName}'
--   Foster indicator: payload->>'InFoster' = 'true' OR AssociatedPerson.RelationshipType = 'foster'
--   Person email: person records have 'Email' field (NOT on animal records)
--   Person address: person records have Street, City, State, Zip
--
-- Strategy: Match cat by microchip → get foster name from animal → look up email from person records
--
-- Depends on: MIG_2857 (staging table + view), FFS-300/301 (data populated)
-- Safety: Staging table approach — all results visible before entity linking propagates.

BEGIN;

-- =============================================================================
-- Step 1: Reset the staging table from MIG_2857
-- =============================================================================

TRUNCATE ops.ffsc_foster_cross_match;

-- =============================================================================
-- Step 2: Re-run foster cross-match with correct field paths
-- =============================================================================

DO $$
DECLARE
    r RECORD;
    v_person_id UUID;
    v_place_id UUID;
    v_link_id UUID;
    v_count INTEGER;
    v_total INTEGER;
BEGIN
    -- =========================================================================
    -- Step 2b: Populate with all ffsc_foster cats (deduplicated by cat_id)
    -- =========================================================================

    INSERT INTO ops.ffsc_foster_cross_match (cat_id, microchip, clinichq_client_name, match_status)
    SELECT DISTINCT ON (c.cat_id)
        c.cat_id,
        c.microchip,
        a.client_name,
        CASE WHEN c.microchip IS NULL THEN 'no_microchip' ELSE 'pending' END
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE a.ffsc_program = 'ffsc_foster'
      AND c.merged_into_cat_id IS NULL
    ORDER BY c.cat_id, a.appointment_date DESC;

    GET DIAGNOSTICS v_total = ROW_COUNT;
    SELECT COUNT(*) INTO v_count
    FROM ops.ffsc_foster_cross_match WHERE match_status = 'pending';
    RAISE NOTICE 'Step 2b: Staged % foster cats (% with microchip)', v_total, v_count;

    -- =========================================================================
    -- Step 2c: Match to ShelterLuv animals by microchip
    -- CORRECTED: Uses payload#>>'{Microchips,0,Id}' (JSON array format)
    -- Foster name from payload#>>'{AssociatedPerson,FirstName/LastName}'
    -- =========================================================================

    UPDATE ops.ffsc_foster_cross_match m
    SET shelterluv_record_id = sl.source_record_id,
        foster_first_name = sl.foster_first_name,
        foster_last_name = sl.foster_last_name,
        match_status = CASE
            WHEN sl.foster_first_name IS NOT NULL THEN 'sl_matched_with_name'
            ELSE 'no_foster_name'
        END
    FROM (
        -- Get latest ShelterLuv record per microchip
        SELECT DISTINCT ON (payload#>>'{Microchips,0,Id}')
            source_record_id,
            payload#>>'{AssociatedPerson,FirstName}' AS foster_first_name,
            payload#>>'{AssociatedPerson,LastName}' AS foster_last_name,
            payload#>>'{Microchips,0,Id}' AS microchip
        FROM source.shelterluv_raw
        WHERE record_type = 'animal'
          AND jsonb_array_length(payload->'Microchips') > 0
          AND payload#>>'{Microchips,0,Id}' IS NOT NULL
          AND BTRIM(payload#>>'{Microchips,0,Id}') != ''
        ORDER BY payload#>>'{Microchips,0,Id}', fetched_at DESC
    ) sl
    WHERE m.microchip IS NOT NULL
      AND m.match_status = 'pending'
      AND m.microchip = sl.microchip;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2c: Matched % cats to ShelterLuv records', v_count;

    -- Mark remaining unmatched cats (had microchip but no ShelterLuv match)
    UPDATE ops.ffsc_foster_cross_match
    SET match_status = 'no_sl_match'
    WHERE match_status = 'pending'
      AND microchip IS NOT NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2c: % cats with microchip had no ShelterLuv match', v_count;

    -- =========================================================================
    -- Step 2c2: Look up foster email from ShelterLuv person records by name
    -- Animal records have foster name but NOT email. Person records have email.
    -- Match by Firstname + Lastname (case-insensitive) to get email.
    -- =========================================================================

    UPDATE ops.ffsc_foster_cross_match m
    SET foster_email = sp.email,
        match_status = 'sl_matched_with_email'
    FROM (
        SELECT DISTINCT ON (LOWER(payload->>'Firstname'), LOWER(payload->>'Lastname'))
            payload->>'Firstname' AS first_name,
            payload->>'Lastname' AS last_name,
            payload->>'Email' AS email
        FROM source.shelterluv_raw
        WHERE record_type = 'person'
          AND payload->>'Email' IS NOT NULL
          AND BTRIM(payload->>'Email') != ''
        ORDER BY LOWER(payload->>'Firstname'), LOWER(payload->>'Lastname'),
                 fetched_at DESC
    ) sp
    WHERE m.match_status = 'sl_matched_with_name'
      AND m.foster_first_name IS NOT NULL
      AND LOWER(m.foster_first_name) = LOWER(sp.first_name)
      AND LOWER(m.foster_last_name) = LOWER(sp.last_name);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2c2: Found email for % foster records via name lookup', v_count;

    -- Mark those where name was found but no email match
    UPDATE ops.ffsc_foster_cross_match
    SET match_status = 'no_foster_email'
    WHERE match_status = 'sl_matched_with_name';

    -- =========================================================================
    -- Step 2d: Enrich foster address from ShelterLuv person records
    -- Person records have Street, City, State, Zip fields.
    -- =========================================================================

    UPDATE ops.ffsc_foster_cross_match m
    SET foster_address = BTRIM(
        COALESCE(sp.payload->>'Street', '') || ', ' ||
        COALESCE(sp.payload->>'City', '') || ', ' ||
        COALESCE(sp.payload->>'State', '') || ' ' ||
        COALESCE(sp.payload->>'Zip', '')
    )
    FROM (
        -- Get latest person record per email
        SELECT DISTINCT ON (LOWER(payload->>'Email'))
            payload
        FROM source.shelterluv_raw
        WHERE record_type = 'person'
          AND payload->>'Email' IS NOT NULL
          AND BTRIM(payload->>'Street') != ''
        ORDER BY LOWER(payload->>'Email'), fetched_at DESC
    ) sp
    WHERE m.foster_email IS NOT NULL
      AND m.foster_address IS NULL
      AND LOWER(sp.payload->>'Email') = LOWER(m.foster_email);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2d: Enriched % foster records with addresses', v_count;

    -- Clean up addresses that are just commas/spaces (no real data)
    UPDATE ops.ffsc_foster_cross_match
    SET foster_address = NULL
    WHERE foster_address IS NOT NULL
      AND BTRIM(REGEXP_REPLACE(foster_address, '[, ]+', '', 'g')) = '';

    -- =========================================================================
    -- Step 2e: Resolve foster persons
    -- Uses sot.find_or_create_person() which gates through should_be_person()
    -- and soft blacklist. Exception handler prevents partial failures.
    -- =========================================================================

    v_count := 0;
    FOR r IN
        SELECT id, foster_email, foster_first_name, foster_last_name, foster_address
        FROM ops.ffsc_foster_cross_match
        WHERE match_status = 'sl_matched_with_email'
          AND foster_email IS NOT NULL
    LOOP
        BEGIN
            v_person_id := sot.find_or_create_person(
                r.foster_email,
                NULL,                -- no phone from ShelterLuv foster data
                r.foster_first_name,
                r.foster_last_name,
                r.foster_address,
                'shelterluv'
            );

            IF v_person_id IS NOT NULL THEN
                UPDATE ops.ffsc_foster_cross_match
                SET foster_person_id = v_person_id,
                    match_status = 'matched'
                WHERE id = r.id;

                v_count := v_count + 1;
            ELSE
                UPDATE ops.ffsc_foster_cross_match
                SET match_status = 'email_not_resolved'
                WHERE id = r.id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            UPDATE ops.ffsc_foster_cross_match
            SET match_status = 'email_not_resolved'
            WHERE id = r.id;

            RAISE WARNING 'Failed to resolve foster for email %: %', r.foster_email, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Step 2e: Resolved % foster persons', v_count;

    -- =========================================================================
    -- Step 2f: Create foster person-cat links
    -- Uses sot.link_person_to_cat() with ON CONFLICT for idempotency.
    -- =========================================================================

    v_count := 0;
    FOR r IN
        SELECT id, foster_person_id, cat_id
        FROM ops.ffsc_foster_cross_match
        WHERE match_status = 'matched'
          AND foster_person_id IS NOT NULL
    LOOP
        v_link_id := sot.link_person_to_cat(
            r.foster_person_id,
            r.cat_id,
            'foster',
            'cross_system_match',
            'shelterluv',
            'high'
        );

        IF v_link_id IS NOT NULL THEN
            UPDATE ops.ffsc_foster_cross_match
            SET person_cat_link_id = v_link_id
            WHERE id = r.id;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Step 2f: Created % foster person-cat links', v_count;

    -- =========================================================================
    -- Step 2g: Create foster places from addresses
    -- For foster persons with addresses who don't already have a resident place.
    -- Uses sot.find_or_create_place_deduped() for dedup + address creation.
    -- =========================================================================

    v_count := 0;
    FOR r IN
        SELECT DISTINCT ON (m.foster_person_id)
            m.id, m.foster_person_id, m.foster_address
        FROM ops.ffsc_foster_cross_match m
        WHERE m.match_status = 'matched'
          AND m.foster_person_id IS NOT NULL
          AND m.foster_address IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM sot.person_place pp
              WHERE pp.person_id = m.foster_person_id
                AND pp.relationship_type = 'resident'
          )
        ORDER BY m.foster_person_id, m.created_at
    LOOP
        BEGIN
            v_place_id := sot.find_or_create_place_deduped(
                r.foster_address,
                NULL,        -- no display_name override
                NULL, NULL,  -- no coordinates
                'shelterluv'
            );

            IF v_place_id IS NOT NULL THEN
                PERFORM sot.link_person_to_place(
                    r.foster_person_id,
                    v_place_id,
                    'resident',
                    'cross_system_match',
                    'shelterluv',
                    'medium'
                );

                -- Update all rows for this foster person
                UPDATE ops.ffsc_foster_cross_match
                SET foster_place_id = v_place_id
                WHERE foster_person_id = r.foster_person_id
                  AND match_status = 'matched';

                v_count := v_count + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to create place for person %: %',
                r.foster_person_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Step 2g: Created % foster places', v_count;

    -- =========================================================================
    -- Step 2h: Populate shelterluv_unmatched_fosters review queue
    -- For cats where we had a ShelterLuv match but couldn't resolve the person.
    -- =========================================================================

    INSERT INTO source.shelterluv_unmatched_fosters (
        shelterluv_person_id, first_name, last_name, email,
        animal_count, match_attempted_at, match_error
    )
    SELECT
        m.shelterluv_record_id,
        m.foster_first_name,
        m.foster_last_name,
        m.foster_email,
        1,
        NOW(),
        m.match_status
    FROM ops.ffsc_foster_cross_match m
    WHERE m.match_status IN ('email_not_resolved', 'no_foster_email', 'no_foster_name')
      AND m.shelterluv_record_id IS NOT NULL
    ON CONFLICT (shelterluv_person_id) DO UPDATE SET
        animal_count = source.shelterluv_unmatched_fosters.animal_count + 1,
        match_attempted_at = NOW(),
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2h: Populated % unmatched foster entries', v_count;

    -- =========================================================================
    -- Step 2i: Clean up entity_linking_skipped for newly linked cats
    -- Remove 'ffsc_program_cat' skip entries for cats that now have foster links.
    -- =========================================================================

    DELETE FROM ops.entity_linking_skipped els
    WHERE els.entity_type = 'cat'
      AND els.reason = 'ffsc_program_cat'
      AND EXISTS (
          SELECT 1 FROM ops.ffsc_foster_cross_match m
          WHERE m.cat_id = els.entity_id
            AND m.match_status = 'matched'
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2i: Removed % entity_linking_skipped entries for matched cats', v_count;
END $$;

COMMIT;
