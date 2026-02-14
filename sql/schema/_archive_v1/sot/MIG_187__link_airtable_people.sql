-- MIG_187: Link Airtable Requests to People/Places
--
-- Problem: 275 Airtable requests have NO_REQUESTER because:
--   1. People in Airtable aren't in sot_people (they came from ClinicHQ)
--   2. Current matching only uses email/phone, not names
--
-- Solution:
--   1. Extract unique people from Airtable trapping requests
--   2. Create them in sot_people (or find existing by email/phone)
--   3. Re-link requests to the correct people
--   4. Handle Is Place? = 1 requests (link to places, not people)

BEGIN;

-- ============================================================================
-- 1. RAW AIRTABLE PEOPLE TABLE
-- ============================================================================
-- Follows the Raw → Normalize → SoT pattern

CREATE TABLE IF NOT EXISTS trapper.raw_airtable_people (
    raw_person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Airtable source
    airtable_client_id TEXT,                -- Linked Client record ID
    airtable_request_id TEXT NOT NULL,      -- Source request ID

    -- Person data extracted from request payload
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,                      -- Client Name field
    email TEXT,
    phone TEXT,
    business_email TEXT,
    business_phone TEXT,

    -- Place detection
    is_place BOOLEAN NOT NULL DEFAULT FALSE,
    place_name TEXT,                        -- If Is Place = 1

    -- Processing
    processing_status TEXT NOT NULL DEFAULT 'pending',
    target_person_id UUID,
    target_place_id UUID,

    -- Audit
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    -- Prevent duplicates
    UNIQUE(airtable_request_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_airtable_people_status ON trapper.raw_airtable_people(processing_status);

-- ============================================================================
-- 2. FUNCTION: Extract people from staged records
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.extract_airtable_people()
RETURNS TABLE(extracted INT, skipped INT) AS $$
DECLARE
    v_extracted INT := 0;
    v_skipped INT := 0;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT
            sr.source_row_id,
            sr.payload
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'airtable'
          AND sr.source_table = 'trapping_requests'
    LOOP
        BEGIN
            INSERT INTO trapper.raw_airtable_people (
                airtable_request_id,
                airtable_client_id,
                first_name,
                last_name,
                display_name,
                email,
                phone,
                business_email,
                business_phone,
                is_place,
                place_name
            ) VALUES (
                v_rec.source_row_id,
                (v_rec.payload->'Linked Clients'->>0),  -- First linked client
                NULLIF(TRIM(v_rec.payload->>'First Name'), ''),
                NULLIF(TRIM(v_rec.payload->>'Last Name'), ''),
                NULLIF(TRIM(v_rec.payload->>'Client Name'), ''),
                COALESCE(
                    NULLIF(TRIM(v_rec.payload->>'Clean Email'), ''),
                    NULLIF(TRIM(v_rec.payload->>'Email'), ''),
                    NULLIF(TRIM(v_rec.payload->>'Client Email (LK)'), '')
                ),
                COALESCE(
                    NULLIF(TRIM(v_rec.payload->>'Clean Phone'), ''),
                    NULLIF(TRIM(v_rec.payload->>'Client Phone (LK)'), ''),
                    NULLIF(TRIM(v_rec.payload->>'Client Number'), '')
                ),
                NULLIF(TRIM(v_rec.payload->>'Business Email'), ''),
                NULLIF(TRIM(v_rec.payload->>'Business Phone'), ''),
                COALESCE((v_rec.payload->>'Is Place?')::INT, 0) = 1,
                CASE
                    WHEN COALESCE((v_rec.payload->>'Is Place?')::INT, 0) = 1
                    THEN COALESCE(
                        NULLIF(TRIM(v_rec.payload->>'Request Place Name'), ''),
                        NULLIF(TRIM(v_rec.payload->>'Client Name'), ''),
                        NULLIF(TRIM(v_rec.payload->'Place Name (LK)'->>0), '')
                    )
                    ELSE NULL
                END
            )
            ON CONFLICT (airtable_request_id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                display_name = EXCLUDED.display_name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                is_place = EXCLUDED.is_place,
                place_name = EXCLUDED.place_name;

            v_extracted := v_extracted + 1;
        EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped + 1;
        END;
    END LOOP;

    RETURN QUERY SELECT v_extracted, v_skipped;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. FUNCTION: Import people to sot_people
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.import_airtable_people()
RETURNS TABLE(created INT, matched INT, places INT) AS $$
DECLARE
    v_created INT := 0;
    v_matched INT := 0;
    v_places INT := 0;
    v_rec RECORD;
    v_person_id UUID;
    v_place_id UUID;
BEGIN
    FOR v_rec IN
        SELECT * FROM trapper.raw_airtable_people
        WHERE processing_status = 'pending'
    LOOP
        -- Handle places
        IF v_rec.is_place AND v_rec.place_name IS NOT NULL THEN
            -- For places, we still might have a contact person
            -- But the primary entity is the place

            -- Check if person contact exists (by email/phone)
            v_person_id := NULL;
            IF v_rec.email IS NOT NULL AND v_rec.email LIKE '%@%' THEN
                SELECT pi.person_id INTO v_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'email'
                  AND pi.id_value_norm = trapper.norm_email(v_rec.email)
                LIMIT 1;
            END IF;

            IF v_person_id IS NULL AND v_rec.phone IS NOT NULL THEN
                SELECT pi.person_id INTO v_person_id
                FROM trapper.person_identifiers pi
                WHERE pi.id_type = 'phone'
                  AND pi.id_value_norm = trapper.norm_phone_us(v_rec.phone)
                LIMIT 1;
            END IF;

            -- Mark as place-based request
            UPDATE trapper.raw_airtable_people
            SET processing_status = 'place_based',
                target_person_id = v_person_id,  -- Contact person if found
                processed_at = NOW()
            WHERE raw_person_id = v_rec.raw_person_id;

            v_places := v_places + 1;
            CONTINUE;
        END IF;

        -- Handle person-based requests
        -- First try to match by email
        v_person_id := NULL;
        IF v_rec.email IS NOT NULL AND v_rec.email LIKE '%@%' THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = trapper.norm_email(v_rec.email)
            LIMIT 1;
        END IF;

        -- Try phone
        IF v_person_id IS NULL AND v_rec.phone IS NOT NULL THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = trapper.norm_phone_us(v_rec.phone)
            LIMIT 1;
        END IF;

        -- Try name match (by display_name)
        IF v_person_id IS NULL AND (v_rec.first_name IS NOT NULL OR v_rec.last_name IS NOT NULL) THEN
            DECLARE
                v_search_name TEXT;
            BEGIN
                v_search_name := TRIM(CONCAT(COALESCE(v_rec.first_name, ''), ' ', COALESCE(v_rec.last_name, '')));
                IF v_search_name != '' THEN
                    SELECT person_id INTO v_person_id
                    FROM trapper.sot_people
                    WHERE display_name ILIKE v_search_name
                      AND merged_into_person_id IS NULL
                    LIMIT 1;
                END IF;
            END;
        END IF;

        IF v_person_id IS NOT NULL THEN
            -- Found existing person
            v_person_id := trapper.canonical_person_id(v_person_id);

            UPDATE trapper.raw_airtable_people
            SET processing_status = 'matched',
                target_person_id = v_person_id,
                processed_at = NOW()
            WHERE raw_person_id = v_rec.raw_person_id;

            v_matched := v_matched + 1;
        ELSE
            -- Need to create new person
            IF v_rec.first_name IS NOT NULL OR v_rec.last_name IS NOT NULL OR v_rec.display_name IS NOT NULL THEN
                INSERT INTO trapper.sot_people (
                    display_name,
                    data_source
                ) VALUES (
                    COALESCE(v_rec.display_name, TRIM(CONCAT(COALESCE(v_rec.first_name, ''), ' ', COALESCE(v_rec.last_name, '')))),
                    'airtable_sync'
                )
                RETURNING person_id INTO v_person_id;

                -- Add email identifier if available
                IF v_rec.email IS NOT NULL AND v_rec.email LIKE '%@%' THEN
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
                    VALUES (v_person_id, 'email', v_rec.email, trapper.norm_email(v_rec.email), 'airtable')
                    ON CONFLICT DO NOTHING;
                END IF;

                -- Add phone identifier if available
                IF v_rec.phone IS NOT NULL THEN
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
                    VALUES (v_person_id, 'phone', v_rec.phone, trapper.norm_phone_us(v_rec.phone), 'airtable')
                    ON CONFLICT DO NOTHING;
                END IF;

                UPDATE trapper.raw_airtable_people
                SET processing_status = 'created',
                    target_person_id = v_person_id,
                    processed_at = NOW()
                WHERE raw_person_id = v_rec.raw_person_id;

                v_created := v_created + 1;
            ELSE
                -- No name data - skip
                UPDATE trapper.raw_airtable_people
                SET processing_status = 'skipped',
                    processed_at = NOW()
                WHERE raw_person_id = v_rec.raw_person_id;
            END IF;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_created, v_matched, v_places;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. FUNCTION: Link requests to people
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.link_requests_to_people()
RETURNS TABLE(linked INT, already_linked INT, not_found INT) AS $$
DECLARE
    v_linked INT := 0;
    v_already INT := 0;
    v_not_found INT := 0;
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT
            rap.airtable_request_id,
            rap.target_person_id,
            rap.processing_status,
            r.request_id,
            r.requester_person_id
        FROM trapper.raw_airtable_people rap
        JOIN trapper.sot_requests r ON r.source_record_id = rap.airtable_request_id
        WHERE rap.processing_status IN ('created', 'matched', 'place_based')
    LOOP
        IF v_rec.requester_person_id IS NOT NULL THEN
            v_already := v_already + 1;
            CONTINUE;
        END IF;

        IF v_rec.target_person_id IS NOT NULL THEN
            UPDATE trapper.sot_requests
            SET requester_person_id = v_rec.target_person_id,
                updated_at = NOW()
            WHERE request_id = v_rec.request_id;

            v_linked := v_linked + 1;
        ELSE
            v_not_found := v_not_found + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_linked, v_already, v_not_found;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. VIEW: People Import Status
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_airtable_people_status AS
SELECT
    processing_status,
    is_place,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE target_person_id IS NOT NULL) as has_person
FROM trapper.raw_airtable_people
GROUP BY processing_status, is_place
ORDER BY processing_status, is_place;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'People extraction table created' AS info;
