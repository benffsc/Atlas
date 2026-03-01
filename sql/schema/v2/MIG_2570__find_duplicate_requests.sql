-- MIG_2570: Find Duplicate Requests Function
--
-- Problem: No smart matching when creating requests - staff may accidentally
-- create duplicate requests for the same location without realizing an active
-- request already exists.
--
-- Solution: Create function to detect potential duplicate requests based on:
-- 1. Exact place_id match
-- 2. Same phone/email on requester
-- 3. Nearby address (within 100m geocoded)
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2570: Find Duplicate Requests Function'
\echo '=============================================='
\echo ''

-- Drop existing function if it exists (to allow signature changes)
DROP FUNCTION IF EXISTS ops.find_duplicate_requests(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION ops.find_duplicate_requests(
    p_place_id UUID DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_address_text TEXT DEFAULT NULL
)
RETURNS TABLE (
    request_id UUID,
    summary TEXT,
    status TEXT,
    trapper_name TEXT,
    place_address TEXT,
    place_city TEXT,
    created_at TIMESTAMPTZ,
    match_type TEXT,
    distance_m DOUBLE PRECISION
) AS $$
DECLARE
    v_norm_phone TEXT;
    v_norm_email TEXT;
    v_geocoded_point geography;
BEGIN
    -- Normalize inputs
    v_norm_phone := sot.norm_phone_us(p_phone);
    v_norm_email := sot.norm_email(p_email);

    -- If address text provided, try to get geocoded location for proximity matching
    -- (This is a best-effort - if geocoding fails, we still match on other criteria)
    IF p_address_text IS NOT NULL AND p_address_text != '' THEN
        -- Try to find a place with similar address text
        SELECT p.location INTO v_geocoded_point
        FROM sot.places p
        WHERE p.merged_into_place_id IS NULL
          AND p.formatted_address IS NOT NULL
          AND similarity(LOWER(p.formatted_address), LOWER(p_address_text)) > 0.6
        ORDER BY similarity(LOWER(p.formatted_address), LOWER(p_address_text)) DESC
        LIMIT 1;
    END IF;

    RETURN QUERY
    WITH active_requests AS (
        -- Get all non-completed, non-cancelled requests
        SELECT
            r.request_id,
            r.summary,
            r.status,
            r.place_id,
            r.requester_person_id,
            r.created_at
        FROM ops.requests r
        WHERE r.status NOT IN ('completed', 'cancelled')
    ),
    request_matches AS (
        SELECT DISTINCT ON (ar.request_id)
            ar.request_id,
            ar.summary,
            ar.status,
            ar.place_id,
            ar.created_at,
            -- Determine match type (priority order)
            CASE
                -- Exact place match
                WHEN p_place_id IS NOT NULL AND ar.place_id = p_place_id
                    THEN 'exact_place'
                -- Same phone on requester
                WHEN v_norm_phone IS NOT NULL AND EXISTS (
                    SELECT 1 FROM sot.person_identifiers pi
                    WHERE pi.person_id = ar.requester_person_id
                      AND pi.id_type = 'phone'
                      AND pi.id_value_norm = v_norm_phone
                      AND pi.confidence >= 0.5
                ) THEN 'same_phone'
                -- Same email on requester
                WHEN v_norm_email IS NOT NULL AND EXISTS (
                    SELECT 1 FROM sot.person_identifiers pi
                    WHERE pi.person_id = ar.requester_person_id
                      AND pi.id_type = 'email'
                      AND pi.id_value_norm = v_norm_email
                      AND pi.confidence >= 0.5
                ) THEN 'same_email'
                -- Nearby address (within 100m)
                WHEN v_geocoded_point IS NOT NULL AND EXISTS (
                    SELECT 1 FROM sot.places p
                    WHERE p.place_id = ar.place_id
                      AND p.location IS NOT NULL
                      AND ST_DWithin(p.location, v_geocoded_point, 100)
                ) THEN 'nearby_address'
                ELSE NULL
            END AS match_type,
            -- Calculate distance if we have geocoded point
            CASE
                WHEN v_geocoded_point IS NOT NULL THEN (
                    SELECT ST_Distance(p.location, v_geocoded_point)
                    FROM sot.places p
                    WHERE p.place_id = ar.place_id
                      AND p.location IS NOT NULL
                )
                ELSE NULL
            END AS distance_m
        FROM active_requests ar
        WHERE
            -- At least one matching criterion must be true
            (p_place_id IS NOT NULL AND ar.place_id = p_place_id)
            OR (v_norm_phone IS NOT NULL AND EXISTS (
                SELECT 1 FROM sot.person_identifiers pi
                WHERE pi.person_id = ar.requester_person_id
                  AND pi.id_type = 'phone'
                  AND pi.id_value_norm = v_norm_phone
                  AND pi.confidence >= 0.5
            ))
            OR (v_norm_email IS NOT NULL AND EXISTS (
                SELECT 1 FROM sot.person_identifiers pi
                WHERE pi.person_id = ar.requester_person_id
                  AND pi.id_type = 'email'
                  AND pi.id_value_norm = v_norm_email
                  AND pi.confidence >= 0.5
            ))
            OR (v_geocoded_point IS NOT NULL AND EXISTS (
                SELECT 1 FROM sot.places p
                WHERE p.place_id = ar.place_id
                  AND p.location IS NOT NULL
                  AND ST_DWithin(p.location, v_geocoded_point, 100)
            ))
        ORDER BY ar.request_id,
            CASE
                WHEN p_place_id IS NOT NULL AND ar.place_id = p_place_id THEN 1
                WHEN v_norm_phone IS NOT NULL THEN 2
                WHEN v_norm_email IS NOT NULL THEN 3
                ELSE 4
            END
    )
    SELECT
        rm.request_id,
        rm.summary,
        rm.status,
        -- Get primary trapper name
        (
            SELECT p.display_name
            FROM ops.request_trapper_assignments rta
            JOIN sot.people p ON p.person_id = rta.trapper_person_id
            WHERE rta.request_id = rm.request_id
              AND rta.status = 'active'
              AND rta.assignment_type = 'primary'
            LIMIT 1
        ) AS trapper_name,
        -- Get place address
        pl.formatted_address AS place_address,
        pl.place_city,
        rm.created_at,
        rm.match_type,
        rm.distance_m
    FROM request_matches rm
    LEFT JOIN sot.places pl ON pl.place_id = rm.place_id
    WHERE rm.match_type IS NOT NULL
    ORDER BY
        -- Priority: exact_place > same_phone > same_email > nearby_address
        CASE rm.match_type
            WHEN 'exact_place' THEN 1
            WHEN 'same_phone' THEN 2
            WHEN 'same_email' THEN 3
            WHEN 'nearby_address' THEN 4
            ELSE 5
        END,
        rm.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.find_duplicate_requests IS
'Find active requests that may be duplicates based on place, phone, email, or nearby address.
Used by the request creation UI to warn staff before creating duplicate requests.
Returns matches with type: exact_place, same_phone, same_email, nearby_address.
See MIG_2570.';

\echo ''
\echo 'Testing find_duplicate_requests...'

-- Test query (won't return results in most cases, just verifies function compiles)
SELECT 'Function created successfully' AS result
WHERE EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'ops' AND p.proname = 'find_duplicate_requests'
);

\echo ''
\echo '=============================================='
\echo '  MIG_2570 Complete'
\echo '=============================================='
\echo ''
