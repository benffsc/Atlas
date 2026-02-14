-- MIG_2082: Beacon Views Implementation
-- Date: 2026-02-14
-- Purpose: Replace stub Beacon views with real implementations
-- Un-stubs: v_beacon_summary, v_beacon_cluster_summary, v_beacon_place_metrics,
--           v_seasonal_dashboard, v_breeding_season_indicators, v_kitten_surge_prediction

\echo ''
\echo '=============================================='
\echo '  MIG_2082: Beacon Views Implementation'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 0. DROP existing stub views to allow column changes
-- ============================================================================

\echo '0. Dropping existing stub views...'

DROP VIEW IF EXISTS ops.v_beacon_summary CASCADE;
DROP VIEW IF EXISTS ops.v_beacon_cluster_summary CASCADE;
DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;
DROP VIEW IF EXISTS ops.v_seasonal_dashboard CASCADE;
DROP VIEW IF EXISTS ops.v_breeding_season_indicators CASCADE;
DROP VIEW IF EXISTS ops.v_kitten_surge_prediction CASCADE;

-- ============================================================================
-- 1. BEACON SUMMARY - Real metrics
-- ============================================================================

\echo ''
\echo '1. Creating ops.v_beacon_summary with real implementation...'

CREATE VIEW ops.v_beacon_summary AS
WITH counts AS (
    SELECT
        (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL) AS total_places,
        (SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL AND merged_into_place_id IS NULL) AS geocoded_places,
        (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) AS total_cats,
        (SELECT COUNT(*) FROM sot.cats WHERE altered_status IN ('spayed', 'neutered', 'altered') AND merged_into_cat_id IS NULL) AS altered_cats,
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
        ROUND(altered_cats::numeric / NULLIF(total_cats, 0) * 100, 1) AS alteration_rate_pct
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
    -- High priority zones (places with active requests and high/urgent priority)
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

COMMENT ON VIEW ops.v_beacon_summary IS 'Beacon dashboard summary with real metrics';

-- ============================================================================
-- 2. BEACON CLUSTER SUMMARY - Zone-based clustering
-- ============================================================================

\echo ''
\echo '2. Creating ops.v_beacon_cluster_summary with zone-based implementation...'

CREATE VIEW ops.v_beacon_cluster_summary AS
SELECT
    oz.zone_id,
    oz.zone_code AS cluster_name,
    oz.zone_name AS cluster_description,
    oz.status AS cluster_status,
    oz.service_zone,
    -- Place counts
    COUNT(DISTINCT poz.place_id) AS place_count,
    -- Cat counts
    COUNT(DISTINCT cp.cat_id) AS cat_count,
    COUNT(DISTINCT cp.cat_id) FILTER (
        WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
    ) AS altered_cat_count,
    -- Alteration rate
    CASE
        WHEN COUNT(DISTINCT cp.cat_id) > 0
        THEN ROUND(
            COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
            )::numeric / COUNT(DISTINCT cp.cat_id) * 100, 1
        )
        ELSE 0
    END AS alteration_rate,
    -- Request counts
    COUNT(DISTINCT r.request_id) AS total_requests,
    COUNT(DISTINCT r.request_id) FILTER (
        WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
    ) AS active_requests,
    -- Cluster centroid (average of place locations)
    ST_Centroid(ST_Collect(p.location::geometry))::geography AS cluster_centroid,
    -- Bounding box
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

COMMENT ON VIEW ops.v_beacon_cluster_summary IS 'Beacon cluster statistics by observation zone';

-- ============================================================================
-- 3. BEACON PLACE METRICS - Per-place metrics
-- ============================================================================

\echo ''
\echo '3. Creating ops.v_beacon_place_metrics...'

CREATE VIEW ops.v_beacon_place_metrics AS
SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.place_kind,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    -- Cat metrics
    COUNT(DISTINCT cp.cat_id) AS total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
        WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
    ) AS altered_cats,
    CASE
        WHEN COUNT(DISTINCT cp.cat_id) > 0
        THEN ROUND(
            COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
            )::numeric / COUNT(DISTINCT cp.cat_id) * 100, 1
        )
        ELSE NULL
    END AS alteration_rate_pct,
    -- People metrics
    COUNT(DISTINCT pp.person_id) AS total_people,
    -- Request metrics
    COUNT(DISTINCT r.request_id) AS total_requests,
    COUNT(DISTINCT r.request_id) FILTER (
        WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
    ) AS active_requests,
    -- Appointment metrics
    COUNT(DISTINCT a.appointment_id) AS total_appointments,
    MAX(a.appointment_date) AS last_appointment_date,
    -- Colony estimate (if available - most recent)
    ce.total_cats AS colony_estimate,
    ce.source_type AS estimate_method,
    -- Activity recency
    GREATEST(
        p.updated_at,
        MAX(a.appointment_date)::timestamptz,
        MAX(r.updated_at)
    ) AS last_activity_at,
    -- Zone assignment
    (
        SELECT oz.zone_code
        FROM sot.place_observation_zone poz
        JOIN sot.observation_zones oz ON oz.zone_id = poz.zone_id
        WHERE poz.place_id = p.place_id
        LIMIT 1
    ) AS zone_code
