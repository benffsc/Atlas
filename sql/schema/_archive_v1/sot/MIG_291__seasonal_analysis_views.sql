-- MIG_291__seasonal_analysis_views.sql
-- Seasonal Breeding and Activity Analysis for Beacon (P4)
--
-- Purpose:
--   Identify seasonal patterns in cat reproduction and TNR activity.
--   Critical for Beacon's surge prediction and resource planning.
--
-- Scientific Context (California Breeding Season):
--   - Peak breeding: February-November (Vortex model)
--   - Kitten season peaks: Spring (April-June) and Fall (September-October)
--   - 2-3 litters per year typical for unspayed females
--
-- Use Cases:
--   - Predict kitten surges 2-3 months before peak
--   - Optimize clinic capacity for seasonal demand
--   - Identify year-over-year trends
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_291__seasonal_analysis_views.sql

\echo ''
\echo 'MIG_291: Seasonal Analysis Views for Beacon'
\echo '============================================'
\echo ''
\echo 'Creating views for seasonal breeding patterns and activity analysis.'
\echo ''

-- ============================================================
-- 1. Season Helper Function
-- ============================================================

\echo 'Creating season helper function...'

CREATE OR REPLACE FUNCTION trapper.get_season(p_date DATE)
RETURNS TEXT AS $$
BEGIN
    IF p_date IS NULL THEN
        RETURN 'unknown';
    END IF;

    CASE EXTRACT(MONTH FROM p_date)
        WHEN 12, 1, 2 THEN RETURN 'winter';
        WHEN 3, 4, 5 THEN RETURN 'spring';
        WHEN 6, 7, 8 THEN RETURN 'summer';
        WHEN 9, 10, 11 THEN RETURN 'fall';
        ELSE RETURN 'unknown';
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.get_season IS
'Returns season name for a date. California breeding season runs Feb-Nov.';

-- ============================================================
-- 2. Clinic Activity by Month/Season
-- ============================================================

\echo 'Creating v_clinic_seasonal_activity view...'

CREATE OR REPLACE VIEW trapper.v_clinic_seasonal_activity AS
SELECT
    EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
    EXTRACT(MONTH FROM a.appointment_date)::INT AS month,
    trapper.get_season(a.appointment_date::DATE) AS season,
    TO_CHAR(a.appointment_date, 'Mon') AS month_name,

    -- Total activity
    COUNT(*) AS total_appointments,
    COUNT(DISTINCT a.cat_id) AS unique_cats,
    COUNT(DISTINCT a.person_id) AS unique_clients,

    -- Spay/neuter breakdown
    COUNT(*) FILTER (WHERE a.is_spay) AS spays,
    COUNT(*) FILTER (WHERE a.is_neuter) AS neuters,
    COUNT(*) FILTER (WHERE a.is_spay OR a.is_neuter) AS total_alterations,

    -- Cat demographics (from service types)
    COUNT(*) FILTER (WHERE a.service_type ILIKE '%kitten%') AS kitten_procedures,
    COUNT(*) FILTER (WHERE a.service_type ILIKE '%feral%' OR a.service_type ILIKE '%community%') AS community_cat_procedures,

    -- Special conditions (using boolean flags)
    COUNT(*) FILTER (WHERE a.is_pregnant = TRUE) AS pregnant_cats,
    COUNT(*) FILTER (WHERE a.is_lactating = TRUE) AS nursing_cats,
    COUNT(*) FILTER (WHERE a.is_in_heat = TRUE) AS in_heat_cats,

    -- Community cats (from service type text since no ownership_type column)
    COUNT(*) FILTER (WHERE a.service_type ILIKE '%feral%' OR a.service_type ILIKE '%community%') AS feral_community,
    COUNT(*) FILTER (WHERE a.service_type NOT ILIKE '%feral%' AND a.service_type NOT ILIKE '%community%') AS owned_pets

FROM trapper.sot_appointments a
WHERE a.appointment_date IS NOT NULL
  AND a.appointment_date >= '2020-01-01'
GROUP BY 1, 2, 3, 4
ORDER BY year DESC, month;

COMMENT ON VIEW trapper.v_clinic_seasonal_activity IS
'Monthly clinic activity breakdown for seasonal pattern analysis.
Use to identify kitten season peaks and plan capacity.';

-- ============================================================
-- 3. Year-over-Year Comparison
-- ============================================================

\echo 'Creating v_yoy_activity_comparison view...'

