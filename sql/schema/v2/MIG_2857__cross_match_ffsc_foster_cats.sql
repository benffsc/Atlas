-- MIG_2857: Cross-match FFSC foster cats via microchip to ShelterLuv (FFS-265)
--
-- Problem: 2,754 ffsc_foster cats — ShelterLuv has foster parent info (email,
-- address) for many of these cats, matchable via microchip. Only 4 currently
-- have foster links.
--
-- Approach:
-- 1. Stage all ffsc_foster cats with their microchips
-- 2. Match to ShelterLuv animal records via microchip
-- 3. Extract foster person info (handles both API and XLSX field name formats)
-- 4. Enrich foster address from ShelterLuv person records
-- 5. Resolve foster persons via find_or_create_person()
-- 6. Create foster person-cat links
-- 7. Create foster places from addresses
-- 8. Populate shelterluv_unmatched_fosters review queue
-- 9. Clean up entity_linking_skipped for newly linked cats
-- 10. Create monitoring view
--
-- Depends on: MIG_2855 (ffsc_program classification)

BEGIN;

-- =============================================================================
-- Step 2a: Create staging table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.ffsc_foster_cross_match (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    microchip TEXT,
    clinichq_client_name TEXT,
    -- ShelterLuv side
    shelterluv_record_id TEXT,
    foster_email TEXT,
    foster_first_name TEXT,
    foster_last_name TEXT,
    foster_address TEXT,
    -- Resolution
    foster_person_id UUID,
    foster_place_id UUID,
    person_cat_link_id UUID,
    match_status TEXT,   -- 'matched', 'no_foster_email', 'email_not_resolved', 'no_sl_match', 'no_microchip'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ffsc_foster_cross_match_microchip
    ON ops.ffsc_foster_cross_match(microchip) WHERE microchip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ffsc_foster_cross_match_status
    ON ops.ffsc_foster_cross_match(match_status);
CREATE INDEX IF NOT EXISTS idx_ffsc_foster_cross_match_cat
    ON ops.ffsc_foster_cross_match(cat_id);

-- =============================================================================
-- Steps 2b–2i: Populate, match, resolve, and link
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
    -- Handles both API field names (Microchip) and XLSX (Microchip Number).
    -- Uses latest ShelterLuv record per microchip (DISTINCT ON + ORDER BY fetched_at DESC).
    -- =========================================================================

    UPDATE ops.ffsc_foster_cross_match m
    SET shelterluv_record_id = sl.source_record_id,
        foster_email = COALESCE(
            sl.payload->>'Foster.Email',
            sl.payload->>'Foster Person Email',
            sl.payload->>'FosterEmail'
        ),
        foster_first_name = COALESCE(
            sl.payload->>'Foster.Firstname',
            sl.payload->>'Foster Person Firstname',
            sl.payload->>'FosterFirstname'
        ),
        foster_last_name = COALESCE(
            sl.payload->>'Foster.Lastname',
            sl.payload->>'Foster Person Lastname',
            sl.payload->>'FosterLastname'
        ),
        match_status = CASE
            WHEN COALESCE(
                sl.payload->>'Foster.Email',
                sl.payload->>'Foster Person Email',
                sl.payload->>'FosterEmail'
            ) IS NOT NULL THEN 'sl_matched_with_email'
            ELSE 'no_foster_email'
        END
    FROM (
        -- Get latest ShelterLuv record per microchip
        SELECT DISTINCT ON (
            COALESCE(payload->>'Microchip', payload->>'Microchip Number')
        )
            source_record_id,
            payload
        FROM source.shelterluv_raw
        WHERE record_type = 'animal'
          AND COALESCE(payload->>'Microchip', payload->>'Microchip Number') IS NOT NULL
          AND BTRIM(COALESCE(payload->>'Microchip', payload->>'Microchip Number')) != ''
        ORDER BY COALESCE(payload->>'Microchip', payload->>'Microchip Number'),
                 fetched_at DESC
    ) sl
    WHERE m.microchip IS NOT NULL
      AND m.match_status = 'pending'
      AND m.microchip = BTRIM(COALESCE(sl.payload->>'Microchip', sl.payload->>'Microchip Number'));

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
    -- Step 2d: Enrich foster address from ShelterLuv person records
    -- When we have foster email, look up person records for address info.
    -- =========================================================================

    UPDATE ops.ffsc_foster_cross_match m
    SET foster_address = BTRIM(
        COALESCE(sp.payload->>'Street', sp.payload->>'Address', '') || ', ' ||
        COALESCE(sp.payload->>'City', '') || ', ' ||
        COALESCE(sp.payload->>'State', '') || ' ' ||
        COALESCE(sp.payload->>'Zipcode', sp.payload->>'Zip', '')
    )
    FROM (
        -- Get latest person record per email
        SELECT DISTINCT ON (LOWER(COALESCE(payload->>'Email', payload->>'email')))
            payload
        FROM source.shelterluv_raw
        WHERE record_type = 'person'
          AND COALESCE(payload->>'Email', payload->>'email') IS NOT NULL
          AND COALESCE(payload->>'Street', payload->>'Address', '') != ''
        ORDER BY LOWER(COALESCE(payload->>'Email', payload->>'email')),
                 fetched_at DESC
    ) sp
    WHERE m.foster_email IS NOT NULL
      AND m.foster_address IS NULL
      AND LOWER(COALESCE(sp.payload->>'Email', sp.payload->>'email'))
          = LOWER(m.foster_email);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 2d: Enriched % foster records with addresses', v_count;

    -- Clean up addresses that are just commas/spaces (no real data)
    UPDATE ops.ffsc_foster_cross_match
    SET foster_address = NULL
    WHERE foster_address IS NOT NULL
      AND BTRIM(REGEXP_REPLACE(foster_address, '[, ]+', '', 'g')) = '';

    -- =========================================================================
    -- Step 2e: Resolve foster persons
    -- Uses trapper.find_or_create_person() which gates through should_be_person()
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
            v_person_id := trapper.find_or_create_person(
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
    WHERE m.match_status IN ('email_not_resolved', 'no_foster_email')
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

-- =============================================================================
-- Step 2j: Create monitoring view
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_ffsc_foster_match_status AS
SELECT
    match_status,
    COUNT(*) AS cat_count,
    COUNT(*) FILTER (WHERE foster_person_id IS NOT NULL) AS with_person,
    COUNT(*) FILTER (WHERE foster_place_id IS NOT NULL) AS with_place,
    COUNT(*) FILTER (WHERE person_cat_link_id IS NOT NULL) AS with_link,
    COUNT(DISTINCT foster_person_id) AS unique_fosters
FROM ops.ffsc_foster_cross_match
GROUP BY match_status
ORDER BY cat_count DESC;

COMMIT;