FROM sot.places p
LEFT JOIN sot.cat_place cp ON cp.place_id = p.place_id
LEFT JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN sot.person_place pp ON pp.place_id = p.place_id
LEFT JOIN ops.requests r ON r.place_id = p.place_id
LEFT JOIN ops.appointments a ON a.place_id = p.place_id OR a.inferred_place_id = p.place_id
LEFT JOIN LATERAL (
    SELECT total_cats, source_type
    FROM sot.colony_estimates ce2
    WHERE ce2.place_id = p.place_id
    ORDER BY ce2.observation_date DESC NULLS LAST, ce2.created_at DESC
    LIMIT 1
) ce ON TRUE
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.display_name, p.formatted_address, p.place_kind,
         p.location, p.updated_at, ce.total_cats, ce.source_type;

COMMENT ON VIEW ops.v_beacon_place_metrics IS 'Per-place metrics for Beacon visualization';

-- ============================================================================
-- 4. SEASONAL DASHBOARD - Real trends
-- ============================================================================

\echo ''
\echo '4. Creating ops.v_seasonal_dashboard with real implementation...'

CREATE VIEW ops.v_seasonal_dashboard AS
WITH monthly_stats AS (
    SELECT
        DATE_TRUNC('month', a.appointment_date)::DATE AS month,
        COUNT(*) AS total_appointments,
        COUNT(*) FILTER (WHERE a.is_alteration) AS alterations,
        COUNT(DISTINCT a.cat_id) AS unique_cats,
        COUNT(DISTINCT a.place_id) AS unique_places
    FROM ops.appointments a
    WHERE a.appointment_date >= (CURRENT_DATE - INTERVAL '24 months')
    GROUP BY DATE_TRUNC('month', a.appointment_date)
),
intake_stats AS (
    SELECT
        DATE_TRUNC('month', i.submitted_at)::DATE AS month,
        COUNT(*) AS total_intakes
    FROM ops.intake_submissions i
    WHERE i.submitted_at >= (CURRENT_DATE - INTERVAL '24 months')
    GROUP BY DATE_TRUNC('month', i.submitted_at)
)
SELECT
    m.month,
    EXTRACT(YEAR FROM m.month)::INTEGER AS year,
    EXTRACT(MONTH FROM m.month)::INTEGER AS month_num,
    TO_CHAR(m.month, 'Mon YYYY') AS month_label,
    m.total_appointments,
    m.alterations,
    m.unique_cats,
    m.unique_places,
    COALESCE(i.total_intakes, 0)::INTEGER AS total_intakes,
    -- Seasonal indicators
    CASE
        WHEN EXTRACT(MONTH FROM m.month) IN (3, 4, 5) THEN 'spring'
        WHEN EXTRACT(MONTH FROM m.month) IN (6, 7, 8) THEN 'summer'
        WHEN EXTRACT(MONTH FROM m.month) IN (9, 10, 11) THEN 'fall'
        ELSE 'winter'
    END AS season,
    -- Is breeding season (Feb-Oct is peak for cats)
    EXTRACT(MONTH FROM m.month) BETWEEN 2 AND 10 AS is_breeding_season,
    -- Year-over-year comparison
    LAG(m.alterations, 12) OVER (ORDER BY m.month) AS alterations_yoy,
    LAG(m.total_appointments, 12) OVER (ORDER BY m.month) AS appointments_yoy
FROM monthly_stats m
LEFT JOIN intake_stats i ON i.month = m.month
ORDER BY m.month DESC;

COMMENT ON VIEW ops.v_seasonal_dashboard IS 'Monthly activity trends for seasonal analysis';

-- ============================================================================
-- 5. BREEDING SEASON INDICATORS
-- ============================================================================

\echo ''
\echo '5. Creating ops.v_breeding_season_indicators...'