CREATE OR REPLACE VIEW trapper.v_yoy_activity_comparison AS
WITH monthly_stats AS (
    SELECT
        EXTRACT(YEAR FROM appointment_date)::INT AS year,
        EXTRACT(MONTH FROM appointment_date)::INT AS month,
        COUNT(*) AS appointments,
        COUNT(*) FILTER (WHERE is_spay OR is_neuter) AS alterations
    FROM trapper.sot_appointments
    WHERE appointment_date >= '2020-01-01'
    GROUP BY 1, 2
)
SELECT
    curr.year AS current_year,
    curr.month,
    TO_CHAR(MAKE_DATE(curr.year, curr.month, 1), 'Mon') AS month_name,
    curr.appointments AS current_appointments,
    prev.appointments AS prev_year_appointments,
    curr.alterations AS current_alterations,
    prev.alterations AS prev_year_alterations,
    -- Year-over-year change
    CASE WHEN prev.appointments > 0 THEN
        ROUND(((curr.appointments - prev.appointments)::NUMERIC / prev.appointments) * 100, 1)
    ELSE NULL END AS appointments_yoy_pct,
    CASE WHEN prev.alterations > 0 THEN
        ROUND(((curr.alterations - prev.alterations)::NUMERIC / prev.alterations) * 100, 1)
    ELSE NULL END AS alterations_yoy_pct
FROM monthly_stats curr
LEFT JOIN monthly_stats prev
    ON prev.year = curr.year - 1
    AND prev.month = curr.month
ORDER BY curr.year DESC, curr.month;

COMMENT ON VIEW trapper.v_yoy_activity_comparison IS
'Year-over-year comparison of clinic activity.
Helps identify trends and anomalies in seasonal patterns.';

-- ============================================================
-- 4. Breeding Season Indicators
-- ============================================================

\echo 'Creating v_breeding_season_indicators view...'

CREATE OR REPLACE VIEW trapper.v_breeding_season_indicators AS
SELECT
    EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
    EXTRACT(MONTH FROM a.appointment_date)::INT AS month,
    TO_CHAR(a.appointment_date, 'Mon YYYY') AS period,
    trapper.get_season(a.appointment_date::DATE) AS season,

    -- Breeding indicators from appointment flags
    COUNT(*) FILTER (WHERE a.is_pregnant = TRUE) AS pregnant_count,
    COUNT(*) FILTER (WHERE a.is_lactating = TRUE) AS lactating_count,
    COUNT(*) FILTER (WHERE a.is_in_heat = TRUE) AS in_heat_count,

    -- Total females processed
    COUNT(*) FILTER (WHERE a.is_spay) AS female_cats_spayed,

    -- Breeding percentage (pregnant + lactating + heat / total females)
    CASE WHEN COUNT(*) FILTER (WHERE a.is_spay) > 0 THEN
        ROUND(
            (COUNT(*) FILTER (WHERE a.is_pregnant = TRUE OR a.is_lactating = TRUE OR a.is_in_heat = TRUE))::NUMERIC /
            COUNT(*) FILTER (WHERE a.is_spay) * 100, 1
        )
    ELSE 0 END AS breeding_active_pct

FROM trapper.sot_appointments a
WHERE a.appointment_date >= '2020-01-01'
  AND a.is_spay = TRUE
GROUP BY 1, 2, 3, 4
ORDER BY year DESC, month;

COMMENT ON VIEW trapper.v_breeding_season_indicators IS
'Tracks breeding indicators (pregnant, lactating, in heat) by month.
High breeding_active_pct predicts kitten surge 2-3 months later.';

-- ============================================================
-- 5. Kitten Season Prediction View
-- ============================================================

\echo 'Creating v_kitten_surge_prediction view...'

