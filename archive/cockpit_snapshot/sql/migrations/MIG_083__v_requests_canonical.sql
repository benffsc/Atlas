-- MIG_083__v_requests_canonical.sql
-- Creates views for canonical request resolution (following merge chains)
--
-- Purpose:
--   1. v_requests_canonical: Resolves merged_into chains to find the canonical (non-duplicate) request
--   2. v_search_unified_canonical: Joins v_search_unified with canonical info for cockpit search
--
-- NOTE: Does NOT modify v_search_unified (preserves 13-column shape)
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_083__v_requests_canonical.sql

-- ============================================
-- 1) v_requests_canonical VIEW
-- ============================================
-- For each request, resolves the merge chain to find the canonical request.
-- Uses recursive CTE with max depth of 10 to avoid cycles.

CREATE OR REPLACE VIEW trapper.v_requests_canonical AS
WITH RECURSIVE merge_chain AS (
    -- Base case: all requests
    SELECT
        r.id AS request_id,
        r.case_number,
        r.source_record_id,
        r.status::text AS status,
        r.archive_reason,
        r.archived_at,
        r.merged_into_case_number,
        r.merged_into_source_record_id,
        -- Start the chain
        r.id AS current_id,
        r.case_number AS current_case_number,
        r.archive_reason AS current_archive_reason,
        0 AS depth
    FROM trapper.requests r

    UNION ALL

    -- Recursive case: follow merged_into_case_number
    SELECT
        mc.request_id,
        mc.case_number,
        mc.source_record_id,
        mc.status,
        mc.archive_reason,
        mc.archived_at,
        mc.merged_into_case_number,
        mc.merged_into_source_record_id,
        -- Follow the chain
        r.id AS current_id,
        r.case_number AS current_case_number,
        r.archive_reason AS current_archive_reason,
        mc.depth + 1
    FROM merge_chain mc
    JOIN trapper.requests r ON (
        -- Match by case_number if available
        (mc.merged_into_case_number IS NOT NULL AND r.case_number = mc.merged_into_case_number)
        OR
        -- Or match by source_record_id if case_number not resolved
        (mc.merged_into_case_number IS NULL AND mc.merged_into_source_record_id IS NOT NULL
         AND r.source_record_id = mc.merged_into_source_record_id)
    )
    WHERE mc.depth < 10  -- Max depth to prevent cycles
      AND mc.current_archive_reason = 'duplicate'  -- Only follow if current is duplicate
),
-- Get the final canonical for each request (deepest non-duplicate or last in chain)
canonical_resolved AS (
    SELECT DISTINCT ON (request_id)
        request_id,
        case_number,
        source_record_id,
        status,
        archive_reason,
        archived_at,
        merged_into_case_number,
        merged_into_source_record_id,
        current_id AS canonical_request_id,
        current_case_number AS canonical_case_number,
        depth AS chain_depth
    FROM merge_chain
    ORDER BY request_id,
             -- Prefer non-duplicates, then deepest in chain
             CASE WHEN current_archive_reason != 'duplicate' OR current_archive_reason IS NULL THEN 0 ELSE 1 END,
             depth DESC
)
SELECT
    cr.request_id,
    cr.case_number,
    cr.canonical_case_number,
    cr.canonical_request_id,
    (cr.archive_reason IS NOT NULL OR cr.archived_at IS NOT NULL) AS is_archived,
    cr.archive_reason,
    cr.merged_into_case_number,
    cr.merged_into_source_record_id,
    cr.chain_depth,
    -- Self-canonical if no merge or canonical equals self
    (cr.request_id = cr.canonical_request_id) AS is_canonical
FROM canonical_resolved cr;

COMMENT ON VIEW trapper.v_requests_canonical IS
'Resolves merge chains to find the canonical (non-duplicate) request for each request. Use for cockpit to avoid showing duplicates.';

-- ============================================
-- 2) v_search_unified_canonical VIEW
-- ============================================
-- Joins v_search_unified (requests only) with canonical info
-- Allows filtering to show only canonical requests in search

CREATE OR REPLACE VIEW trapper.v_search_unified_canonical AS
SELECT
    s.entity_type,
    s.entity_id,
    s.display_label,
    s.search_text,
    s.name_text,
    s.address_text,
    s.phone_text,
    s.email_text,
    s.city,
    s.postal_code,
    s.location,
    s.relevant_date,
    s.status,
    -- Canonical info (only for requests, NULL otherwise)
    c.canonical_case_number,
    c.canonical_request_id,
    c.is_archived,
    c.archive_reason,
    c.is_canonical
FROM trapper.v_search_unified s
LEFT JOIN trapper.v_requests_canonical c
    ON s.entity_type = 'request' AND s.entity_id = c.request_id;

COMMENT ON VIEW trapper.v_search_unified_canonical IS
'v_search_unified with canonical resolution for requests. Filter with is_canonical=true to hide duplicates.';

-- ============================================
-- 3) VERIFICATION
-- ============================================
\echo ''
\echo '--- Canonical View Summary ---'

SELECT
    'Total requests' AS metric,
    COUNT(*)::text AS value
FROM trapper.v_requests_canonical
UNION ALL
SELECT
    'Self-canonical (is_canonical=true)',
    COUNT(*)::text
FROM trapper.v_requests_canonical
WHERE is_canonical = true
UNION ALL
SELECT
    'Merged duplicates (is_archived + archive_reason=duplicate)',
    COUNT(*)::text
FROM trapper.v_requests_canonical
WHERE is_archived = true AND archive_reason = 'duplicate'
UNION ALL
SELECT
    'Max chain depth',
    MAX(chain_depth)::text
FROM trapper.v_requests_canonical
WHERE chain_depth > 0;

\echo ''
\echo '--- Sample Merge Chains ---'
SELECT
    case_number AS dup_case,
    canonical_case_number,
    archive_reason,
    chain_depth
FROM trapper.v_requests_canonical
WHERE NOT is_canonical
  AND canonical_case_number IS NOT NULL
ORDER BY chain_depth DESC, case_number
LIMIT 10;

\echo ''
\echo '--- v_search_unified_canonical Shape ---'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'v_search_unified_canonical'
ORDER BY ordinal_position;
