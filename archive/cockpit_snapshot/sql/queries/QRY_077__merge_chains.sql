-- QRY_077__merge_chains.sql
-- Show duplicate -> canonical merge chains with hop details
--
-- Purpose: Visualize the merge chain resolution for each duplicate request.
-- Shows the path from duplicate to canonical with depth and archive_reason at each hop.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/queries/QRY_077__merge_chains.sql

\pset pager off
\echo '=============================================='
\echo 'MERGE CHAINS VISUALIZATION'
\echo '=============================================='

-- ============================================
-- 1) FULL MERGE CHAIN PATHS
-- ============================================
\echo ''
\echo '--- Merge Chains (dup_case -> hop1 -> hop2 -> ... -> canonical) ---'

WITH RECURSIVE chain AS (
    -- Start from requests that are duplicates with a merge target
    SELECT
        r.id AS start_id,
        r.case_number AS start_case,
        r.case_number AS current_case,
        r.archive_reason AS current_archive_reason,
        r.merged_into_case_number AS next_case,
        r.case_number::text AS chain_path,
        0 AS depth
    FROM trapper.requests r
    WHERE r.archive_reason = 'duplicate'
      AND (r.merged_into_case_number IS NOT NULL OR r.merged_into_source_record_id IS NOT NULL)

    UNION ALL

    SELECT
        c.start_id,
        c.start_case,
        r.case_number,
        r.archive_reason,
        r.merged_into_case_number,
        c.chain_path || ' -> ' || r.case_number,
        c.depth + 1
    FROM chain c
    JOIN trapper.requests r ON (
        r.case_number = c.next_case
        OR (c.next_case IS NULL AND r.source_record_id = (
            SELECT merged_into_source_record_id FROM trapper.requests WHERE case_number = c.current_case
        ))
    )
    WHERE c.depth < 10
      AND c.next_case IS NOT NULL
)
SELECT DISTINCT ON (start_case)
    start_case AS dup_case,
    current_case AS canonical_case,
    current_archive_reason AS canonical_status,
    depth AS hops,
    chain_path
FROM chain
ORDER BY start_case, depth DESC
LIMIT 50;

-- ============================================
-- 2) CHAINS BY DEPTH
-- ============================================
\echo ''
\echo '--- Chain Depth Distribution ---'

SELECT
    chain_depth,
    COUNT(*) AS count
FROM trapper.v_requests_canonical
WHERE archive_reason = 'duplicate'
GROUP BY chain_depth
ORDER BY chain_depth;

-- ============================================
-- 3) DEEPEST CHAINS (potential data issues)
-- ============================================
\echo ''
\echo '--- Deepest Chains (depth > 1, potential issues) ---'

SELECT
    case_number AS dup_case,
    canonical_case_number,
    chain_depth,
    merged_into_case_number AS direct_target
FROM trapper.v_requests_canonical
WHERE chain_depth > 1
ORDER BY chain_depth DESC, case_number
LIMIT 20;

-- ============================================
-- 4) CANONICAL REQUESTS (targets of merges)
-- ============================================
\echo ''
\echo '--- Most Targeted Canonical Requests ---'

SELECT
    canonical_case_number,
    COUNT(*) AS incoming_merges,
    string_agg(case_number, ', ' ORDER BY case_number) AS merged_cases
FROM trapper.v_requests_canonical
WHERE NOT is_canonical
  AND canonical_case_number IS NOT NULL
GROUP BY canonical_case_number
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ============================================
-- 5) ORPHAN DUPLICATES (no resolvable target)
-- ============================================
\echo ''
\echo '--- Orphan Duplicates (canonical=self despite being duplicate) ---'

SELECT
    case_number,
    archive_reason,
    merged_into_source_record_id,
    merged_into_case_number
FROM trapper.v_requests_canonical
WHERE is_canonical = true
  AND archive_reason = 'duplicate'
ORDER BY case_number
LIMIT 20;

-- ============================================
-- 6) SUMMARY
-- ============================================
\echo ''
\echo '--- Merge Chain Summary ---'

SELECT
    'Total requests' AS metric,
    COUNT(*)::text AS value
FROM trapper.requests
UNION ALL
SELECT
    'Duplicates (archive_reason=duplicate)',
    COUNT(*)::text
FROM trapper.requests WHERE archive_reason = 'duplicate'
UNION ALL
SELECT
    'With resolved canonical',
    COUNT(*)::text
FROM trapper.v_requests_canonical
WHERE NOT is_canonical AND canonical_case_number IS NOT NULL
UNION ALL
SELECT
    'Self-canonical (non-duplicates)',
    COUNT(*)::text
FROM trapper.v_requests_canonical
WHERE is_canonical = true AND (archive_reason IS NULL OR archive_reason != 'duplicate');

\echo ''
\echo '=============================================='
\echo 'MERGE CHAINS QUERY COMPLETE'
\echo '=============================================='