CREATE VIEW ops.v_breeding_season_indicators AS
WITH monthly_pregnancy AS (
    SELECT
        DATE_TRUNC('month', a.appointment_date)::DATE AS month,
        COUNT(*) FILTER (WHERE a.is_pregnant) AS pregnant_count,
        COUNT(*) FILTER (WHERE a.is_lactating) AS lactating_count,
        COUNT(*) AS total_female_appts
    FROM ops.appointments a
    JOIN sot.cats c ON c.cat_id = a.cat_id
    WHERE c.sex = 'female'
        AND a.appointment_date >= (CURRENT_DATE - INTERVAL '24 months')
    GROUP BY DATE_TRUNC('month', a.appointment_date)
)
SELECT
    mp.month,
    mp.pregnant_count,
    mp.lactating_count,
    mp.total_female_appts,
    CASE
        WHEN mp.total_female_appts > 0
        THEN ROUND(mp.pregnant_count::numeric / mp.total_female_appts * 100, 1)
        ELSE 0
    END AS pregnancy_rate_pct,
    CASE
        WHEN mp.total_female_appts > 0
        THEN ROUND(mp.lactating_count::numeric / mp.total_female_appts * 100, 1)
        ELSE 0
    END AS lactation_rate_pct,
    -- Breeding intensity score (0-100)
    LEAST(100, (mp.pregnant_count + mp.lactating_count) * 10) AS breeding_intensity,
    -- Season
    CASE
        WHEN EXTRACT(MONTH FROM mp.month) BETWEEN 2 AND 4 THEN 'early_breeding'
        WHEN EXTRACT(MONTH FROM mp.month) BETWEEN 5 AND 7 THEN 'peak_breeding'
        WHEN EXTRACT(MONTH FROM mp.month) BETWEEN 8 AND 10 THEN 'late_breeding'
        ELSE 'low_season'
    END AS breeding_phase
FROM monthly_pregnancy mp
ORDER BY mp.month DESC;

COMMENT ON VIEW ops.v_breeding_season_indicators IS 'Breeding season indicators based on pregnancy/lactation data';

-- ============================================================================
-- 6. KITTEN SURGE PREDICTION
-- ============================================================================

\echo ''
\echo '6. Creating ops.v_kitten_surge_prediction...'

CREATE VIEW ops.v_kitten_surge_prediction AS
WITH recent_breeding AS (
    SELECT
        EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER AS current_month,
        -- Average gestation is ~63 days, so pregnant cats now = kittens in ~2 months
        COUNT(*) FILTER (WHERE a.is_pregnant) AS current_pregnant,
        COUNT(*) FILTER (WHERE a.is_lactating) AS current_lactating
    FROM ops.appointments a
    WHERE a.appointment_date >= (CURRENT_DATE - INTERVAL '30 days')
),
historical_avg AS (
    SELECT
        EXTRACT(MONTH FROM a.appointment_date)::INTEGER AS month,
        AVG(CASE WHEN a.is_pregnant THEN 1 ELSE 0 END) AS avg_pregnancy_rate,
        AVG(CASE WHEN a.is_lactating THEN 1 ELSE 0 END) AS avg_lactation_rate
    FROM ops.appointments a
    WHERE a.appointment_date >= (CURRENT_DATE - INTERVAL '3 years')
    GROUP BY EXTRACT(MONTH FROM a.appointment_date)
)
SELECT
    CURRENT_DATE AS prediction_date,
    rb.current_pregnant,
    rb.current_lactating,
    -- Predicted kitten arrivals in next 2 months
    (rb.current_pregnant * 4)::INTEGER AS estimated_kittens_2mo,  -- Avg litter size ~4
    -- Risk level
    CASE
        WHEN rb.current_pregnant > 10 THEN 'high'
        WHEN rb.current_pregnant > 5 THEN 'medium'
        WHEN rb.current_pregnant > 0 THEN 'low'
        ELSE 'minimal'
    END AS surge_risk_level,
    -- Historical comparison
    COALESCE(ha.avg_pregnancy_rate, 0) AS historical_pregnancy_rate,
    -- Is above historical average
    (rb.current_pregnant > COALESCE(ha.avg_pregnancy_rate * 100, 0)) AS above_historical_avg,
    -- Breeding season status
    CASE
        WHEN rb.current_month BETWEEN 2 AND 10 THEN TRUE
        ELSE FALSE
    END AS is_breeding_season
FROM recent_breeding rb
LEFT JOIN historical_avg ha ON ha.month = rb.current_month;

COMMENT ON VIEW ops.v_kitten_surge_prediction IS 'Kitten intake predictions based on breeding indicators';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'ops.v_beacon_summary' AS view_name, 1 AS row_count
UNION ALL
SELECT 'ops.v_beacon_cluster_summary', COUNT(*) FROM ops.v_beacon_cluster_summary
UNION ALL
SELECT 'ops.v_beacon_place_metrics', COUNT(*) FROM ops.v_beacon_place_metrics
UNION ALL
SELECT 'ops.v_seasonal_dashboard', COUNT(*) FROM ops.v_seasonal_dashboard
UNION ALL
SELECT 'ops.v_breeding_season_indicators', COUNT(*) FROM ops.v_breeding_season_indicators
UNION ALL
SELECT 'ops.v_kitten_surge_prediction', COUNT(*) FROM ops.v_kitten_surge_prediction;

\echo ''
\echo '=============================================='
\echo '  MIG_2082 Complete!'
\echo '=============================================='
\echo ''
