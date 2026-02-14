-- MIG_228: Auto-Queue Geocoding for New Places
--
-- Updates find_or_create_place_deduped to automatically queue places for
-- async geocoding when coordinates aren't provided.

\echo ''
\echo '=============================================='
\echo 'MIG_228: Auto-Queue Geocoding for New Places'
\echo '=============================================='
\echo ''

-- Update find_or_create_place_deduped to queue geocoding
CREATE OR REPLACE FUNCTION trapper.find_or_create_place_deduped(
    p_formatted_address TEXT,
    p_display_name TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas'
)
RETURNS UUID AS $$
DECLARE
    v_normalized TEXT;
    v_existing_id UUID;
    v_new_id UUID;
    v_has_coords BOOLEAN;
BEGIN
    -- Normalize the address
    v_normalized := trapper.normalize_address(p_formatted_address);

    IF v_normalized IS NULL OR v_normalized = '' THEN
        RETURN NULL;
    END IF;

    -- Check for existing place with same normalized address
    SELECT place_id INTO v_existing_id
    FROM trapper.places
    WHERE normalized_address = v_normalized
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN v_existing_id;
    END IF;

    -- Determine if we have coordinates
    v_has_coords := (p_lat IS NOT NULL AND p_lng IS NOT NULL);

    -- Create new place
    INSERT INTO trapper.places (
        display_name,
        formatted_address,
        normalized_address,
        location,
        data_source,
        place_origin,
        -- Queue for geocoding if no coordinates
        geocode_attempts,
        geocode_next_attempt,
        geocode_failed
    ) VALUES (
        COALESCE(p_display_name, p_formatted_address),
        p_formatted_address,
        v_normalized,
        CASE WHEN v_has_coords
             THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
             ELSE NULL END,
        p_source_system::trapper.data_source_type,
        'atlas',
        -- If no coords, mark as needing geocoding (attempts=0, next_attempt=now)
        CASE WHEN v_has_coords THEN NULL ELSE 0 END,
        CASE WHEN v_has_coords THEN NULL ELSE NOW() END,
        FALSE
    )
    RETURNING place_id INTO v_new_id;

    -- Log if we queued for geocoding
    IF NOT v_has_coords THEN
        RAISE NOTICE 'Place % created without coordinates, queued for geocoding: %',
            v_new_id, p_formatted_address;
    END IF;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.find_or_create_place_deduped IS
'Finds existing place by normalized address or creates new one. Prevents duplicates.
If no lat/lng provided, automatically queues the place for async geocoding.';

-- Also update the direct place creation from intake to queue geocoding
CREATE OR REPLACE FUNCTION trapper.link_intake_to_place(
    p_submission_id UUID,
    p_formatted_address TEXT,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
BEGIN
    -- Find or create place using deduped function
    -- If lat/lng are null, the place will be auto-queued for geocoding
    v_place_id := trapper.find_or_create_place_deduped(
        p_formatted_address,
        NULL,  -- display_name (will use address)
        p_lat,
        p_lng,
        'web_intake'
    );

    -- Update submission with place_id
    UPDATE trapper.web_intake_submissions
    SET place_id = v_place_id,
        matched_place_id = v_place_id,
        updated_at = NOW()
    WHERE submission_id = p_submission_id;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_intake_to_place IS
'Links an intake submission to a place (finds existing or creates new).
If no lat/lng provided, the place is auto-queued for background geocoding.
Triggers automatic colony estimate creation via trigger.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification:'

SELECT
  (SELECT COUNT(*) FROM trapper.places WHERE geocode_next_attempt IS NOT NULL AND location IS NULL) as queued_for_geocoding,
  (SELECT COUNT(*) FROM trapper.places WHERE location IS NOT NULL) as already_geocoded;

\echo ''
\echo 'MIG_228 complete!'
\echo ''
\echo 'Changes:'
\echo '  - find_or_create_place_deduped now auto-queues places for geocoding'
\echo '  - New places without coordinates get geocode_next_attempt = NOW()'
\echo '  - link_intake_to_place passes coords to deduped function'
\echo ''
\echo 'Next: Run /api/places/geocode-queue to process queued places'
\echo ''
