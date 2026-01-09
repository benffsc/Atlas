-- MIG_095__assignment_signal.sql
-- Add assignment signal to requests + fix triage views for stable buckets
--
-- This migration:
-- 1. Adds assignment columns to requests table
-- 2. Creates v_request_assignment_current view (abstraction layer)
-- 3. Updates triage views to show all buckets consistently (including zeros)
-- 4. Updates dashboard view to include assignment info
--
-- APPLY MANUALLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_095__assignment_signal.sql

-- ============================================
-- PART 1: Add assignment columns to requests
-- ============================================

-- Add assignment columns (safe: columns don't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'requests'
        AND column_name = 'assigned_trapper_person_id'
    ) THEN
        ALTER TABLE trapper.requests
        ADD COLUMN assigned_trapper_person_id UUID NULL REFERENCES trapper.people(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper' AND table_name = 'requests'
        AND column_name = 'assigned_at'
    ) THEN
        ALTER TABLE trapper.requests
        ADD COLUMN assigned_at TIMESTAMPTZ NULL;
    END IF;
END $$;

-- Index for assignment lookups
CREATE INDEX IF NOT EXISTS idx_requests_assigned_trapper
ON trapper.requests (assigned_trapper_person_id)
WHERE assigned_trapper_person_id IS NOT NULL;

COMMENT ON COLUMN trapper.requests.assigned_trapper_person_id IS
'Current trapper assigned to this request. NULL = unassigned.';

COMMENT ON COLUMN trapper.requests.assigned_at IS
'Timestamp when the current trapper was assigned.';

-- ============================================
-- PART 2: Create assignment abstraction view
-- ============================================

DROP VIEW IF EXISTS trapper.v_request_assignment_current;

CREATE VIEW trapper.v_request_assignment_current AS
SELECT
    r.id AS request_id,
    r.case_number,
    r.assigned_trapper_person_id,
    p.full_name AS assigned_trapper_name,
    p.email AS assigned_trapper_email,
    p.phone AS assigned_trapper_phone,
    r.assigned_at,
    r.assigned_trapper_person_id IS NOT NULL AS is_assigned
FROM trapper.requests r
LEFT JOIN trapper.people p ON p.id = r.assigned_trapper_person_id;

COMMENT ON VIEW trapper.v_request_assignment_current IS
'Current assignment for each request. Abstraction layer for future migration to history-based assignments.';

-- ============================================
-- PART 3: Update triage views for stable buckets
-- ============================================

-- Drop existing views to recreate with fixes
DROP VIEW IF EXISTS trapper.v_triage_counts;
DROP VIEW IF EXISTS trapper.v_triage_items;

-- Recreate v_triage_items with fixed unassigned logic
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
        -- NEW: Use actual assignment column
        (r.assigned_trapper_person_id IS NULL) AS unassigned
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
'Open requests assigned to triage buckets. Uses assigned_trapper_person_id for unassigned check.
Buckets: needs_geo, raw_address, missing_contact, unassigned.';

-- Recreate v_triage_counts with ALL buckets (including zeros)
CREATE VIEW trapper.v_triage_counts AS
WITH all_buckets AS (
    SELECT unnest(ARRAY['needs_geo', 'raw_address', 'missing_contact', 'unassigned']) AS bucket
),
actual_counts AS (
    SELECT bucket, COUNT(DISTINCT request_id) AS count
    FROM trapper.v_triage_items
    GROUP BY bucket
)
SELECT
    b.bucket,
    COALESCE(c.count, 0)::int AS count
FROM all_buckets b
LEFT JOIN actual_counts c ON c.bucket = b.bucket
ORDER BY
    CASE b.bucket
        WHEN 'needs_geo' THEN 1
        WHEN 'raw_address' THEN 2
        WHEN 'missing_contact' THEN 3
        WHEN 'unassigned' THEN 4
        ELSE 5
    END;

COMMENT ON VIEW trapper.v_triage_counts IS
'Count of open requests per triage bucket. Always returns all 4 buckets (including zeros).';

