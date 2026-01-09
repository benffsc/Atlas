-- QRY_083__request_hist_candidates_report.sql
-- Coverage report for request↔ClinicHQ history link candidates
-- Shows: coverage %, breakdown by match type, score distribution, examples
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_083__request_hist_candidates_report.sql

\pset pager off
\echo '=============================================='
\echo 'REQUEST ↔ CLINICHQ HISTORY CANDIDATES REPORT'
\echo '=============================================='

-- ============================================
-- SECTION 1: Overall coverage
-- ============================================
\echo ''
\echo '--- 1) Coverage Summary ---'

WITH request_match_counts AS (
    SELECT
        r.id AS request_id,
        r.case_number,
        COALESCE(lc.match_count, 0) AS match_count,
        COALESCE(lc.max_score, 0) AS max_score
    FROM trapper.requests r
    LEFT JOIN (
        SELECT
            request_id,
            COUNT(*) AS match_count,
            MAX(match_score) AS max_score
        FROM trapper.v_request_hist_link_candidates
        GROUP BY request_id
    ) lc ON lc.request_id = r.id
    WHERE r.archive_reason IS NULL OR r.archive_reason != 'duplicate'
)
SELECT
    COUNT(*) AS total_active_requests,
    COUNT(*) FILTER (WHERE match_count > 0) AS requests_with_matches,
    COUNT(*) FILTER (WHERE match_count = 0) AS requests_without_matches,
    ROUND(100.0 * COUNT(*) FILTER (WHERE match_count > 0) / NULLIF(COUNT(*), 0), 1) AS coverage_pct,
    SUM(match_count) AS total_candidates
FROM request_match_counts;

-- ============================================
-- SECTION 2: Breakdown by match_kind
-- ============================================
\echo ''
\echo '--- 2) Breakdown by Match Type ---'

SELECT
    match_kind,
    confidence,
    match_score,
    COUNT(*) AS candidate_count,
    COUNT(DISTINCT request_id) AS distinct_requests
FROM trapper.v_request_hist_link_candidates
GROUP BY match_kind, confidence, match_score
ORDER BY match_score DESC, match_kind;

-- ============================================
-- SECTION 3: Candidate count distribution per request
-- ============================================
\echo ''
\echo '--- 3) Candidate Count Distribution (per request) ---'

WITH request_match_counts AS (
    SELECT request_id, COUNT(*) AS cnt
    FROM trapper.v_request_hist_link_candidates
    GROUP BY request_id
),
bucketed AS (
    SELECT
        CASE
            WHEN cnt = 1 THEN '1 candidate'
            WHEN cnt BETWEEN 2 AND 5 THEN '2-5 candidates'
            WHEN cnt BETWEEN 6 AND 10 THEN '6-10 candidates'
            WHEN cnt BETWEEN 11 AND 20 THEN '11-20 candidates'
            WHEN cnt BETWEEN 21 AND 50 THEN '21-50 candidates'
            ELSE '50+ candidates'
        END AS bucket,
        cnt
    FROM request_match_counts
)
SELECT
    bucket,
    COUNT(*) AS request_count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM bucketed
GROUP BY bucket
ORDER BY
    CASE bucket
        WHEN '1 candidate' THEN 1
        WHEN '2-5 candidates' THEN 2
        WHEN '6-10 candidates' THEN 3
        WHEN '11-20 candidates' THEN 4
        WHEN '21-50 candidates' THEN 5
        ELSE 6
    END;

-- ============================================
-- SECTION 4: Requests with most candidates (potential false positives)
-- ============================================
\echo ''
\echo '--- 4) Top 10 Requests by Candidate Count (check for false positives) ---'

SELECT
    lc.case_number,
    COUNT(*) AS candidate_count,
    COUNT(DISTINCT lc.appt_number) AS distinct_appts,
    STRING_AGG(DISTINCT lc.match_kind, ', ' ORDER BY lc.match_kind) AS match_kinds,
    MIN(lc.matched_person_name) AS person_name,
    MIN(lc.phone_normalized) AS matched_phone
FROM trapper.v_request_hist_link_candidates lc
GROUP BY lc.case_number
ORDER BY candidate_count DESC
LIMIT 10;

-- ============================================
-- SECTION 5: Sample high-confidence matches (5 most recent)
-- ============================================
\echo ''
\echo '--- 5) Sample High-Confidence Matches (5 most recent) ---'

SELECT
    case_number,
    match_kind,
    match_score,
    appt_date::text,
    animal_name,
    owner_name,
    surgery_type,
    microchip
FROM trapper.v_request_hist_link_candidates
WHERE match_kind = 'phone'
ORDER BY appt_date DESC NULLS LAST
LIMIT 5;

-- ============================================
-- SECTION 6: Sample medium-confidence matches (5 most recent)
-- ============================================
\echo ''
\echo '--- 6) Sample Medium-Confidence Matches (5 most recent) ---'

SELECT
    case_number,
    match_kind,
    match_score,
    appt_date::text,
    animal_name,
    owner_name,
    surgery_type,
    owner_email
FROM trapper.v_request_hist_link_candidates
WHERE match_kind = 'email'
ORDER BY appt_date DESC NULLS LAST
LIMIT 5;

-- ============================================
-- SECTION 7: Date range of matched appointments
-- ============================================
\echo ''
\echo '--- 7) Matched Appointments Date Range ---'

SELECT
    match_kind,
    MIN(appt_date) AS earliest_match,
    MAX(appt_date) AS latest_match,
    COUNT(DISTINCT appt_date) AS unique_dates
FROM trapper.v_request_hist_link_candidates
WHERE appt_date IS NOT NULL
GROUP BY match_kind
ORDER BY match_kind;

-- ============================================
-- SECTION 8: Surgery type breakdown in matches
-- ============================================
\echo ''
\echo '--- 8) Surgery Type Distribution in Matches ---'

SELECT
    COALESCE(surgery_type, 'Unknown/None') AS surgery_type,
    COUNT(*) AS match_count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.v_request_hist_link_candidates
GROUP BY surgery_type
ORDER BY match_count DESC;

\echo ''
\echo '=============================================='
\echo 'CANDIDATES REPORT COMPLETE'
\echo '=============================================='
