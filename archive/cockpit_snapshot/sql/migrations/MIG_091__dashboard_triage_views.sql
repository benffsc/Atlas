-- MIG_091__dashboard_triage_views.sql
-- Triage queue views for dashboard actionable buckets
--
-- Creates two views:
-- 1. v_triage_counts - Bucket-level counts for summary display
-- 2. v_triage_items - Prioritized items per bucket for drill-down
--
-- Buckets:
-- - needs_geo: request/place/address missing location
-- - raw_address: address not canonical for the request's primary location
-- - missing_contact: no primary contact and no request_party contact
-- - unassigned: no request_party with role='trapper'
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_091__dashboard_triage_views.sql

-- ============================================
-- VIEW: v_triage_items
-- All open requests with triage bucket assignments
-- ============================================

DROP VIEW IF EXISTS trapper.v_triage_items;
DROP VIEW IF EXISTS trapper.v_triage_counts;

CREATE VIEW trapper.v_triage_items AS
WITH open_requests AS (
    SELECT
        r.id AS request_id,
        r.case_number,
        -- Human-first display name
        COALESCE(
            p.full_name,
            CONCAT_WS(' ', p.first_name, p.last_name),
            pl.name,
            pl.display_name,
            'Case #' || r.case_number
        ) AS display_label,
        r.status::text,
        r.priority,
        r.priority_label,
        -- Address info
        COALESCE(
            addr.formatted_address,
            pl.raw_address
        ) AS address_display,
        addr.formatted_address IS NOT NULL AS address_canonical,
        -- Location
        COALESCE(ST_Y(pl.location), ST_Y(addr.location)) AS location_lat,
        COALESCE(ST_X(pl.location), ST_X(addr.location)) AS location_lng,
        -- Timestamps
        r.created_at,
        r.updated_at,
        -- Triage flags
        (pl.location IS NULL AND addr.location IS NULL) AS needs_geo,
        (addr.formatted_address IS NULL AND pl.raw_address IS NOT NULL) AS raw_address_only,
        (p.phone_normalized IS NULL AND p.email IS NULL) AS missing_contact,
        -- Check for trapper assignment
        NOT EXISTS (
            SELECT 1 FROM trapper.request_parties rp
            WHERE rp.request_id = r.id AND rp.role = 'trapper'
        ) AS unassigned
    FROM trapper.requests r
    LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
    LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
    LEFT JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
    WHERE r.status::text IN ('in_progress', 'active', 'needs_review', 'paused')
      AND (r.archive_reason IS NULL OR r.archive_reason = '')
),
-- Expand each request into bucket rows (one row per bucket it belongs to)
bucketed AS (
    SELECT
        request_id,
        case_number,
        display_label,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        location_lat,
        location_lng,
        created_at,
        updated_at,
        'needs_geo' AS bucket,
        'Missing geolocation' AS reason
    FROM open_requests
    WHERE needs_geo

    UNION ALL

    SELECT
        request_id,
        case_number,
        display_label,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        location_lat,
        location_lng,
        created_at,
        updated_at,
        'raw_address' AS bucket,
        'Raw address only' AS reason
    FROM open_requests
    WHERE raw_address_only

    UNION ALL

    SELECT
        request_id,
        case_number,
        display_label,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        location_lat,
        location_lng,
        created_at,
        updated_at,
        'missing_contact' AS bucket,
        'Missing contact info' AS reason
    FROM open_requests
    WHERE missing_contact

    UNION ALL

    SELECT
        request_id,
        case_number,
        display_label,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        location_lat,
        location_lng,
        created_at,
        updated_at,
        'unassigned' AS bucket,
        'No trapper assigned' AS reason
    FROM open_requests
    WHERE unassigned
)
SELECT
    bucket,
    request_id::text,
    case_number,
    display_label,
    status,
    priority,
    priority_label,
    address_display,
    address_canonical,
    location_lat,
    location_lng,
    created_at,
    updated_at,
    reason,
    -- Rank within each bucket for limiting in queries
    ROW_NUMBER() OVER (
        PARTITION BY bucket
        ORDER BY priority DESC NULLS LAST, updated_at DESC NULLS LAST
    ) AS bucket_rank
FROM bucketed
ORDER BY bucket, bucket_rank;

COMMENT ON VIEW trapper.v_triage_items IS
'Open requests assigned to triage buckets. Each request can appear in multiple buckets.
Buckets: needs_geo, raw_address, missing_contact, unassigned.
Use bucket_rank to limit results per bucket.';

-- ============================================
-- VIEW: v_triage_counts
-- Summary counts per bucket
-- ============================================

CREATE VIEW trapper.v_triage_counts AS
SELECT
    bucket,
    COUNT(DISTINCT request_id) AS count
FROM trapper.v_triage_items
GROUP BY bucket
ORDER BY
    CASE bucket
        WHEN 'needs_geo' THEN 1
        WHEN 'raw_address' THEN 2
        WHEN 'missing_contact' THEN 3
        WHEN 'unassigned' THEN 4
        ELSE 5
    END;

COMMENT ON VIEW trapper.v_triage_counts IS
'Count of open requests per triage bucket for dashboard summary.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Triage views created. Bucket counts:'

SELECT bucket, count FROM trapper.v_triage_counts;

\echo ''
\echo 'Sample items per bucket (top 3 each):'

SELECT bucket, case_number, display_label, reason
FROM trapper.v_triage_items
WHERE bucket_rank <= 3
ORDER BY bucket, bucket_rank;
