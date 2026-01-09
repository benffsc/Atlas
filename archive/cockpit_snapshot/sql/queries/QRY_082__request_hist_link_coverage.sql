-- QRY_082__request_hist_link_coverage.sql
-- Coverage report for request-to-history link candidates
-- Shows how many requests have matches and identifies potential false positives
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_082__request_hist_link_coverage.sql

\pset pager off
\echo '=== REQUEST-HISTORY LINK COVERAGE ==='

-- ============================================
-- SECTION 1: Overall coverage (requests with/without matches)
-- ============================================
\echo ''
\echo '--- Coverage Summary ---'

WITH request_match_counts AS (
    SELECT
        r.case_number,
        COALESCE(lc.match_count, 0) AS match_count
    FROM trapper.requests r
    LEFT JOIN (
        SELECT case_number, COUNT(*) AS match_count
        FROM trapper.v_request_hist_link_candidates
        GROUP BY case_number
    ) lc ON lc.case_number = r.case_number
    WHERE r.archive_reason IS NULL OR r.archive_reason != 'duplicate'
)
SELECT
    'Total active requests' AS metric,
    COUNT(*)::text AS value
FROM request_match_counts
UNION ALL
SELECT
    'Requests with ≥1 candidate',
    COUNT(*)::text
FROM request_match_counts WHERE match_count > 0
UNION ALL
SELECT
    'Requests with 0 candidates',
    COUNT(*)::text
FROM request_match_counts WHERE match_count = 0
UNION ALL
SELECT
    'Coverage %',
    ROUND(100.0 * COUNT(*) FILTER (WHERE match_count > 0) / NULLIF(COUNT(*), 0), 1)::text || '%'
FROM request_match_counts;

-- ============================================
-- SECTION 2: Breakdown by match_kind and confidence
-- ============================================
\echo ''
\echo '--- Breakdown by Match Kind & Confidence ---'

SELECT
    match_kind,
    confidence,
    COUNT(*) AS candidate_count,
    COUNT(DISTINCT case_number) AS distinct_requests
FROM trapper.v_request_hist_link_candidates
GROUP BY match_kind, confidence
ORDER BY confidence DESC, match_kind;

-- ============================================
-- SECTION 3: Distribution of candidate counts per request
-- ============================================
\echo ''
\echo '--- Candidate Count Distribution ---'

WITH request_match_counts AS (
    SELECT case_number, COUNT(*) AS cnt
    FROM trapper.v_request_hist_link_candidates
    GROUP BY case_number
)
SELECT
    CASE
        WHEN cnt = 1 THEN '1 candidate'
        WHEN cnt BETWEEN 2 AND 5 THEN '2-5 candidates'
        WHEN cnt BETWEEN 6 AND 10 THEN '6-10 candidates'
        WHEN cnt BETWEEN 11 AND 20 THEN '11-20 candidates'
        ELSE '20+ candidates'
    END AS bucket,
    COUNT(*) AS request_count
FROM request_match_counts
GROUP BY
    CASE
        WHEN cnt = 1 THEN '1 candidate'
        WHEN cnt BETWEEN 2 AND 5 THEN '2-5 candidates'
        WHEN cnt BETWEEN 6 AND 10 THEN '6-10 candidates'
        WHEN cnt BETWEEN 11 AND 20 THEN '11-20 candidates'
        ELSE '20+ candidates'
    END
ORDER BY
    CASE
        WHEN bucket = '1 candidate' THEN 1
        WHEN bucket = '2-5 candidates' THEN 2
        WHEN bucket = '6-10 candidates' THEN 3
        WHEN bucket = '11-20 candidates' THEN 4
        ELSE 5
    END;

-- ============================================
-- SECTION 4: Top 20 requests with most candidates (false positive check)
-- ============================================
\echo ''
\echo '--- Top 20 Requests by Candidate Count (False Positive Check) ---'

SELECT
    lc.case_number,
    COUNT(*) AS candidate_count,
    COUNT(DISTINCT lc.appt_number) AS distinct_appts,
    STRING_AGG(DISTINCT lc.match_kind, ', ' ORDER BY lc.match_kind) AS match_kinds,
    MIN(lc.matched_person_name) AS person_name
FROM trapper.v_request_hist_link_candidates lc
GROUP BY lc.case_number
ORDER BY candidate_count DESC
LIMIT 20;

-- ============================================
-- SECTION 5: Sample matches for manual review
-- ============================================
\echo ''
\echo '--- Sample Matches (5 high, 5 medium) ---'

(
    SELECT
        case_number,
        match_kind,
        confidence,
        appt_date::text,
        animal_name,
        owner_name,
        microchip
    FROM trapper.v_request_hist_link_candidates
    WHERE confidence = 'high'
    ORDER BY appt_date DESC
    LIMIT 5
)
UNION ALL
(
    SELECT
        case_number,
        match_kind,
        confidence,
        appt_date::text,
        animal_name,
        owner_name,
        microchip
    FROM trapper.v_request_hist_link_candidates
    WHERE confidence = 'medium'
    ORDER BY appt_date DESC
    LIMIT 5
);

\echo ''
\echo '=== COVERAGE REPORT COMPLETE ==='
