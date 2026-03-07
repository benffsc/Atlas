-- ============================================================================
-- MIG_2864: Backfill requestor-place links for existing requests
-- ============================================================================
-- Existing requests have requester_person_id + place_id but no corresponding
-- sot.person_place link. This runs enrich_person_from_request() for all
-- eligible requests that are missing person_place links.
--
-- Safe to re-run: sot.link_person_to_place() uses ON CONFLICT.
--
-- FFS-297
-- ============================================================================

\echo ''
\echo '=========================================='
\echo 'MIG_2864: Backfill requestor-place links'
\echo '=========================================='

-- Show pre-backfill state
\echo ''
\echo 'Pre-backfill: requests with requester + place but no person_place link:'

SELECT COUNT(*) AS missing_links
FROM ops.requests r
WHERE r.requester_person_id IS NOT NULL
  AND r.place_id IS NOT NULL
  AND COALESCE(r.requester_role_at_submission, 'unknown')
      NOT IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff')
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_place pp
    WHERE pp.person_id = r.requester_person_id
      AND pp.place_id = r.place_id
  );

-- Run backfill
\echo ''
\echo 'Running backfill...'

DO $$
DECLARE
  v_total INT := 0;
  v_ok INT := 0;
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT r.request_id
    FROM ops.requests r
    WHERE r.requester_person_id IS NOT NULL
      AND r.place_id IS NOT NULL
      AND COALESCE(r.requester_role_at_submission, 'unknown')
          NOT IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff')
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_place pp
        WHERE pp.person_id = r.requester_person_id
          AND pp.place_id = r.place_id
      )
  LOOP
    v_total := v_total + 1;
    BEGIN
      PERFORM ops.enrich_person_from_request(v_rec.request_id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed for request %: %', v_rec.request_id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Backfill complete: %/% succeeded', v_ok, v_total;
END;
$$;

-- Show post-backfill state
\echo ''
\echo 'Post-backfill: remaining requests without person_place link:'

SELECT COUNT(*) AS still_missing
FROM ops.requests r
WHERE r.requester_person_id IS NOT NULL
  AND r.place_id IS NOT NULL
  AND COALESCE(r.requester_role_at_submission, 'unknown')
      NOT IN ('coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper', 'trapper', 'staff')
  AND NOT EXISTS (
    SELECT 1 FROM sot.person_place pp
    WHERE pp.person_id = r.requester_person_id
      AND pp.place_id = r.place_id
  );

-- Show relationship type breakdown of new links
\echo ''
\echo 'New person_place links by relationship type (from request_report evidence):'

SELECT pp.relationship_type, COUNT(*) AS count
FROM sot.person_place pp
WHERE pp.evidence_type = 'request_report'
GROUP BY pp.relationship_type
ORDER BY count DESC;

\echo ''
\echo '=========================================='
\echo 'MIG_2864 Complete'
\echo '=========================================='
