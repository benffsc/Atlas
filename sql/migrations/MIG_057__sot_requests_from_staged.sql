-- MIG_057__sot_requests_from_staged.sql
-- Convert staged trapping_requests to sot_requests
--
-- Problem:
--   1,583 staged trapping_requests exist but 0 sot_requests
--   Users want to search and view historical trapping requests
--
-- Solution:
--   1. Map Airtable case fields to sot_requests columns
--   2. Link to places via address matching
--   3. Link to people via email/phone matching
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_057__sot_requests_from_staged.sql

\echo '============================================'
\echo 'MIG_057: SOT Requests from Staged'
\echo '============================================'

SET statement_timeout = '10min';

-- ============================================
-- PART 1: Create conversion function
-- ============================================
\echo ''
\echo 'Creating conversion function...'

CREATE OR REPLACE FUNCTION trapper.convert_staged_trapping_requests()
RETURNS TABLE (
    requests_created INT,
    requests_linked_to_place INT,
    requests_linked_to_person INT
) AS $$
DECLARE
    v_requests_created INT := 0;
    v_linked_place INT := 0;
    v_linked_person INT := 0;
    v_rec RECORD;
    v_request_id UUID;
    v_place_id UUID;
    v_person_id UUID;
    v_status trapper.request_status;
    v_priority trapper.request_priority;
    v_cat_count INT;
    v_has_kittens BOOLEAN;