-- ============================================
-- PART 4: Update dashboard open requests view
-- ============================================

DROP VIEW IF EXISTS trapper.v_dashboard_open_requests;

CREATE VIEW trapper.v_dashboard_open_requests AS
SELECT
    r.id AS request_id,
    r.case_number,
    -- Human-first display name: prefer person/place name, fallback to Case #
    COALESCE(
        p.full_name,
        CONCAT_WS(' ', p.first_name, p.last_name),
        pl.name,
        pl.display_name,
        'Case #' || r.case_number
    ) AS request_display_name,
    r.status::text,
    r.priority_label,
    -- Address info from place -> address chain
    COALESCE(
        addr.formatted_address,
        pl.raw_address
    ) AS primary_address_display,
    addr.formatted_address IS NOT NULL AS primary_address_canonical,
    addr.city,
    addr.postal_code,
    -- Location from place
    ST_Y(pl.location) AS location_lat,
    ST_X(pl.location) AS location_lng,
    -- Contact info
    p.phone_normalized AS contact_phone,
    p.email AS contact_email,
    -- Timestamps
    r.created_at,
    r.updated_at,
    -- Data quality flags
    (pl.location IS NULL AND addr.location IS NULL) AS needs_geo,
    (addr.formatted_address IS NULL AND pl.raw_address IS NOT NULL) AS raw_address_only,
    (p.phone_normalized IS NULL AND p.email IS NULL) AS missing_contact,
    -- Combined attention flag
    (
        (pl.location IS NULL AND addr.location IS NULL) OR
        (addr.formatted_address IS NULL AND pl.raw_address IS NOT NULL) OR
        (p.phone_normalized IS NULL AND p.email IS NULL) OR
        r.status::text = 'needs_review'
    ) AS needs_attention,
    -- Reason text for needs_attention
    CASE
        WHEN r.status::text = 'needs_review' THEN 'Status: Needs Review'
        WHEN (pl.location IS NULL AND addr.location IS NULL) THEN 'Missing geolocation'
        WHEN (addr.formatted_address IS NULL AND pl.raw_address IS NOT NULL) THEN 'Raw address only'
        WHEN (p.phone_normalized IS NULL AND p.email IS NULL) THEN 'Missing contact info'
        ELSE NULL
    END AS attention_reason,
    -- NEW: Assignment info
    r.assigned_trapper_person_id,
    trapper.full_name AS assigned_trapper_display,
    r.assigned_trapper_person_id IS NOT NULL AS is_assigned
FROM trapper.requests r
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
LEFT JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
LEFT JOIN trapper.people trapper ON trapper.id = r.assigned_trapper_person_id
WHERE r.status::text IN ('in_progress', 'active', 'needs_review', 'paused')
  AND (r.archive_reason IS NULL OR r.archive_reason = '')
ORDER BY
    -- Needs attention first
    (CASE WHEN r.status::text = 'needs_review' THEN 0 ELSE 1 END),
    -- Then by priority (if set) and update date
    r.priority DESC NULLS LAST,
    r.updated_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_dashboard_open_requests IS
'Open/active requests with data quality flags and assignment info for dashboard display.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'MIG_095 complete. Verifying:'
\echo ''
\echo 'New columns on requests:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'requests'
  AND column_name IN ('assigned_trapper_person_id', 'assigned_at')
ORDER BY column_name;

\echo ''
\echo 'Triage bucket counts (should show all 4 buckets):'
SELECT bucket, count FROM trapper.v_triage_counts ORDER BY bucket;

\echo ''
\echo 'Sample unassigned items (should now reflect actual assignment, not role check):'
SELECT bucket, case_number, display_label
FROM trapper.v_triage_items
WHERE bucket = 'unassigned'
LIMIT 5;

\echo ''
\echo 'Dashboard view assignment columns:'
SELECT
    case_number,
    request_display_name,
    is_assigned,
    assigned_trapper_display
FROM trapper.v_dashboard_open_requests
LIMIT 5;