CREATE OR REPLACE VIEW trapper.v_kitten_surge_prediction AS
WITH kitten_by_month AS (
    SELECT
        EXTRACT(YEAR FROM a.appointment_date)::INT AS year,
        EXTRACT(MONTH FROM a.appointment_date)::INT AS month,
        COUNT(*) FILTER (WHERE a.service_type ILIKE '%kitten%') AS kitten_appointments,
        COUNT(*) AS total_appointments
    FROM trapper.sot_appointments a
    WHERE a.appointment_date >= '2020-01-01'
    GROUP BY 1, 2
),
monthly_avg AS (
    SELECT
        month,
        AVG(kitten_appointments) AS avg_kittens,
        STDDEV(kitten_appointments) AS stddev_kittens
    FROM kitten_by_month
    GROUP BY month
)
SELECT
    k.year,
    k.month,
    TO_CHAR(MAKE_DATE(k.year, k.month, 1), 'Mon') AS month_name,
    trapper.get_season(MAKE_DATE(k.year, k.month, 1)) AS season,
    k.kitten_appointments,
    k.total_appointments,
    ROUND((k.kitten_appointments::NUMERIC / NULLIF(k.total_appointments, 0)) * 100, 1) AS kitten_pct,
    ROUND(ma.avg_kittens, 1) AS historical_avg,
    -- Z-score to identify unusual activity
    CASE WHEN ma.stddev_kittens > 0 THEN
        ROUND((k.kitten_appointments - ma.avg_kittens) / ma.stddev_kittens, 2)
    ELSE 0 END AS z_score,
    -- Flag surge months (>1 std dev above mean)
    CASE WHEN ma.stddev_kittens > 0 AND
        (k.kitten_appointments - ma.avg_kittens) / ma.stddev_kittens > 1
    THEN TRUE ELSE FALSE END AS is_surge_month
FROM kitten_by_month k
JOIN monthly_avg ma ON ma.month = k.month
ORDER BY k.year DESC, k.month;

COMMENT ON VIEW trapper.v_kitten_surge_prediction IS
'Identifies kitten surge months using historical patterns.
z_score > 1 indicates significantly above-average kitten activity.';

-- ============================================================
-- 6. Request Intake Seasonality
-- ============================================================

\echo 'Creating v_request_intake_seasonality view...'

CREATE OR REPLACE VIEW trapper.v_request_intake_seasonality AS
SELECT
    EXTRACT(YEAR FROM created_at)::INT AS year,
    EXTRACT(MONTH FROM created_at)::INT AS month,
    TO_CHAR(created_at, 'Mon') AS month_name,
    trapper.get_season(created_at::DATE) AS season,

    -- Request volume
    COUNT(*) AS total_requests,

    -- By priority
    COUNT(*) FILTER (WHERE is_emergency = TRUE) AS urgent_requests,

    -- Kitten mentions in notes
    COUNT(*) FILTER (
        WHERE situation_description ILIKE '%kitten%'
           OR situation_description ILIKE '%litter%'
    ) AS kitten_mentions,

    -- Pregnant mentions
    COUNT(*) FILTER (
        WHERE situation_description ILIKE '%pregnant%'
           OR situation_description ILIKE '%nursing%'
    ) AS pregnant_mentions

FROM trapper.web_intake_submissions
WHERE created_at >= '2020-01-01'
GROUP BY 1, 2, 3, 4
ORDER BY year DESC, month;

COMMENT ON VIEW trapper.v_request_intake_seasonality IS
'Request intake patterns by month/season.
Correlates with kitten_mentions and pregnant_mentions for surge prediction.';

-- ============================================================
-- 7. Combined Seasonal Dashboard View
-- ============================================================

\echo 'Creating v_seasonal_dashboard view...'

CREATE OR REPLACE VIEW trapper.v_seasonal_dashboard AS
SELECT
    COALESCE(c.year, r.year) AS year,
    COALESCE(c.month, r.month) AS month,
    TO_CHAR(MAKE_DATE(COALESCE(c.year, r.year), COALESCE(c.month, r.month), 1), 'Mon YYYY') AS period,
    trapper.get_season(MAKE_DATE(COALESCE(c.year, r.year), COALESCE(c.month, r.month), 1)) AS season,

    -- Clinic metrics
    COALESCE(c.total_appointments, 0) AS clinic_appointments,
    COALESCE(c.total_alterations, 0) AS alterations,
    COALESCE(c.kitten_procedures, 0) AS kitten_procedures,
    COALESCE(c.pregnant_cats, 0) AS pregnant_cats,

    -- Request metrics
    COALESCE(r.total_requests, 0) AS intake_requests,
    COALESCE(r.urgent_requests, 0) AS urgent_requests,
    COALESCE(r.kitten_mentions, 0) AS kitten_intake_mentions,

    -- Breeding season flag
    COALESCE(c.month, r.month) BETWEEN 2 AND 11 AS is_breeding_season,

    -- Activity ratio (requests per alteration capacity)
    CASE WHEN COALESCE(c.total_alterations, 0) > 0 THEN
        ROUND(COALESCE(r.total_requests, 0)::NUMERIC / c.total_alterations, 2)
    ELSE NULL END AS demand_supply_ratio

