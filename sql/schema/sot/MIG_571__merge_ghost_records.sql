\echo '=== MIG_571: Merge Ghost Records from Race Conditions ==='
\echo ''
\echo 'Ghost records are person records where:'
\echo '  - primary_email/primary_phone is set'
\echo '  - BUT no entries exist in person_identifiers'
\echo '  - Caused by race conditions before MIG_568 (advisory locks)'
\echo ''
\echo 'This migration merges them into their canonical counterparts.'
\echo ''

-- Count before
SELECT 'Ghost records to merge:' as status, COUNT(*) as count
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people p_ghost ON p_ghost.person_id = d.resulting_person_id
JOIN trapper.sot_people p_canonical ON p_canonical.person_id = d.top_candidate_person_id
WHERE d.decision_type = 'review_pending'
  AND d.reviewed_at IS NULL
  AND d.resulting_person_id <> d.top_candidate_person_id
  AND p_ghost.merged_into_person_id IS NULL
  AND (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p_ghost.person_id) = 0
  AND p_canonical.merged_into_person_id IS NULL;

-- Merge ghost records into canonical
WITH ghost_records AS (
  SELECT DISTINCT
    d.resulting_person_id as ghost_id,
    d.top_candidate_person_id as canonical_id
  FROM trapper.data_engine_match_decisions d
  JOIN trapper.sot_people p_ghost ON p_ghost.person_id = d.resulting_person_id
  JOIN trapper.sot_people p_canonical ON p_canonical.person_id = d.top_candidate_person_id
  WHERE d.decision_type = 'review_pending'
    AND d.reviewed_at IS NULL
    AND d.resulting_person_id <> d.top_candidate_person_id
    AND p_ghost.merged_into_person_id IS NULL
    AND (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p_ghost.person_id) = 0
    AND p_canonical.merged_into_person_id IS NULL
),
-- Update person_place_relationships
ppr_updated AS (
  UPDATE trapper.person_place_relationships ppr
  SET person_id = gr.canonical_id
  FROM ghost_records gr
  WHERE ppr.person_id = gr.ghost_id
  RETURNING ppr.person_id
),
-- Update person_cat_relationships
pcr_updated AS (
  UPDATE trapper.person_cat_relationships pcr
  SET person_id = gr.canonical_id
  FROM ghost_records gr
  WHERE pcr.person_id = gr.ghost_id
  RETURNING pcr.person_id
),
-- Update request requester
req_updated AS (
  UPDATE trapper.sot_requests r
  SET requester_person_id = gr.canonical_id
  FROM ghost_records gr
  WHERE r.requester_person_id = gr.ghost_id
  RETURNING r.request_id
),
-- Update appointment trapper
appt_updated AS (
  UPDATE trapper.sot_appointments a
  SET trapper_person_id = gr.canonical_id
  FROM ghost_records gr
  WHERE a.trapper_person_id = gr.ghost_id
  RETURNING a.appointment_id
),
-- Mark ghost as merged
merged AS (
  UPDATE trapper.sot_people p
  SET
    merged_into_person_id = gr.canonical_id,
    merged_at = NOW(),
    merge_reason = 'MIG_571: Ghost record from race condition'
  FROM ghost_records gr
  WHERE p.person_id = gr.ghost_id
  RETURNING p.person_id
)
SELECT
  (SELECT COUNT(*) FROM ppr_updated) as place_relationships_updated,
  (SELECT COUNT(*) FROM pcr_updated) as cat_relationships_updated,
  (SELECT COUNT(*) FROM req_updated) as requests_updated,
  (SELECT COUNT(*) FROM appt_updated) as appointments_updated,
  (SELECT COUNT(*) FROM merged) as people_merged;

-- Mark the data_engine decisions as reviewed
UPDATE trapper.data_engine_match_decisions d
SET
  reviewed_at = NOW(),
  reviewed_by = 'system:MIG_571',
  review_action = 'merged',
  review_notes = 'Auto-merged ghost record (no identifiers) into canonical record'
WHERE d.decision_type = 'review_pending'
  AND d.reviewed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM trapper.sot_people p
    WHERE p.person_id = d.resulting_person_id
      AND p.merged_into_person_id IS NOT NULL
      AND p.merge_reason = 'MIG_571: Ghost record from race condition'
  );

-- Count after
SELECT 'Remaining ghost records:' as status, COUNT(*) as count
FROM trapper.data_engine_match_decisions d
JOIN trapper.sot_people p_ghost ON p_ghost.person_id = d.resulting_person_id
WHERE d.decision_type = 'review_pending'
  AND d.reviewed_at IS NULL
  AND p_ghost.merged_into_person_id IS NULL
  AND (SELECT COUNT(*) FROM trapper.person_identifiers pi WHERE pi.person_id = p_ghost.person_id) = 0;

\echo ''
\echo '=== MIG_571 Complete ==='
\echo ''
\echo 'Ghost records have been merged into their canonical counterparts.'
\echo 'The data_engine_match_decisions have been marked as reviewed.'
