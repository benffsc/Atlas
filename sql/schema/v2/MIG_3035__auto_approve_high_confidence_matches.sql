-- MIG_3035: Auto-Approve High-Confidence Match Decisions
--
-- Problem: ~400 pending match decisions in sot.data_engine_match_decisions
-- with scores >= 20. These are extremely high-confidence matches that can
-- be safely auto-approved.
--
-- Score 20+ = email match + phone match + name similarity.
-- Manual review only needed for lower scores.
--
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3035: Auto-Approve High Confidence Matches'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Step 1: Pre-check — how many decisions will be auto-approved
-- ============================================================================

\echo 'Pre-check: Pending match decisions by score range...'

SELECT
  CASE
    WHEN score >= 30 THEN '30+ (very high)'
    WHEN score >= 20 THEN '20-29 (high)'
    WHEN score >= 15 THEN '15-19 (medium)'
    WHEN score >= 10 THEN '10-14 (moderate)'
    ELSE '<10 (low)'
  END as score_range,
  COUNT(*) as pending_count
FROM sot.data_engine_match_decisions
WHERE review_status = 'pending'
  AND reviewed_at IS NULL
GROUP BY 1
ORDER BY 1 DESC;

-- ============================================================================
-- Step 2: Auto-approve score >= 20
-- ============================================================================

\echo ''
\echo 'Auto-approving matches with score >= 20...'

WITH approved AS (
  UPDATE sot.data_engine_match_decisions
  SET
    review_status = 'approved',
    reviewed_at = NOW(),
    reviewed_by = 'auto_approve_high_confidence',
    review_notes = 'MIG_3035: Auto-approved (score >= 20)'
  WHERE review_status = 'pending'
    AND reviewed_at IS NULL
    AND score >= 20
  RETURNING decision_id, person_id_a, person_id_b, score, decision_type
)
SELECT
  COUNT(*) as total_approved,
  MIN(score) as min_score,
  MAX(score) as max_score,
  ROUND(AVG(score), 1) as avg_score
FROM approved;

-- ============================================================================
-- Step 3: Post-check — remaining pending
-- ============================================================================

\echo ''
\echo 'Remaining pending decisions (need manual review):'

SELECT
  COUNT(*) as remaining_pending,
  MIN(score) as min_score,
  MAX(score) as max_score,
  ROUND(AVG(score), 1) as avg_score
FROM sot.data_engine_match_decisions
WHERE review_status = 'pending'
  AND reviewed_at IS NULL;

\echo ''
\echo 'MIG_3035 complete — High-confidence matches auto-approved'
\echo ''
