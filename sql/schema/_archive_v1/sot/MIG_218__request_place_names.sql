-- MIG_218__request_place_names.sql
-- Add place name support from Airtable requests
--
-- Problem:
--   - Airtable has "Client Name" / "Request Place Name" fields (e.g., "Illsley-Navarro Ranch")
--   - These aren't being extracted or used
--   - Places only have addresses as display_name
--
-- Solution:
--   - Add request_place_name column to sot_requests
--   - Update convert function to extract place names
--   - Optionally update place display_name when a meaningful name is provided
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_218__request_place_names.sql

\echo ''
\echo 'MIG_218: Request Place Names'
\echo '============================'
\echo ''

-- ============================================================
-- 1. Add request_place_name column to sot_requests
-- ============================================================

\echo 'Adding request_place_name column...'

ALTER TABLE trapper.sot_requests
ADD COLUMN IF NOT EXISTS request_place_name TEXT;

COMMENT ON COLUMN trapper.sot_requests.request_place_name IS
'Custom name for the request location (e.g., "Illsley-Navarro Ranch"). From Airtable "Client Name" or "Request Place Name" fields.';

-- ============================================================
-- 2. Backfill from Airtable staged records
-- ============================================================

\echo ''
\echo 'Backfilling place names from Airtable records...'

UPDATE trapper.sot_requests r
SET request_place_name = COALESCE(
    NULLIF(TRIM(sr.payload->>'Request Place Name'), ''),
    NULLIF(TRIM(sr.payload->>'Client Name'), '')
)
FROM trapper.staged_records sr
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'trapping_requests'
  AND sr.source_row_id = r.source_record_id
  AND r.source_system = 'airtable'
  AND r.request_place_name IS NULL
  AND (
    NULLIF(TRIM(sr.payload->>'Request Place Name'), '') IS NOT NULL
    OR NULLIF(TRIM(sr.payload->>'Client Name'), '') IS NOT NULL
  );

-- ============================================================
-- 3. Update place display_name when meaningful
-- ============================================================

\echo ''
\echo 'Updating place display_names where we have better names...'

-- Only update if:
-- 1. Request has a place_name that's different from the address
-- 2. The current place display_name is just the address
-- 3. The place_name looks like a real name (not an address)

UPDATE trapper.places p
SET display_name = r.request_place_name,
    updated_at = NOW()
FROM trapper.sot_requests r
WHERE r.place_id = p.place_id
  AND r.request_place_name IS NOT NULL
  AND r.request_place_name !~ '^[0-9]'  -- Doesn't start with a number (not an address)
  AND LENGTH(r.request_place_name) > 3
  AND LENGTH(r.request_place_name) < 100
  -- Only update if current display_name is the address
  AND (p.display_name = p.formatted_address OR p.display_name IS NULL);

-- ============================================================
-- 4. Update convert function to extract place names
-- ============================================================

\echo ''
\echo 'Updating convert_staged_trapping_requests function...'

CREATE OR REPLACE FUNCTION trapper.convert_staged_trapping_requests()
 RETURNS TABLE(requests_created integer, requests_linked_to_place integer, requests_linked_to_person integer)
 LANGUAGE plpgsql
AS $function$
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
    v_summary TEXT;
    v_address TEXT;
    v_first_name TEXT;
    v_last_name TEXT;
    v_place_name TEXT;
    v_internal_notes TEXT;
