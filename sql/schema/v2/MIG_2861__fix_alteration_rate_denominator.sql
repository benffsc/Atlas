-- MIG_2861: Fix Alteration Rate Denominator (FFS-292, DATA_GAP_059)
--
-- Problem: Beacon views compute alteration_rate as:
--   altered_cats / total_cats
-- This is misleading when many cats have NULL altered_status (unknown).
-- Example: 1688 Jennings Way shows "5.9% altered" when 94% are unknown.
--
-- Fix: Change denominator to cats with known altered_status (NOT NULL).
-- Add unknown_status_cats column so consumers can show context.
--
-- Affected views:
--   1. ops.v_beacon_summary (global stats)
--   2. ops.v_beacon_cluster_summary (per-zone)
--   3. ops.mv_beacon_place_metrics (per-place, materialized)
--   4. ops.v_beacon_place_metrics (wrapper)
--
-- Created: 2026-03-07

\echo ''
\echo '=============================================='
\echo '  MIG_2861: Fix Alteration Rate Denominator'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. FIX ops.v_beacon_summary — Add known_status_cats, fix denominator
-- ============================================================================

\echo '1. Fixing ops.v_beacon_summary...'

DROP VIEW IF EXISTS ops.v_beacon_summary CASCADE;

CREATE VIEW ops.v_beacon_summary AS
WITH counts AS (
    SELECT
        (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL) AS total_places,
        (SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL AND merged_into_place_id IS NULL) AS geocoded_places,
        (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats,
        (SELECT COUNT(*) FROM sot.cats WHERE altered_status IN ('spayed', 'neutered', 'altered') AND merged_into_cat_id IS NULL) AS altered_cats,
        -- MIG_2861: Add known-status count for correct denominator
        (SELECT COUNT(*) FROM sot.cats WHERE altered_status IS NOT NULL AND merged_into_cat_id IS NULL) AS known_status_cats,
        (SELECT COUNT(*) FROM sot.cats WHERE altered_status IS NULL AND merged_into_cat_id IS NULL) AS unknown_status_cats,
        (SELECT COUNT(*) FROM sot.people WHERE merged_into_person_id IS NULL) AS total_people,
        (SELECT COUNT(*) FROM ops.appointments) AS total_appointments,
        (SELECT COUNT(*) FROM ops.requests) AS total_requests,
        (SELECT COUNT(*) FROM ops.requests WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) AS active_requests,
        (SELECT COUNT(*) FROM sot.cat_place) AS cat_place_links,
        (SELECT COUNT(*) FROM sot.person_cat) AS person_cat_links,
        (SELECT COUNT(*) FROM sot.person_place) AS person_place_links,
        (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place) AS cats_with_places
),
quality_metrics AS (
    SELECT
        ROUND(cats_with_places::numeric / NULLIF(total_cats, 0) * 100, 1) AS cat_place_coverage_pct,
        ROUND(geocoded_places::numeric / NULLIF(total_places, 0) * 100, 1) AS geocoding_rate_pct,
        -- MIG_2861 FIX: Use known_status_cats as denominator, not total_cats
        ROUND(altered_cats::numeric / NULLIF(known_status_cats, 0) * 100, 1) AS alteration_rate_pct
    FROM counts
),
observation_stats AS (
    SELECT
        COUNT(*) AS total_zones,
        COUNT(*) FILTER (WHERE status = 'active') AS active_zones
    FROM sot.observation_zones
),
colony_stats AS (
    SELECT
        COUNT(DISTINCT place_id) AS estimated_colonies,
        COALESCE(SUM(COALESCE(unaltered_count, total_cats - COALESCE(altered_count, 0))), 0) AS total_estimated_unfixed
    FROM sot.colony_estimates
)
SELECT
    c.total_places::INTEGER,
    c.geocoded_places::INTEGER,
    c.total_cats::INTEGER,
    c.altered_cats::INTEGER,
    c.known_status_cats::INTEGER,
    c.unknown_status_cats::INTEGER,
    c.total_people::INTEGER,
    c.total_appointments::INTEGER,
    c.total_requests::INTEGER,
    c.active_requests::INTEGER,
    c.cat_place_links::INTEGER,
    c.person_cat_links::INTEGER,
    c.person_place_links::INTEGER,
    c.cats_with_places::INTEGER,
    q.cat_place_coverage_pct,
    q.geocoding_rate_pct,
    q.alteration_rate_pct,
    o.total_zones::INTEGER,
    o.active_zones::INTEGER,
    COALESCE(cs.estimated_colonies, 0)::INTEGER AS estimated_colonies,
    COALESCE(cs.total_estimated_unfixed, 0)::INTEGER AS estimated_unfixed_cats,
    (
        SELECT COUNT(DISTINCT r.place_id)
        FROM ops.requests r
        WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
          AND r.priority IN ('high', 'urgent')
    )::INTEGER AS high_priority_zones,
    NOW() AS last_updated
FROM counts c
CROSS JOIN quality_metrics q
CROSS JOIN observation_stats o
CROSS JOIN colony_stats cs;

COMMENT ON VIEW ops.v_beacon_summary IS
'MIG_2861: Beacon dashboard summary.
alteration_rate_pct uses known_status_cats as denominator (not total_cats).
unknown_status_cats shows how many cats have NULL altered_status.';

\echo '   Fixed ops.v_beacon_summary'

-- ============================================================================
-- 2. FIX ops.v_beacon_cluster_summary — Fix denominator
-- ============================================================================

\echo ''
\echo '2. Fixing ops.v_beacon_cluster_summary...'

DROP VIEW IF EXISTS ops.v_beacon_cluster_summary CASCADE;

CREATE VIEW ops.v_beacon_cluster_summary AS
SELECT
    oz.zone_id,
    oz.zone_code AS cluster_name,
    oz.zone_name AS cluster_description,
    oz.status AS cluster_status,
    oz.service_zone,
    COUNT(DISTINCT poz.place_id) AS place_count,
    COUNT(DISTINCT cp.cat_id) AS cat_count,
    COUNT(DISTINCT cp.cat_id) FILTER (
        WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
    ) AS altered_cat_count,
    -- MIG_2861: Add known/unknown status counts
    COUNT(DISTINCT cp.cat_id) FILTER (
        WHERE c.altered_status IS NOT NULL
    ) AS known_status_cat_count,
    COUNT(DISTINCT cp.cat_id) FILTER (
        WHERE c.altered_status IS NULL
    ) AS unknown_status_cat_count,
    -- MIG_2861 FIX: Use known_status_cat_count as denominator
    CASE
        WHEN COUNT(DISTINCT cp.cat_id) FILTER (WHERE c.altered_status IS NOT NULL) > 0
        THEN ROUND(
            COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
            )::numeric / COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IS NOT NULL
            ) * 100, 1
        )
        ELSE NULL
    END AS alteration_rate,
    COUNT(DISTINCT r.request_id) AS total_requests,
    COUNT(DISTINCT r.request_id) FILTER (
        WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
    ) AS active_requests,
    ST_Centroid(ST_Collect(p.location::geometry))::geography AS cluster_centroid,
    ST_Envelope(ST_Collect(p.location::geometry))::geography AS cluster_bounds,
    oz.created_at
