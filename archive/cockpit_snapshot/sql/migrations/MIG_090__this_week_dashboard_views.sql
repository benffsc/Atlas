-- MIG_090__this_week_dashboard_views.sql
-- Dashboard views for "This Week" ops focus
--
-- Creates two views:
-- 1. v_dashboard_upcoming_clinics - Aggregated clinic dates for next 14 days
-- 2. v_dashboard_open_requests - Open requests with data quality flags
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_090__this_week_dashboard_views.sql

-- ============================================
-- VIEW: v_dashboard_upcoming_clinics
-- Aggregates upcoming clinic appointments by date
-- ============================================

-- Drop first for column name changes
DROP VIEW IF EXISTS trapper.v_dashboard_upcoming_clinics;

CREATE OR REPLACE VIEW trapper.v_dashboard_upcoming_clinics AS
SELECT
    appt_date AS clinic_date,
    COUNT(*) AS total_appointments,
    COUNT(*) FILTER (WHERE client_type = 'Volume') AS volume_count,
    COUNT(*) FILTER (WHERE client_type = 'Public') AS public_count,
    COUNT(*) FILTER (WHERE client_type IS NULL OR client_type NOT IN ('Volume', 'Public')) AS other_count,
    -- Extract city from address if possible (rough heuristic)
    MODE() WITHIN GROUP (ORDER BY
        CASE
            WHEN client_address LIKE '%Santa Rosa%' THEN 'Santa Rosa'
            WHEN client_address LIKE '%Petaluma%' THEN 'Petaluma'
            WHEN client_address LIKE '%Sebastopol%' THEN 'Sebastopol'
            WHEN client_address LIKE '%Healdsburg%' THEN 'Healdsburg'
            WHEN client_address LIKE '%Rohnert Park%' THEN 'Rohnert Park'
            WHEN client_address LIKE '%Windsor%' THEN 'Windsor'
            WHEN client_address LIKE '%Cotati%' THEN 'Cotati'
            WHEN client_address LIKE '%Sonoma%' THEN 'Sonoma'
            ELSE 'Other'
        END
    ) AS primary_city,
    MIN(created_at) AS first_booked_at
FROM trapper.clinichq_upcoming_appointments
WHERE appt_date >= CURRENT_DATE
  AND appt_date <= CURRENT_DATE + INTERVAL '14 days'
GROUP BY appt_date
ORDER BY appt_date;

COMMENT ON VIEW trapper.v_dashboard_upcoming_clinics IS
'Aggregated clinic appointments for the next 14 days. Shows counts by client type and primary city.';

-- ============================================
-- VIEW: v_dashboard_open_requests
-- Open/active requests with data quality flags
-- ============================================

CREATE OR REPLACE VIEW trapper.v_dashboard_open_requests AS
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
    END AS attention_reason
FROM trapper.requests r
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
LEFT JOIN trapper.people p ON p.id = COALESCE(r.primary_contact_person_id, r.person_id)
WHERE r.status::text IN ('in_progress', 'active', 'needs_review', 'paused')
  AND (r.archive_reason IS NULL OR r.archive_reason = '')
ORDER BY
    -- Needs attention first
    (CASE WHEN r.status::text = 'needs_review' THEN 0 ELSE 1 END),
    -- Then by priority (if set) and update date
    r.priority DESC NULLS LAST,
    r.updated_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_dashboard_open_requests IS
'Open/active requests with data quality flags for dashboard display.
Flags: needs_geo, raw_address_only, missing_contact, needs_attention (combined).
Human-first display_name prefers person/place name over case number.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Dashboard views created. Quick stats:'

SELECT
    'v_dashboard_upcoming_clinics' AS view_name,
    COUNT(*) AS row_count
FROM trapper.v_dashboard_upcoming_clinics
UNION ALL
SELECT
    'v_dashboard_open_requests',
    COUNT(*)
FROM trapper.v_dashboard_open_requests;

\echo ''
\echo 'Upcoming clinics (next 14 days):'
SELECT clinic_date, total_appointments, volume_count, public_count, primary_city
FROM trapper.v_dashboard_upcoming_clinics
ORDER BY clinic_date
LIMIT 7;

\echo ''
\echo 'Open requests with attention flags:'
SELECT
    COUNT(*) AS total_open,
    COUNT(*) FILTER (WHERE needs_attention) AS needs_attention,
    COUNT(*) FILTER (WHERE needs_geo) AS needs_geo,
    COUNT(*) FILTER (WHERE raw_address_only) AS raw_address,
    COUNT(*) FILTER (WHERE missing_contact) AS missing_contact
FROM trapper.v_dashboard_open_requests;