BEGIN
    FOR v_rec IN
        SELECT sr.id AS staged_record_id, sr.payload, sr.source_row_id
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'airtable' AND sr.source_table = 'trapping_requests'
          AND sr.is_processed = false
    LOOP
        -- Extract and validate First Name (must be alphabetic, < 30 chars)
        v_first_name := TRIM(v_rec.payload->>'First Name');
        IF v_first_name IS NULL OR v_first_name !~ '^[A-Za-z][A-Za-z ]+$' OR LENGTH(v_first_name) > 30 THEN
            v_first_name := NULL;
        END IF;

        -- Extract and validate Last Name
        v_last_name := TRIM(v_rec.payload->>'Last Name');
        IF v_last_name IS NULL OR v_last_name !~ '^[A-Za-z][A-Za-z ]+$' OR LENGTH(v_last_name) > 30 THEN
            v_last_name := NULL;
        END IF;

        -- Extract and validate Address (must start with number, no URLs)
        v_address := TRIM(v_rec.payload->>'Address');
        IF v_address IS NULL OR v_address !~ '^[0-9]' OR v_address LIKE '%http%' THEN
            v_address := NULL;
        END IF;

        -- Extract place name (prefer "Request Place Name", fall back to "Client Name")
        v_place_name := COALESCE(
            NULLIF(TRIM(v_rec.payload->>'Request Place Name'), ''),
            NULLIF(TRIM(v_rec.payload->>'Client Name'), '')
        );
        -- Validate place name (not just an address, not too long)
        IF v_place_name IS NOT NULL AND (v_place_name ~ '^[0-9]' OR LENGTH(v_place_name) > 100) THEN
            v_place_name := NULL;
        END IF;

        -- Extract internal notes
        v_internal_notes := NULLIF(TRIM(v_rec.payload->>'Internal Notes '), '');

        -- Build summary with validated data
        IF v_first_name IS NOT NULL AND v_last_name IS NOT NULL THEN
            v_summary := v_first_name || ' ' || v_last_name;
        ELSIF v_place_name IS NOT NULL THEN
            v_summary := v_place_name;
        ELSIF v_address IS NOT NULL THEN
            v_summary := LEFT(v_address, 60);
        ELSE
            v_summary := 'Airtable Request ' || COALESCE(v_rec.source_row_id, v_rec.staged_record_id::text);
        END IF;

        -- Status (default to new for garbage values)
        v_status := CASE UPPER(COALESCE(v_rec.payload->>'Case Status', ''))
            WHEN 'REQUESTED' THEN 'new'
            WHEN 'NEEDS REVIEW' THEN 'triaged'
            WHEN 'IN QUEUE' THEN 'triaged'
            WHEN 'SCHEDULED' THEN 'scheduled'
            WHEN 'IN PROGRESS' THEN 'in_progress'
            WHEN 'COMPLETED' THEN 'completed'
            WHEN 'CANCELLED' THEN 'cancelled'
            WHEN 'ON HOLD' THEN 'on_hold'
            ELSE 'new'
        END::trapper.request_status;

        v_priority := 'normal'::trapper.request_priority;

        -- Cat count (only if clean numeric)
        v_cat_count := NULL;
        IF v_rec.payload->>'Total Cats to be trapped' ~ '^[0-9]+$' THEN
            v_cat_count := (v_rec.payload->>'Total Cats to be trapped')::INT;
        ELSIF v_rec.payload->>'Adult Cats' ~ '^[0-9]+$' THEN
            v_cat_count := (v_rec.payload->>'Adult Cats')::INT;
        END IF;

        v_has_kittens := COALESCE(v_rec.payload->>'Kittens Present?', '') ILIKE '%yes%';

        -- Find place by address
        v_place_id := NULL;
        IF v_address IS NOT NULL THEN
            SELECT p.place_id INTO v_place_id
            FROM trapper.places p
            WHERE UPPER(p.formatted_address) = UPPER(v_address)
            LIMIT 1;
        END IF;

        -- Find person by phone
        v_person_id := NULL;
        IF v_rec.payload->>'Clean Phone' ~ '[0-9]{10}' THEN
            SELECT pi.person_id INTO v_person_id
            FROM trapper.person_identifiers pi
            WHERE pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(v_rec.payload->>'Clean Phone');
            IF v_person_id IS NOT NULL THEN
                v_person_id := trapper.canonical_person_id(v_person_id);
            END IF;
        END IF;

        -- Insert request
        INSERT INTO trapper.sot_requests (
            status, priority, place_id, requester_person_id, summary, notes,
            estimated_cat_count, has_kittens, data_source, source_system, source_record_id,
            request_place_name, legacy_notes
        ) VALUES (
            v_status, v_priority, v_place_id, v_person_id, v_summary,
            NULLIF(LEFT(TRIM(v_rec.payload->>'Case Info'), 2000), ''),
            v_cat_count, v_has_kittens, 'airtable_sync', 'airtable', v_rec.source_row_id,
            v_place_name, v_internal_notes
        )
        ON CONFLICT (source_system, source_record_id) WHERE source_system IS NOT NULL AND source_record_id IS NOT NULL
        DO UPDATE SET
            request_place_name = COALESCE(EXCLUDED.request_place_name, trapper.sot_requests.request_place_name),
            legacy_notes = COALESCE(EXCLUDED.legacy_notes, trapper.sot_requests.legacy_notes),
            updated_at = NOW()
        RETURNING request_id INTO v_request_id;

        v_requests_created := v_requests_created + 1;
        IF v_place_id IS NOT NULL THEN v_linked_place := v_linked_place + 1; END IF;
        IF v_person_id IS NOT NULL THEN v_linked_person := v_linked_person + 1; END IF;

        UPDATE trapper.staged_records SET is_processed = true, processed_at = NOW() WHERE id = v_rec.staged_record_id;
    END LOOP;

    RETURN QUERY SELECT v_requests_created, v_linked_place, v_linked_person;
END;
$function$;

-- ============================================================
-- 5. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Requests with place names:'
SELECT COUNT(*) as total,
       COUNT(request_place_name) as with_place_name
FROM trapper.sot_requests
WHERE source_system = 'airtable';

\echo ''
\echo 'Sample requests with place names:'
SELECT
    summary,
    request_place_name,
    place_id IS NOT NULL as has_place
FROM trapper.sot_requests
WHERE request_place_name IS NOT NULL
LIMIT 10;

\echo ''
\echo 'Places with custom display names (not just address):'
SELECT COUNT(*) FROM trapper.places
WHERE display_name != formatted_address
  AND display_name IS NOT NULL;

\echo ''
\echo 'Lisa Navarro request check:'
SELECT
    summary,
    request_place_name,
    p.display_name as place_display_name
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
WHERE r.source_record_id = 'reclOFH6mvE14Ti5P';

SELECT 'MIG_218 Complete' AS status;