BEGIN
    FOR v_rec IN
        SELECT
            sr.id AS staged_record_id,
            sr.payload,
            sr.source_row_id
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'airtable'
          AND sr.source_table = 'trapping_requests'
          AND sr.is_processed = false
    LOOP
        -- Map status
        v_status := CASE UPPER(COALESCE(v_rec.payload->>'Case Status', ''))
            WHEN 'REQUESTED' THEN 'new'
            WHEN 'NEEDS REVIEW' THEN 'triaged'
            WHEN 'IN QUEUE' THEN 'triaged'
            WHEN 'SCHEDULED' THEN 'scheduled'
            WHEN 'IN PROGRESS' THEN 'in_progress'
            WHEN 'COMPLETED' THEN 'completed'
            WHEN 'CANCELLED' THEN 'cancelled'
            WHEN 'ON HOLD' THEN 'on_hold'
            WHEN 'CLOSED' THEN 'completed'
            ELSE 'new'
        END::trapper.request_status;

        -- Map priority
        v_priority := CASE UPPER(COALESCE(v_rec.payload->>'Intake Priority', v_rec.payload->>'Priority (Final Shown)', ''))
            WHEN 'URGENT' THEN 'urgent'
            WHEN 'HIGH' THEN 'high'
            WHEN 'NORMAL' THEN 'normal'
            WHEN 'LOW' THEN 'low'
            ELSE 'normal'
        END::trapper.request_priority;

        -- Parse cat count (extract first number up to 3 digits)
        v_cat_count := (SUBSTRING(COALESCE(v_rec.payload->>'Total Cats to be trapped', v_rec.payload->>'Adult Cats', '0') FROM '^\D*(\d{1,3})')::INT);

        -- Has kittens
        v_has_kittens := COALESCE(v_rec.payload->>'Kittens Present?', '') ILIKE '%yes%'
                      OR COALESCE(v_rec.payload->>'Kittens', '0') != '0';

        -- Find place by address match
        v_place_id := NULL;
        IF v_rec.payload->>'Address' IS NOT NULL AND TRIM(v_rec.payload->>'Address') != '' THEN
            SELECT p.place_id INTO v_place_id
            FROM trapper.places p
            WHERE UPPER(p.formatted_address) = UPPER(TRIM(v_rec.payload->>'Address'))
            LIMIT 1;
        END IF;

        -- Find requester person by email or phone
        v_person_id := NULL;
        -- Try email first
        IF v_rec.payload->>'Clean Email' IS NOT NULL AND v_rec.payload->>'Clean Email' LIKE '%@%' THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'email'
              AND pi.id_value_norm = trapper.norm_email(v_rec.payload->>'Clean Email');
            IF v_person_id IS NOT NULL THEN
                v_person_id := trapper.canonical_person_id(v_person_id);
            END IF;
        END IF;
        -- Try phone
        IF v_person_id IS NULL AND v_rec.payload->>'Clean Phone' IS NOT NULL THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = trapper.norm_phone_us(v_rec.payload->>'Clean Phone');
            IF v_person_id IS NOT NULL THEN
                v_person_id := trapper.canonical_person_id(v_person_id);
            END IF;
        END IF;
        -- Try Client Number
        IF v_person_id IS NULL AND v_rec.payload->>'Client Number' IS NOT NULL THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone'
              AND pi.id_value_norm = trapper.norm_phone_us(v_rec.payload->>'Client Number');
            IF v_person_id IS NOT NULL THEN
                v_person_id := trapper.canonical_person_id(v_person_id);
            END IF;
        END IF;

        -- Create request (with ON CONFLICT to avoid duplicates)
        INSERT INTO trapper.sot_requests (
            status,
            priority,
            place_id,
            requester_person_id,
            summary,
            notes,
            estimated_cat_count,
            has_kittens,
            data_source,
            source_system,
            source_record_id,
            created_at
        ) VALUES (
            v_status,
            v_priority,
            v_place_id,
            v_person_id,
            -- Build summary: prefer Place Name or First+Last, avoid HTML
            COALESCE(
                NULLIF(TRIM(v_rec.payload->>'Request Place Name'), ''),
                CASE
                    WHEN TRIM(COALESCE(v_rec.payload->>'First Name', '')) <> ''
                         AND TRIM(COALESCE(v_rec.payload->>'Last Name', '')) <> ''
                    THEN TRIM(v_rec.payload->>'First Name') || ' ' || TRIM(v_rec.payload->>'Last Name')
                    ELSE NULL
                END,
                CASE
                    WHEN v_rec.payload->>'Address' IS NOT NULL
                         AND LEFT(TRIM(v_rec.payload->>'Address'), 10) NOT LIKE '<%'
                         AND LEFT(TRIM(v_rec.payload->>'Address'), 10) NOT LIKE 'http%'
                    THEN LEFT(TRIM(v_rec.payload->>'Address'), 60)
                    ELSE NULL
                END,
                'Request #' || COALESCE(v_rec.payload->>'Case Number', v_rec.payload->>'Request ID Number', v_rec.source_row_id)
            ),
            NULLIF(TRIM(v_rec.payload->>'Case Info'), ''),
            v_cat_count,
            v_has_kittens,
            'airtable_sync'::trapper.data_source,
            'airtable',
            v_rec.source_row_id,  -- Use staged record's source_row_id directly
            NOW()
        )
        ON CONFLICT (source_system, source_record_id) WHERE source_system IS NOT NULL AND source_record_id IS NOT NULL
        DO UPDATE SET
            status = EXCLUDED.status,
            place_id = COALESCE(EXCLUDED.place_id, trapper.sot_requests.place_id),
            requester_person_id = COALESCE(EXCLUDED.requester_person_id, trapper.sot_requests.requester_person_id),
            updated_at = NOW()
        RETURNING request_id INTO v_request_id;

        v_requests_created := v_requests_created + 1;
        IF v_place_id IS NOT NULL THEN
            v_linked_place := v_linked_place + 1;
        END IF;
        IF v_person_id IS NOT NULL THEN
            v_linked_person := v_linked_person + 1;
        END IF;

        -- Mark staged record as processed
        UPDATE trapper.staged_records
        SET is_processed = true, processed_at = NOW()
        WHERE id = v_rec.staged_record_id;
    END LOOP;

    RETURN QUERY SELECT v_requests_created, v_linked_place, v_linked_person;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.convert_staged_trapping_requests IS
'Converts staged trapping_requests from Airtable into sot_requests.
Links to places via address match and people via email/phone.';

-- ============================================
-- PART 2: Run the conversion
-- ============================================
\echo ''
\echo 'Converting staged trapping_requests...'

SELECT * FROM trapper.convert_staged_trapping_requests();

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification:'

SELECT
    (SELECT COUNT(*) FROM trapper.sot_requests) as total_requests,
    (SELECT COUNT(*) FROM trapper.sot_requests WHERE place_id IS NOT NULL) as linked_to_place,
    (SELECT COUNT(*) FROM trapper.sot_requests WHERE requester_person_id IS NOT NULL) as linked_to_person;

\echo ''
\echo 'Requests by status:'
SELECT status, COUNT(*)
FROM trapper.sot_requests
GROUP BY status
ORDER BY COUNT(*) DESC;

\echo ''
\echo 'Sample requests:'
SELECT
    r.request_id::text,
    r.summary,
    r.status,
    p.formatted_address as place,
    pe.display_name as requester
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_people pe ON pe.person_id = r.requester_person_id
LIMIT 5;

\echo ''
\echo '============================================'
\echo 'MIG_057 Complete'
\echo '============================================'