FROM trapper.v_clinic_seasonal_activity c
FULL OUTER JOIN trapper.v_request_intake_seasonality r
    ON c.year = r.year AND c.month = r.month
WHERE COALESCE(c.year, r.year) >= 2020
ORDER BY COALESCE(c.year, r.year) DESC, COALESCE(c.month, r.month);

COMMENT ON VIEW trapper.v_seasonal_dashboard IS
'Combined seasonal metrics for Beacon dashboard.
Tracks demand (requests) vs supply (clinic capacity) by season.';

-- ============================================================
-- 8. Seasonal Surge Alert Function
-- ============================================================

\echo 'Creating seasonal surge alert function...'

CREATE OR REPLACE FUNCTION trapper.get_seasonal_alerts()
RETURNS TABLE (
    alert_type TEXT,
    severity TEXT,
    message TEXT,
    metric_name TEXT,
    current_value NUMERIC,
    threshold NUMERIC
) AS $$
BEGIN
    -- Check for kitten surge
    RETURN QUERY
    SELECT
        'kitten_surge'::TEXT AS alert_type,
        CASE WHEN k.z_score > 2 THEN 'high' ELSE 'medium' END AS severity,
        FORMAT('Kitten activity %s%% above average for %s',
            ROUND((k.kitten_appointments - k.historical_avg) / NULLIF(k.historical_avg, 0) * 100),
            k.month_name
        ) AS message,
        'kitten_appointments'::TEXT AS metric_name,
        k.kitten_appointments::NUMERIC AS current_value,
        k.historical_avg AS threshold
    FROM trapper.v_kitten_surge_prediction k
    WHERE k.year = EXTRACT(YEAR FROM CURRENT_DATE)
      AND k.month = EXTRACT(MONTH FROM CURRENT_DATE)
      AND k.is_surge_month = TRUE;

    -- Check for high demand/supply ratio
    RETURN QUERY
    SELECT
        'capacity_pressure'::TEXT AS alert_type,
        CASE WHEN d.demand_supply_ratio > 2 THEN 'high' ELSE 'medium' END AS severity,
        FORMAT('Demand exceeds capacity by %sx for %s',
            d.demand_supply_ratio,
            d.period
        ) AS message,
        'demand_supply_ratio'::TEXT AS metric_name,
        d.demand_supply_ratio AS current_value,
        1.5::NUMERIC AS threshold
    FROM trapper.v_seasonal_dashboard d
    WHERE d.year = EXTRACT(YEAR FROM CURRENT_DATE)
      AND d.month = EXTRACT(MONTH FROM CURRENT_DATE)
      AND d.demand_supply_ratio > 1.5;

    -- Check for breeding season peak
    RETURN QUERY
    SELECT
        'breeding_peak'::TEXT AS alert_type,
        'info'::TEXT AS severity,
        'Peak breeding season (Feb-Nov) - expect increased kitten intake' AS message,
        'is_breeding_season'::TEXT AS metric_name,
        1::NUMERIC AS current_value,
        1::NUMERIC AS threshold
    WHERE EXTRACT(MONTH FROM CURRENT_DATE) BETWEEN 2 AND 11;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_seasonal_alerts IS
'Returns current seasonal alerts for Beacon monitoring.
Alerts: kitten_surge, capacity_pressure, breeding_peak.';

-- ============================================================
-- 9. Add Indexes for Performance
-- ============================================================

\echo 'Creating indexes...'

-- Regular indexes on date columns (expression indexes with date_trunc not IMMUTABLE for timestamptz)
CREATE INDEX IF NOT EXISTS idx_appointments_date_only
    ON trapper.sot_appointments(appointment_date)
    WHERE appointment_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intake_created_only
    ON trapper.web_intake_submissions(created_at)
    WHERE created_at IS NOT NULL;

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
AND table_name IN (
    'v_clinic_seasonal_activity',
    'v_yoy_activity_comparison',
    'v_breeding_season_indicators',
    'v_kitten_surge_prediction',
    'v_request_intake_seasonality',
    'v_seasonal_dashboard'
);

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
AND routine_name IN ('get_season', 'get_seasonal_alerts');

\echo ''
SELECT 'MIG_291 Complete - Seasonal Analysis Views Ready for Beacon P4' AS status;