FROM sot.observation_zones oz
LEFT JOIN sot.place_observation_zone poz ON poz.zone_id = oz.zone_id
LEFT JOIN sot.places p ON p.place_id = poz.place_id
    AND p.merged_into_place_id IS NULL
    AND p.location IS NOT NULL
LEFT JOIN sot.cat_place cp ON cp.place_id = poz.place_id
LEFT JOIN sot.cats c ON c.cat_id = cp.cat_id
    AND c.merged_into_cat_id IS NULL
LEFT JOIN ops.requests r ON r.place_id = poz.place_id
GROUP BY oz.zone_id, oz.zone_code, oz.zone_name, oz.status, oz.service_zone, oz.created_at
ORDER BY active_requests DESC, cat_count DESC;

COMMENT ON VIEW ops.v_beacon_cluster_summary IS
'MIG_2861: Beacon cluster statistics by observation zone.
alteration_rate uses known-status cats as denominator (DATA_GAP_059 fix).';

\echo '   Fixed ops.v_beacon_cluster_summary'

-- ============================================================================
-- 3. FIX ops.mv_beacon_place_metrics — Fix denominator, add unknown count
-- ============================================================================

\echo ''
\echo '3. Fixing ops.mv_beacon_place_metrics...'

DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS ops.mv_beacon_place_metrics CASCADE;

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id) AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        ) AS altered_cats,
        -- MIG_2861: Add known/unknown status counts
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NOT NULL
        ) AS known_status_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NULL
        ) AS unknown_status_cats
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
),
place_people AS (
    SELECT
        pp.place_id,
        COUNT(DISTINCT pp.person_id) AS total_people
    FROM sot.person_place pp
    GROUP BY pp.place_id
),
place_requests AS (
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
    COALESCE(pc.known_status_cats, 0)::INTEGER AS known_status_cats,
    COALESCE(pc.unknown_status_cats, 0)::INTEGER AS unknown_status_cats,
    -- MIG_2861 FIX: Use known_status_cats as denominator
    CASE
        WHEN COALESCE(pc.known_status_cats, 0) > 0
        THEN ROUND(COALESCE(pc.altered_cats, 0)::numeric / pc.known_status_cats * 100, 1)
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
    NULL::TEXT AS zone_code
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
LEFT JOIN place_requests pr ON pr.place_id = p.place_id
LEFT JOIN place_appointments pa ON pa.place_id = p.place_id
LEFT JOIN latest_colony_estimates lce ON lce.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_place_id
    ON ops.mv_beacon_place_metrics(place_id);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_total_cats
    ON ops.mv_beacon_place_metrics(total_cats DESC);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_coords
    ON ops.mv_beacon_place_metrics(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_mv_beacon_place_metrics_alteration
    ON ops.mv_beacon_place_metrics(alteration_rate_pct);

COMMENT ON MATERIALIZED VIEW ops.mv_beacon_place_metrics IS
'MIG_2861: Per-place beacon metrics with corrected alteration rate.
alteration_rate_pct uses known_status_cats as denominator (not total_cats).
Includes unknown_status_cats for display context.
Refresh: REFRESH MATERIALIZED VIEW ops.mv_beacon_place_metrics;';

-- Recreate wrapper view
CREATE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

COMMENT ON VIEW ops.v_beacon_place_metrics IS
'API-compatible view wrapping mv_beacon_place_metrics materialized view';

\echo '   Fixed ops.mv_beacon_place_metrics + v_beacon_place_metrics'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Global alteration stats (from v_beacon_summary):'
SELECT
    total_cats,
    altered_cats,
    known_status_cats,
    unknown_status_cats,
    alteration_rate_pct,
    ROUND(altered_cats::numeric / NULLIF(total_cats, 0) * 100, 1) AS old_rate_pct
FROM ops.v_beacon_summary;

\echo ''
\echo 'Places with most misleading rates (high unknown count):'
SELECT
    display_name,
    total_cats,
    altered_cats,
    known_status_cats,
    unknown_status_cats,
    alteration_rate_pct AS new_rate,
    CASE
        WHEN total_cats > 0
        THEN ROUND(altered_cats::numeric / total_cats * 100, 1)
        ELSE NULL
    END AS old_rate
FROM ops.mv_beacon_place_metrics
WHERE total_cats >= 10
  AND unknown_status_cats > known_status_cats
ORDER BY total_cats DESC
LIMIT 20;

\echo ''
\echo '=============================================='
\echo '  MIG_2861 Complete (FFS-292)'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. v_beacon_summary: alteration_rate_pct now uses known_status_cats denominator'
\echo '  2. v_beacon_cluster_summary: alteration_rate now uses known_status_cats denominator'
\echo '  3. mv_beacon_place_metrics: alteration_rate_pct now uses known_status_cats denominator'
\echo '  4. All three views now include known_status_cats and unknown_status_cats columns'
\echo ''
\echo 'API consumers should be updated to:'
\echo '  - Pass through unknown_status_cats to frontend'
\echo '  - Show context when unknown_status_cats is high relative to total_cats'
\echo ''
