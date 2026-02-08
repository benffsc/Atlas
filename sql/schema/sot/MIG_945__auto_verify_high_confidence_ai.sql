\echo ''
\echo '=============================================='
\echo 'MIG_945: Auto-verify High Confidence AI-Parsed Records'
\echo '=============================================='
\echo ''
\echo 'Problem: 1,676 AI-parsed records waiting for manual verification.'
\echo ''
\echo 'Root cause:'
\echo '  - parse_quantitative_data.mjs creates records with source_type = ai_parsed'
\echo '  - All records go to review queue regardless of AI confidence level'
\echo '  - 91% of records are high confidence but still require manual review'
\echo ''
\echo 'Fix:'
\echo '  - Auto-verify existing high-confidence records'
\echo '  - Script already updated to auto-verify new high-confidence records'
\echo ''

-- ============================================================================
-- PART 1: Analyze current state
-- ============================================================================

\echo '1. Analyzing AI-parsed records by confidence...'

SELECT
  CASE
    WHEN notes LIKE '%Confidence: high%' THEN 'high'
    WHEN notes LIKE '%Confidence: medium%' THEN 'medium'
    WHEN notes LIKE '%Confidence: low%' THEN 'low'
    ELSE 'unknown'
  END AS confidence_level,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE verified_at IS NULL) AS unverified,
  COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
FROM trapper.place_colony_estimates
WHERE source_type = 'ai_parsed'
GROUP BY 1
ORDER BY 1;

-- ============================================================================
-- PART 2: Auto-verify high confidence records
-- ============================================================================

\echo ''
\echo '2. Auto-verifying high confidence AI-parsed records...'

WITH updated AS (
  UPDATE trapper.place_colony_estimates
  SET verified_at = NOW()
  WHERE source_type = 'ai_parsed'
    AND verified_at IS NULL
    AND notes LIKE '%Confidence: high%'
  RETURNING estimate_id
)
SELECT COUNT(*) AS high_confidence_auto_verified FROM updated;

-- ============================================================================
-- PART 3: Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'AI-parsed records after auto-verification:'
SELECT
  CASE
    WHEN notes LIKE '%Confidence: high%' THEN 'high'
    WHEN notes LIKE '%Confidence: medium%' THEN 'medium'
    WHEN notes LIKE '%Confidence: low%' THEN 'low'
    ELSE 'unknown'
  END AS confidence_level,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE verified_at IS NULL) AS still_needs_review,
  COUNT(*) FILTER (WHERE verified_at IS NOT NULL) AS verified
FROM trapper.place_colony_estimates
WHERE source_type = 'ai_parsed'
GROUP BY 1
ORDER BY 1;

\echo ''
\echo 'Total remaining for review (medium + low + unknown confidence):'
SELECT COUNT(*) AS remaining_for_review
FROM trapper.place_colony_estimates
WHERE source_type = 'ai_parsed'
  AND verified_at IS NULL;

\echo ''
\echo '=============================================='
\echo 'MIG_945 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Auto-verified all high-confidence AI-parsed colony estimates'
\echo '  - Medium/low confidence records remain for manual review'
\echo ''
\echo 'Script updated separately:'
\echo '  - scripts/jobs/parse_quantitative_data.mjs now auto-verifies high confidence'
\echo ''
