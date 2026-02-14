-- MIG_217__requester_cat_place_linkage.sql
-- Create cat_place_relationships when cats are matched to requests via requester
--
-- Problem:
--   - Cats matched via requester_match don't have cat_place_relationships
--   - This causes a_known = 0 in ecology stats even when cats were altered
--   - Dawn Cerini example: Pepper was altered but not counted at her place
--
-- Solution:
--   - Backfill cat_place_relationships from request-matched cats
--   - Add trigger to create these relationships when cats are matched
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_217__requester_cat_place_linkage.sql

\echo ''
\echo 'MIG_217: Requester Cat Place Linkage'
\echo '====================================='
\echo ''

-- ============================================================
-- 1. Create function to link cats to places via requests
-- ============================================================

\echo 'Creating link_request_cats_to_place function...'

CREATE OR REPLACE FUNCTION trapper.link_request_cats_to_place(
    p_request_id UUID
) RETURNS INTEGER AS $$
DECLARE
    v_place_id UUID;
    v_linked_cats JSONB;
    v_cat_record RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Get the request's place_id and linked_cats
    SELECT r.place_id, ras.linked_cats
    INTO v_place_id, v_linked_cats
    FROM trapper.v_request_alteration_stats ras
    JOIN trapper.sot_requests r ON r.request_id = ras.request_id
    WHERE ras.request_id = p_request_id;

    IF v_place_id IS NULL OR v_linked_cats IS NULL THEN
        RETURN 0;
    END IF;

    -- Process each linked cat
    FOR v_cat_record IN
        SELECT
            (cat->>'cat_id')::UUID as cat_id,
            cat->>'match_reason' as match_reason,
            (cat->>'confidence')::NUMERIC as confidence
        FROM jsonb_array_elements(v_linked_cats) as cat
    LOOP
        -- Skip if relationship already exists
        IF EXISTS (
            SELECT 1 FROM trapper.cat_place_relationships
            WHERE cat_id = v_cat_record.cat_id AND place_id = v_place_id
        ) THEN
            CONTINUE;
        END IF;

        -- Create the relationship
        INSERT INTO trapper.cat_place_relationships (
            cat_id,
            place_id,
            relationship_type,
            confidence,
            source_system,
            source_table,
            evidence
        ) VALUES (
            v_cat_record.cat_id,
            v_place_id,
            'residence',  -- Default to residence since they were brought from this location
            v_cat_record.confidence,
            'atlas',
            'request_match',
            jsonb_build_object(
                'request_id', p_request_id,
                'match_reason', v_cat_record.match_reason,
                'linked_at', NOW()
            )
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_request_cats_to_place IS
'Creates cat_place_relationships for cats matched to a request.
Called when cats are matched via requester_match or address_match.
Ensures altered cats are counted in place ecology stats.';

-- ============================================================
-- 2. Backfill existing request-matched cats
-- ============================================================

\echo ''
\echo 'Backfilling cat_place_relationships from request matches...'

DO $$
DECLARE
    v_request RECORD;
    v_total_linked INTEGER := 0;
    v_request_count INTEGER := 0;
BEGIN
    FOR v_request IN
        SELECT ras.request_id, ras.summary
        FROM trapper.v_request_alteration_stats ras
        JOIN trapper.sot_requests r ON r.request_id = ras.request_id
        WHERE r.place_id IS NOT NULL
          AND ras.linked_cats IS NOT NULL
          AND jsonb_array_length(ras.linked_cats) > 0
    LOOP
        v_total_linked := v_total_linked + trapper.link_request_cats_to_place(v_request.request_id);
        v_request_count := v_request_count + 1;

        IF v_request_count % 100 = 0 THEN
            RAISE NOTICE 'Processed % requests, created % cat-place links so far...',
                v_request_count, v_total_linked;
        END IF;
    END LOOP;

    RAISE NOTICE 'Backfill complete: processed % requests, created % cat-place relationships',
        v_request_count, v_total_linked;
END;
$$;

-- ============================================================
-- 3. Create trigger to auto-link new request matches
-- ============================================================

\echo ''
\echo 'Creating trigger for auto-linking request cats...'

-- Note: This requires a mechanism to detect when linked_cats changes.
-- Since linked_cats is computed in a view, we'll need to call
-- link_request_cats_to_place() from the sync process instead.

-- For now, document that the sync scripts should call this function
-- after matching cats to requests.

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Cat-place relationships created:'
SELECT COUNT(*) as total_relationships,
       COUNT(DISTINCT cat_id) as unique_cats,
       COUNT(DISTINCT place_id) as unique_places
FROM trapper.cat_place_relationships
WHERE source_table = 'request_match';

\echo ''
\echo 'Dawn Cerini place check (should have a_known > 0 now):'
SELECT
    place_id,
    display_name,
    a_known,
    n_recent_max,
    p_lower_pct as alteration_rate_pct,
    estimation_method
FROM trapper.v_place_ecology_stats
WHERE place_id = '180dfce7-90d1-4afa-8287-a1acb434c51f';

\echo ''
\echo 'Sample of new cat-place relationships:'
SELECT
    cpr.cat_id,
    c.display_name as cat_name,
    p.display_name as place_name,
    cpr.confidence,
    cpr.evidence->>'match_reason' as match_reason
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
JOIN trapper.places p ON p.place_id = cpr.place_id
WHERE cpr.source_table = 'request_match'
LIMIT 10;

SELECT 'MIG_217 Complete' AS status;
