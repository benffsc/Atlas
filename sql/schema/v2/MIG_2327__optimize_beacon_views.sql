-- MIG_2327: Optimize Beacon Views for Performance
-- Date: 2026-02-16
-- Purpose: Fix beacon view timeouts by using materialized views and better indexes
--
-- Problem: v_beacon_place_metrics times out due to:
--   1. LATERAL subquery for colony_estimates (runs per-row)
--   2. OR condition on appointments join (no index usage)
--   3. No filter to limit results
--
-- Solution: Create materialized views with indexes for fast queries

\echo ''
\echo '=============================================='
\echo '  MIG_2327: Optimize Beacon Views'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Drop existing slow views
-- ============================================================================

\echo '1. Dropping slow views...'

DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;

-- ============================================================================
-- 2. Create optimized materialized view for place metrics
-- ============================================================================

\echo ''
\echo '2. Creating materialized view ops.mv_beacon_place_metrics...'

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    -- Pre-aggregate cat counts per place
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id) AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        ) AS altered_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
),
place_people AS (
    -- Pre-aggregate people counts per place
    SELECT
        pp.place_id,
        COUNT(DISTINCT pp.person_id) AS total_people
    FROM sot.person_place pp
    GROUP BY pp.place_id
),
place_requests AS (
    -- Pre-aggregate request counts per place
    SELECT
        r.place_id,
        COUNT(*) AS total_requests,
        COUNT(*) FILTER (
            WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
        ) AS active_requests
    FROM ops.requests r
    WHERE r.place_id IS NOT NULL
    GROUP BY r.place_id
),
place_appointments AS (
    -- Pre-aggregate appointment counts per place (using UNION for OR optimization)
    SELECT
        place_id,
        COUNT(*) AS total_appointments,
        MAX(appointment_date) AS last_appointment_date
    FROM (
        SELECT place_id, appointment_id, appointment_date FROM ops.appointments WHERE place_id IS NOT NULL
        UNION
        SELECT inferred_place_id AS place_id, appointment_id, appointment_date FROM ops.appointments WHERE inferred_place_id IS NOT NULL
    ) combined
    GROUP BY place_id
),
latest_colony_estimates AS (
    -- Pre-select latest colony estimate per place
    SELECT DISTINCT ON (place_id)
        place_id,
        total_cats AS colony_estimate,
        source_type AS estimate_method
    FROM sot.colony_estimates
    ORDER BY place_id, observation_date DESC NULLS LAST, created_at DESC
)
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    COALESCE(pc.total_cats, 0)::INTEGER AS total_cats,
    COALESCE(pc.altered_cats, 0)::INTEGER AS altered_cats,
    CASE
        WHEN COALESCE(pc.total_cats, 0) > 0
        THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.total_cats * 100, 1)
        ELSE NULL
    END AS alteration_rate_pct,
    COALESCE(pp.total_people, 0)::INTEGER AS total_people,
    COALESCE(pr.total_requests, 0)::INTEGER AS total_requests,
    COALESCE(pr.active_requests, 0)::INTEGER AS active_requests,
    COALESCE(pa.total_appointments, 0)::INTEGER AS total_appointments,
    pa.last_appointment_date,
    lce.colony_estimate,
    lce.estimate_method,
    GREATEST(
        p.updated_at,
        pa.last_appointment_date::timestamptz
    ) AS last_activity_at,
    -- Zone code (simplified - no subquery)
    NULL::TEXT AS zone_code
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
LEFT JOIN place_requests pr ON pr.place_id = p.place_id
LEFT JOIN place_appointments pa ON pa.place_id = p.place_id
LEFT JOIN latest_colony_estimates lce ON lce.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id
    ON ops.mv_beacon_place_metrics(place_id);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_total_cats
    ON ops.mv_beacon_place_metrics(total_cats DESC);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_coords
    ON ops.mv_beacon_place_metrics(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_alteration
    ON ops.mv_beacon_place_metrics(alteration_rate_pct);

COMMENT ON MATERIALIZED VIEW ops.mv_beacon_place_metrics IS
'Materialized view for beacon place metrics - refresh with: REFRESH MATERIALIZED VIEW ops.mv_beacon_place_metrics;';

-- ============================================================================
-- 3. Create wrapper view for API compatibility
-- ============================================================================

\echo ''
\echo '3. Creating API-compatible view ops.v_beacon_place_metrics...'

CREATE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

COMMENT ON VIEW ops.v_beacon_place_metrics IS
'API-compatible view wrapping mv_beacon_place_metrics materialized view';

-- ============================================================================
-- 4. Add indexes to support beacon joins (if not exist)
-- ============================================================================

\echo ''
\echo '4. Adding supporting indexes...'

-- Index on cat_place for place_id lookups
CREATE INDEX IF NOT EXISTS idx_cat_place_place_id ON sot.cat_place(place_id);

-- Index on person_place for place_id lookups
CREATE INDEX IF NOT EXISTS idx_person_place_place_id ON sot.person_place(place_id);

-- Index on requests for place_id lookups
CREATE INDEX IF NOT EXISTS idx_requests_place_id ON ops.requests(place_id) WHERE place_id IS NOT NULL;

-- Index on appointments for place lookups
CREATE INDEX IF NOT EXISTS idx_appointments_place_id ON ops.appointments(place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_inferred_place_id ON ops.appointments(inferred_place_id) WHERE inferred_place_id IS NOT NULL;

-- Index on colony_estimates for place lookups
CREATE INDEX IF NOT EXISTS idx_colony_estimates_place_id ON sot.colony_estimates(place_id);

-- ============================================================================
-- 5. Create refresh function
-- ============================================================================

\echo ''
\echo '5. Creating refresh function...'

CREATE OR REPLACE FUNCTION ops.refresh_beacon_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW ops.mv_beacon_place_metrics;
    RAISE NOTICE 'Refreshed ops.mv_beacon_place_metrics';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.refresh_beacon_materialized_views() IS
'Refreshes all beacon materialized views. Call periodically or after major data changes.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'mv_beacon_place_metrics' AS view_name, COUNT(*) AS row_count
FROM ops.mv_beacon_place_metrics;

SELECT 'v_beacon_place_metrics' AS view_name, COUNT(*) AS row_count
FROM ops.v_beacon_place_metrics
LIMIT 1;

\echo ''
\echo '=============================================='
\echo '  MIG_2327 Complete!'
\echo '=============================================='
\echo ''
\echo 'To refresh materialized views, run:'
\echo '  SELECT ops.refresh_beacon_materialized_views();'
\echo ''
