-- MIG_100__ops_lens_and_data_issues.sql
-- Ops Lens Layer: Clean separation between "ops-ready" data and "noise/edge-case" tracking
--
-- This migration creates:
-- 1. data_issues table - for tracking messy/nonsense data without cluttering daily ops
-- 2. v_ops_requests - canonical requests with ops flags and TNR stage
-- 3. v_ops_triage_counts - stable bucket counts (always 4 buckets, including zeros)
-- 4. v_ops_triage_items - triage items built on ops lens
--
-- APPLY MANUALLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_100__ops_lens_and_data_issues.sql

-- ============================================
-- PART 1: Data Issues Tracking Table
-- ============================================

CREATE TABLE IF NOT EXISTS trapper.data_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    issue_type TEXT NOT NULL,
    severity SMALLINT NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    UNIQUE (entity_type, entity_id, issue_type)
);

COMMENT ON TABLE trapper.data_issues IS
'Tracks data quality issues without cluttering daily ops. Severity: 1=low, 2=medium, 3=high.';

COMMENT ON COLUMN trapper.data_issues.issue_type IS
'Issue types: needs_geo, raw_address, missing_contact, unassigned, merge_chain_broken, duplicate_unresolved, etc.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_data_issues_type_resolved
ON trapper.data_issues (issue_type, is_resolved);

