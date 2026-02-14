-- MIG_249: Fix Staged Conversion Functions to Use Centralized Functions
--
-- Problem: convert_staged_trapping_requests() does direct lookups instead of
-- using centralized find_or_create_person() and find_or_create_place_deduped()
--
-- This causes:
-- 1. Places not created if they don't exist (only matches existing)
-- 2. Persons not created if they don't exist (only matches existing)
-- 3. No geocoding queue for new places
-- 4. Inconsistent with other ingest patterns
--
-- Fix: Update function to use centralized SQL functions

\echo ''
\echo '=============================================='
\echo 'MIG_249: Fix Staged Conversion Functions'
\echo '=============================================='
\echo ''

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
    v_email TEXT;
    v_phone TEXT;
    v_lat DOUBLE PRECISION;
    v_lng DOUBLE PRECISION;
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

        -- Extract coordinates if available
        v_lat := NULL;
        v_lng := NULL;
        IF v_rec.payload->>'Latitude' ~ '^-?[0-9]+\.?[0-9]*$' THEN
            v_lat := (v_rec.payload->>'Latitude')::DOUBLE PRECISION;
        END IF;
        IF v_rec.payload->>'Longitude' ~ '^-?[0-9]+\.?[0-9]*$' THEN
            v_lng := (v_rec.payload->>'Longitude')::DOUBLE PRECISION;
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

        -- Extract contact info
        v_email := NULLIF(TRIM(v_rec.payload->>'Email'), '');
        v_phone := NULLIF(TRIM(v_rec.payload->>'Clean Phone'), '');
        IF v_phone IS NULL THEN
            v_phone := NULLIF(TRIM(v_rec.payload->>'Client Number'), '');
        END IF;

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

        -- ============================================
        -- USE CENTRALIZED FUNCTIONS (FIXED!)
        -- ============================================

        -- Find or create place using centralized function
        -- This handles: normalization, deduplication, geocoding queue
        v_place_id := NULL;
        IF v_address IS NOT NULL THEN
            v_place_id := trapper.find_or_create_place_deduped(
                v_address,      -- p_formatted_address
                v_place_name,   -- p_display_name (use place name if available)
                v_lat,          -- p_lat (triggers geocoding if NULL)
                v_lng,          -- p_lng
                'airtable'      -- p_source_system
            );
        END IF;

        -- Find or create person using centralized function
        -- This handles: phone normalization, email normalization, identity matching, blacklist
        v_person_id := NULL;
        IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
            v_person_id := trapper.find_or_create_person(
                v_email,        -- p_email
                v_phone,        -- p_phone (raw - function normalizes)
                v_first_name,   -- p_first_name
                v_last_name,    -- p_last_name
                NULL,           -- p_address
                'airtable'      -- p_source_system
            );
        END IF;

        -- Link person to place if both exist
        IF v_person_id IS NOT NULL AND v_place_id IS NOT NULL THEN
            INSERT INTO trapper.person_place_relationships (
                person_id, place_id, role, confidence, source_system
            ) VALUES (
                v_person_id, v_place_id, 'requester', 'high', 'airtable'
            )
            ON CONFLICT (person_id, place_id, role) DO NOTHING;
        END IF;

        -- Insert request
        INSERT INTO trapper.sot_requests (
            status, priority, place_id, requester_person_id, summary, notes,
            estimated_cat_count, has_kittens, data_source, source_system, source_record_id,
            request_place_name, legacy_notes
        ) VALUES (
            v_status, v_priority, v_place_id, v_person_id, v_summary,
            NULLIF(LEFT(TRIM(v_rec.payload->>'Case Info'), 2000), ''),
            v_cat_count, v_has_kittens, 'airtable', 'airtable', v_rec.source_row_id,
            v_place_name, v_internal_notes
        )
        ON CONFLICT (source_system, source_record_id) WHERE source_system IS NOT NULL AND source_record_id IS NOT NULL
        DO UPDATE SET
            place_id = COALESCE(EXCLUDED.place_id, trapper.sot_requests.place_id),
            requester_person_id = COALESCE(EXCLUDED.requester_person_id, trapper.sot_requests.requester_person_id),
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

COMMENT ON FUNCTION trapper.convert_staged_trapping_requests IS
'Converts staged Airtable trapping requests to sot_requests.
Uses centralized functions:
- find_or_create_place_deduped() for place creation (with geocoding queue)
- find_or_create_person() for person creation (with identity matching)
Creates person_place_relationships when both exist.';

\echo ''
\echo '=== MIG_249 Complete ==='
\echo ''
\echo 'Changes:'
\echo '  - convert_staged_trapping_requests now uses find_or_create_place_deduped()'
\echo '  - convert_staged_trapping_requests now uses find_or_create_person()'
\echo '  - Places without coordinates auto-queued for geocoding'
\echo '  - Person-place relationships created automatically'
\echo '  - data_source changed from airtable_sync to airtable'
\echo ''
