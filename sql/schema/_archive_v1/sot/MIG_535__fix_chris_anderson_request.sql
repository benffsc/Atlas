\echo ''
\echo '=============================================='
\echo 'MIG_535: Fix Chris Anderson Request Semantic'
\echo '=============================================='
\echo ''
\echo 'Updates the handoff request to Chris Anderson with correct cat count semantic.'
\echo '- 3 cats still need TNR (estimated_cat_count = 3)'
\echo '- 6 total cats at location (3 in clinic today + 3 more)'
\echo ''

-- Find and update the request
-- The request was created via handoff from Nancy Degenkolb to Chris Anderson
-- at 1457 Richardson Santa Rosa

DO $$
DECLARE
    v_request_id UUID;
    v_current_count INTEGER;
BEGIN
    -- Find the request by looking for Chris Anderson as requester
    SELECT r.request_id, r.estimated_cat_count
    INTO v_request_id, v_current_count
    FROM trapper.sot_requests r
    JOIN trapper.sot_people p ON r.requester_person_id = p.person_id
    WHERE p.first_name = 'Chris'
      AND p.last_name = 'Anderson'
      AND r.source_system = 'atlas_ui'
    ORDER BY r.created_at DESC
    LIMIT 1;

    IF v_request_id IS NULL THEN
        RAISE NOTICE 'Request not found - may need to search differently';
        RETURN;
    END IF;

    RAISE NOTICE 'Found request % with estimated_cat_count = %', v_request_id, v_current_count;

    -- Update with correct semantic
    -- estimated_cat_count = 3 (cats still needing TNR - this is already correct)
    -- total_cats_reported = 6 (total colony: 3 in clinic + 3 more)
    -- cat_count_semantic = 'needs_tnr' (new semantic)
    UPDATE trapper.sot_requests
    SET
        cat_count_semantic = 'needs_tnr',
        total_cats_reported = 6
    WHERE request_id = v_request_id;

    RAISE NOTICE 'Updated request % with needs_tnr semantic and total_cats_reported = 6', v_request_id;
END $$;

-- Verify the update
\echo ''
\echo 'Verification:'
SELECT
    r.request_id,
    r.summary,
    p.first_name || ' ' || p.last_name AS requester,
    r.estimated_cat_count AS cats_needing_tnr,
    r.total_cats_reported AS total_colony,
    r.cat_count_semantic
FROM trapper.sot_requests r
LEFT JOIN trapper.sot_people p ON r.requester_person_id = p.person_id
WHERE p.first_name = 'Chris'
  AND p.last_name = 'Anderson'
  AND r.source_system = 'atlas_ui'
ORDER BY r.created_at DESC
LIMIT 1;

\echo ''
\echo 'MIG_535 Complete!'
\echo ''