CREATE INDEX IF NOT EXISTS idx_data_issues_entity
ON trapper.data_issues (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_data_issues_severity
ON trapper.data_issues (severity) WHERE NOT is_resolved;

-- ============================================
-- PART 2: Ops Lens - Canonical Requests View
-- ============================================

DROP VIEW IF EXISTS trapper.v_ops_requests CASCADE;

CREATE VIEW trapper.v_ops_requests AS
WITH canonical_requests AS (
    -- Only canonical requests (not duplicates), resolving merge chains
    SELECT
        r.id AS request_id,
        r.case_number,
        r.status::text,
        r.priority,
        r.priority_label,
        r.archive_reason,
        r.archived_at,
        r.created_at,
        r.updated_at,
        r.assigned_trapper_person_id,
        r.assigned_at,
        -- Linked entities
        r.primary_place_id,
        r.primary_contact_person_id,
        -- Person info
        COALESCE(
            p.full_name,
            CONCAT_WS(' ', p.first_name, p.last_name)
        ) AS contact_name,
        p.phone_normalized AS contact_phone,
        p.email AS contact_email,
        -- Place info
        COALESCE(pl.name, pl.display_name) AS place_name,
        pl.raw_address AS place_raw_address,
        -- Address info
        COALESCE(addr.formatted_address, pl.raw_address) AS address_display,
        addr.formatted_address IS NOT NULL AS address_canonical,
        addr.city,
        addr.postal_code,
        -- Location
        COALESCE(ST_Y(pl.location), ST_Y(addr.location)) AS location_lat,
        COALESCE(ST_X(pl.location), ST_X(addr.location)) AS location_lng,
        pl.location IS NOT NULL OR addr.location IS NOT NULL AS has_geo,
        -- Trapper assignment
        trapper_person.full_name AS assigned_trapper_name,
        r.assigned_trapper_person_id IS NOT NULL AS is_assigned
    FROM trapper.requests r
    LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
    LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
    LEFT JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
    LEFT JOIN trapper.people trapper_person ON trapper_person.id = r.assigned_trapper_person_id
    -- Exclude duplicates (they're merged into canonical)
    WHERE r.archive_reason IS DISTINCT FROM 'duplicate'
)
SELECT
    request_id,
    case_number,
    status,
    priority,
    priority_label,
    archive_reason,
    archived_at,
    created_at,
    updated_at,
    -- Human-first display name
    COALESCE(
        contact_name,
        place_name,
        'Case #' || case_number
    ) AS display_name,
    contact_name,
    contact_phone,
    contact_email,
    place_name,
    place_raw_address,
    address_display,
    address_canonical,
    city,
    postal_code,
    location_lat,
    location_lng,
    has_geo,
    assigned_trapper_person_id,
    assigned_trapper_name,
    is_assigned,
    -- Ops flags (for triage)
    NOT has_geo AS needs_geo,
    (NOT address_canonical AND place_raw_address IS NOT NULL) AS raw_address_only,
    (contact_phone IS NULL AND contact_email IS NULL) AS missing_contact,
    NOT is_assigned AS unassigned,
    -- TNR Stage Classifier (intentionally simple)
    CASE
        WHEN status IN ('new', 'needs_review') THEN 'intake'
        WHEN status IN ('active', 'scheduled', 'in_progress') THEN 'fieldwork'
        WHEN status = 'paused' THEN 'paused'
        WHEN status IN ('resolved', 'closed') THEN 'closed'
        ELSE 'unknown'
    END AS tnr_stage,
    -- Is this request "ops-active" (should show in daily ops)?
    status IN ('new', 'needs_review', 'active', 'scheduled', 'in_progress', 'paused') AS is_ops_active
FROM canonical_requests;

COMMENT ON VIEW trapper.v_ops_requests IS
'Ops-ready requests view. Excludes duplicates, includes TNR stage and ops flags.
Use is_ops_active to filter to actionable requests.';

-- ============================================
-- PART 3: Ops Triage Views (stable buckets)
-- ============================================

DROP VIEW IF EXISTS trapper.v_ops_triage_items CASCADE;
DROP VIEW IF EXISTS trapper.v_ops_triage_counts CASCADE;

-- Triage items from ops lens
CREATE VIEW trapper.v_ops_triage_items AS
WITH ops_active AS (
    SELECT * FROM trapper.v_ops_requests
    WHERE is_ops_active = true
),
bucketed AS (
    SELECT
        request_id::text,
        case_number,
        display_name,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        city,
        tnr_stage,
        created_at,
        updated_at,
        'needs_geo' AS bucket,
        'Missing geolocation' AS reason
    FROM ops_active WHERE needs_geo

    UNION ALL

    SELECT
        request_id::text,
        case_number,
        display_name,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        city,
        tnr_stage,
        created_at,
        updated_at,
        'raw_address' AS bucket,
        'Raw address only' AS reason
    FROM ops_active WHERE raw_address_only

    UNION ALL

    SELECT
        request_id::text,
        case_number,
        display_name,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        city,
        tnr_stage,
        created_at,
        updated_at,
        'missing_contact' AS bucket,
        'Missing contact info' AS reason
    FROM ops_active WHERE missing_contact

    UNION ALL

    SELECT
        request_id::text,
        case_number,
        display_name,
        status,
        priority,
        priority_label,
        address_display,
        address_canonical,
        city,
        tnr_stage,
        created_at,
        updated_at,
        'unassigned' AS bucket,
        'No trapper assigned' AS reason
    FROM ops_active WHERE unassigned
)
SELECT
    bucket,
    request_id,
    case_number,
    display_name AS display_label,
    status,
    priority,
    priority_label,
    address_display,
    address_canonical,
    city,
    tnr_stage,
    created_at,
    updated_at,
    reason,
    ROW_NUMBER() OVER (
        PARTITION BY bucket
        ORDER BY priority DESC NULLS LAST, updated_at DESC NULLS LAST
    ) AS bucket_rank
FROM bucketed
ORDER BY bucket, bucket_rank;

COMMENT ON VIEW trapper.v_ops_triage_items IS
'Triage items built on ops lens (excludes duplicates, uses canonical requests).';

-- Stable bucket counts (always returns all 4 buckets)
CREATE VIEW trapper.v_ops_triage_counts AS
WITH all_buckets AS (
    SELECT unnest(ARRAY['needs_geo', 'raw_address', 'missing_contact', 'unassigned']) AS bucket
),
actual_counts AS (
    SELECT bucket, COUNT(DISTINCT request_id) AS count
    FROM trapper.v_ops_triage_items
    GROUP BY bucket
)
SELECT
    b.bucket,
    COALESCE(c.count, 0)::int AS count,
    -- Bucket order for consistent UI display
    CASE b.bucket
        WHEN 'needs_geo' THEN 1
        WHEN 'raw_address' THEN 2
        WHEN 'missing_contact' THEN 3
        WHEN 'unassigned' THEN 4
        ELSE 5
    END AS display_order
FROM all_buckets b
LEFT JOIN actual_counts c ON c.bucket = b.bucket
ORDER BY display_order;

COMMENT ON VIEW trapper.v_ops_triage_counts IS
'Stable bucket counts - always returns all 4 buckets (including zeros) for consistent UI.';

-- ============================================
-- PART 4: Ops Summary View (quick stats)
-- ============================================

DROP VIEW IF EXISTS trapper.v_ops_summary;

CREATE VIEW trapper.v_ops_summary AS
SELECT
    -- Request counts
    COUNT(*) AS total_requests,
    COUNT(*) FILTER (WHERE is_ops_active) AS ops_active_requests,
    COUNT(*) FILTER (WHERE tnr_stage = 'intake') AS intake_count,
    COUNT(*) FILTER (WHERE tnr_stage = 'fieldwork') AS fieldwork_count,
    COUNT(*) FILTER (WHERE tnr_stage = 'paused') AS paused_count,
    COUNT(*) FILTER (WHERE tnr_stage = 'closed') AS closed_count,
    -- Quality metrics
    COUNT(*) FILTER (WHERE needs_geo AND is_ops_active) AS needs_geo_count,
    COUNT(*) FILTER (WHERE raw_address_only AND is_ops_active) AS raw_address_count,
    COUNT(*) FILTER (WHERE missing_contact AND is_ops_active) AS missing_contact_count,
    COUNT(*) FILTER (WHERE unassigned AND is_ops_active) AS unassigned_count,
    -- Assignment metrics
    COUNT(*) FILTER (WHERE is_assigned) AS assigned_total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE is_assigned) / NULLIF(COUNT(*), 0), 1) AS assigned_pct
FROM trapper.v_ops_requests;

COMMENT ON VIEW trapper.v_ops_summary IS
'Quick ops summary stats. Use for dashboard header metrics.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'MIG_100 complete. Verifying Ops Lens layer:'
\echo ''

\echo 'data_issues table created:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'data_issues'
ORDER BY ordinal_position
LIMIT 5;

\echo ''
\echo 'Ops triage counts (stable 4 buckets):'
SELECT bucket, count, display_order FROM trapper.v_ops_triage_counts;

\echo ''
\echo 'Ops summary:'
SELECT * FROM trapper.v_ops_summary;

\echo ''
\echo 'Sample ops requests (top 5):'
SELECT case_number, display_name, tnr_stage, is_ops_active
FROM trapper.v_ops_requests
WHERE is_ops_active
ORDER BY updated_at DESC
LIMIT 5;
