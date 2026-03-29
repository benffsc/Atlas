-- ============================================================================
-- MIG_3006: Pre-Computed Materialized Views for Tippy Query Performance
-- ============================================================================
-- FFS-909: "Which areas might have cats but little data?" times out.
-- 6 Tippy query patterns take 20-50s aggregating across 40K+ cat_place rows,
-- 100K+ appointments, and 5K+ places. Materialized views return in <100ms.
--
-- Creates:
--   ops.mv_city_stats          — One row per city with all aggregated metrics
--   ops.mv_zip_coverage        — One row per zip with coverage gap classification
--   ops.mv_ffr_impact_summary  — FFR impact by city/year/month
--
-- Also adds missing indexes and a UNIQUE index on existing mv_beacon_place_metrics
-- so it can be refreshed concurrently.
-- ============================================================================

\echo '=== MIG_3006: Pre-Computed Materialized Views for Tippy ==='

-- ============================================================================
-- STEP 1: Missing indexes that help ALL queries (not just matviews)
-- ============================================================================

\echo '  1. Creating missing indexes...'

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_date_cat
    ON ops.appointments(appointment_date DESC)
    WHERE cat_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cats_altered_status_active
    ON sot.cats(altered_status)
    WHERE merged_into_cat_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cat_place_place_cat
    ON sot.cat_place(place_id, cat_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_city_postal
    ON sot.addresses(city, postal_code);

\echo '  Done: 4 indexes created'

-- ============================================================================
-- STEP 2: Add UNIQUE index to existing mv_beacon_place_metrics
-- ============================================================================
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY to work

\echo '  2. Adding UNIQUE index to mv_beacon_place_metrics...'

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_mv_beacon_place_metrics_place_id_unique
    ON ops.mv_beacon_place_metrics(place_id);

\echo '  Done: UNIQUE index on mv_beacon_place_metrics'

-- ============================================================================
-- STEP 3: ops.mv_city_stats — One row per city
-- ============================================================================

\echo '  3. Creating ops.mv_city_stats...'

DROP MATERIALIZED VIEW IF EXISTS ops.mv_city_stats CASCADE;

CREATE MATERIALIZED VIEW ops.mv_city_stats AS
WITH city_places AS (
    SELECT
        a.city,
        a.postal_code,
        a.county,
        p.place_id
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
      AND a.city IS NOT NULL
      AND a.city != ''
),
city_cats AS (
    SELECT
        cp2.city,
        c.cat_id,
        c.altered_status
    FROM city_places cp2
    JOIN sot.cat_place cpl ON cpl.place_id = cp2.place_id
    JOIN sot.cats c ON c.cat_id = cpl.cat_id AND c.merged_into_cat_id IS NULL
),
city_requests AS (
    SELECT
        cp2.city,
        r.request_id,
        r.status
    FROM city_places cp2
    JOIN ops.requests r ON r.place_id = cp2.place_id AND r.merged_into_request_id IS NULL
),
city_appointments AS (
    SELECT
        cp2.city,
        ap.appointment_id,
        ap.appointment_date,
        ap.cat_id
    FROM city_places cp2
    JOIN ops.appointments ap ON ap.place_id = cp2.place_id
),
city_people AS (
    SELECT
        cp2.city,
        pp.person_id
    FROM city_places cp2
    JOIN sot.person_place pp ON pp.place_id = cp2.place_id
    JOIN sot.people pe ON pe.person_id = pp.person_id AND pe.merged_into_person_id IS NULL
),
-- Orphaned colonies: places with cats but no active request and no person linked
orphaned AS (
    SELECT
        cp2.city,
        cp2.place_id
    FROM city_places cp2
    WHERE EXISTS (
        SELECT 1 FROM sot.cat_place cpl WHERE cpl.place_id = cp2.place_id
    )
    AND NOT EXISTS (
        SELECT 1 FROM ops.requests r
        WHERE r.place_id = cp2.place_id
          AND r.merged_into_request_id IS NULL
          AND r.status NOT IN ('completed', 'cancelled')
    )
    AND NOT EXISTS (
        SELECT 1 FROM sot.person_place pp WHERE pp.place_id = cp2.place_id
    )
)
SELECT
    cp2.city,
    COUNT(DISTINCT cp2.place_id)::INT AS total_places,
    COALESCE(COUNT(DISTINCT cc.cat_id), 0)::INT AS total_cats,
    COALESCE(COUNT(DISTINCT cc.cat_id) FILTER (
        WHERE cc.altered_status IN ('spayed', 'neutered', 'altered', 'Yes')
    ), 0)::INT AS altered_cats,
    COALESCE(COUNT(DISTINCT cc.cat_id) FILTER (
        WHERE cc.altered_status IN ('intact', 'No')
    ), 0)::INT AS intact_cats,
    COALESCE(COUNT(DISTINCT cc.cat_id) FILTER (
        WHERE cc.altered_status IS NULL OR cc.altered_status NOT IN ('spayed', 'neutered', 'altered', 'Yes', 'intact', 'No')
    ), 0)::INT AS unknown_status_cats,
    CASE WHEN COUNT(DISTINCT cc.cat_id) FILTER (
        WHERE cc.altered_status IN ('spayed', 'neutered', 'altered', 'Yes', 'intact', 'No')
    ) > 0
    THEN ROUND(
        COUNT(DISTINCT cc.cat_id) FILTER (WHERE cc.altered_status IN ('spayed', 'neutered', 'altered', 'Yes'))::numeric
        / NULLIF(COUNT(DISTINCT cc.cat_id) FILTER (WHERE cc.altered_status IN ('spayed', 'neutered', 'altered', 'Yes', 'intact', 'No')), 0) * 100, 1
    )
    ELSE 0 END AS alteration_rate_pct,
    COALESCE((SELECT COUNT(DISTINCT cr.request_id) FROM city_requests cr WHERE cr.city = cp2.city), 0)::INT AS total_requests,
    COALESCE((SELECT COUNT(DISTINCT cr.request_id) FROM city_requests cr WHERE cr.city = cp2.city AND cr.status NOT IN ('completed', 'cancelled')), 0)::INT AS active_requests,
    COALESCE((SELECT COUNT(DISTINCT cr.request_id) FROM city_requests cr WHERE cr.city = cp2.city AND cr.status = 'completed'), 0)::INT AS completed_requests,
    COALESCE((SELECT COUNT(DISTINCT ca.appointment_id) FROM city_appointments ca WHERE ca.city = cp2.city), 0)::INT AS total_appointments,
    COALESCE((SELECT COUNT(DISTINCT ca.appointment_id) FROM city_appointments ca WHERE ca.city = cp2.city AND ca.appointment_date > NOW() - INTERVAL '90 days'), 0)::INT AS appointments_last_90d,
    (SELECT MAX(ca.appointment_date) FROM city_appointments ca WHERE ca.city = cp2.city) AS last_appointment_date,
    COALESCE((SELECT COUNT(DISTINCT cpe.person_id) FROM city_people cpe WHERE cpe.city = cp2.city), 0)::INT AS total_people,
    COALESCE((SELECT COUNT(DISTINCT o.place_id) FROM orphaned o WHERE o.city = cp2.city), 0)::INT AS orphaned_colonies,
    ARRAY_AGG(DISTINCT cp2.postal_code) FILTER (WHERE cp2.postal_code IS NOT NULL) AS zip_codes,
    MAX(cp2.county) AS county,
    NOW() AS refreshed_at
FROM city_places cp2
LEFT JOIN city_cats cc ON cc.city = cp2.city
GROUP BY cp2.city;

CREATE UNIQUE INDEX idx_mv_city_stats_city
    ON ops.mv_city_stats(city);

CREATE INDEX idx_mv_city_stats_total_cats
    ON ops.mv_city_stats(total_cats DESC);

COMMENT ON MATERIALIZED VIEW ops.mv_city_stats IS
'MIG_3006: Pre-computed city-level statistics for Tippy.
One row per city with cats, requests, appointments, alteration rates, orphaned colonies.
Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_city_stats;';

\echo '  Done: ops.mv_city_stats created'

-- ============================================================================
-- STEP 4: ops.mv_zip_coverage — One row per zip code with gap classification
-- ============================================================================

\echo '  4. Creating ops.mv_zip_coverage...'

DROP MATERIALIZED VIEW IF EXISTS ops.mv_zip_coverage CASCADE;

CREATE MATERIALIZED VIEW ops.mv_zip_coverage AS
WITH zip_data AS (
    SELECT
        a.postal_code,
        MAX(a.city) AS city,
        COUNT(DISTINCT p.place_id)::INT AS total_places
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
      AND a.postal_code IS NOT NULL
      AND a.postal_code != ''
    GROUP BY a.postal_code
),
zip_cats AS (
    SELECT
        a.postal_code,
        COUNT(DISTINCT cpl.cat_id)::INT AS total_cats,
        COUNT(DISTINCT cpl.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered', 'Yes')
        )::INT AS altered_cats
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN sot.cat_place cpl ON cpl.place_id = p.place_id
    JOIN sot.cats c ON c.cat_id = cpl.cat_id AND c.merged_into_cat_id IS NULL
    WHERE p.merged_into_place_id IS NULL
      AND a.postal_code IS NOT NULL
    GROUP BY a.postal_code
),
zip_requests AS (
    SELECT
        a.postal_code,
        COUNT(DISTINCT r.request_id)::INT AS total_requests,
        COUNT(DISTINCT r.request_id) FILTER (
            WHERE r.status NOT IN ('completed', 'cancelled')
        )::INT AS active_requests
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN ops.requests r ON r.place_id = p.place_id AND r.merged_into_request_id IS NULL
    WHERE p.merged_into_place_id IS NULL
      AND a.postal_code IS NOT NULL
    GROUP BY a.postal_code
),
zip_appointments AS (
    SELECT
        a.postal_code,
        COUNT(DISTINCT ap.appointment_id)::INT AS total_appointments,
        MAX(ap.appointment_date) AS last_appointment_date
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    JOIN ops.appointments ap ON ap.place_id = p.place_id
    WHERE p.merged_into_place_id IS NULL
      AND a.postal_code IS NOT NULL
    GROUP BY a.postal_code
)
SELECT
    zd.postal_code,
    zd.city,
    zd.total_places,
    COALESCE(zc.total_cats, 0)::INT AS total_cats,
    COALESCE(zc.altered_cats, 0)::INT AS altered_cats,
    COALESCE(zr.total_requests, 0)::INT AS total_requests,
    COALESCE(zr.active_requests, 0)::INT AS active_requests,
    COALESCE(za.total_appointments, 0)::INT AS total_appointments,
    za.last_appointment_date,
    -- Coverage gap classification
    CASE
        WHEN COALESCE(zc.total_cats, 0) > 0 AND COALESCE(zr.total_requests, 0) = 0
            THEN 'cats_no_requests'
        WHEN zd.total_places > 0 AND COALESCE(zc.total_cats, 0) = 0
            THEN 'places_no_cats'
        WHEN COALESCE(zr.total_requests, 0) > 0 AND COALESCE(zc.total_cats, 0) = 0
            THEN 'requests_no_cats'
        ELSE 'normal'
    END AS coverage_gap_type,
    NOW() AS refreshed_at
FROM zip_data zd
LEFT JOIN zip_cats zc ON zc.postal_code = zd.postal_code
LEFT JOIN zip_requests zr ON zr.postal_code = zd.postal_code
LEFT JOIN zip_appointments za ON za.postal_code = zd.postal_code;

CREATE UNIQUE INDEX idx_mv_zip_coverage_postal
    ON ops.mv_zip_coverage(postal_code);

CREATE INDEX idx_mv_zip_coverage_gap_type
    ON ops.mv_zip_coverage(coverage_gap_type);

CREATE INDEX idx_mv_zip_coverage_total_cats
    ON ops.mv_zip_coverage(total_cats DESC);

COMMENT ON MATERIALIZED VIEW ops.mv_zip_coverage IS
'MIG_3006: Pre-computed zip-code coverage for Tippy (solves FFS-909 timeout).
coverage_gap_type: cats_no_requests, places_no_cats, requests_no_cats, normal.
Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_zip_coverage;';

\echo '  Done: ops.mv_zip_coverage created'

-- ============================================================================
-- STEP 5: ops.mv_ffr_impact_summary — FFR impact by city/year/month
-- ============================================================================

\echo '  5. Creating ops.mv_ffr_impact_summary...'

DROP MATERIALIZED VIEW IF EXISTS ops.mv_ffr_impact_summary CASCADE;

CREATE MATERIALIZED VIEW ops.mv_ffr_impact_summary AS
SELECT
    a.city,
    EXTRACT(YEAR FROM ap.appointment_date)::INT AS year,
    EXTRACT(MONTH FROM ap.appointment_date)::INT AS month,
    COUNT(DISTINCT ap.appointment_id)::INT AS total_appointments,
    COUNT(DISTINCT ap.cat_id)::INT AS unique_cats_seen,
    COUNT(DISTINCT ap.cat_id) FILTER (
        WHERE ap.is_spay = true OR ap.is_neuter = true
           OR ap.service_is_spay = true OR ap.service_is_neuter = true
    )::INT AS cats_altered,
    COUNT(DISTINCT ap.cat_id) FILTER (
        WHERE ap.is_spay = true OR ap.service_is_spay = true
    )::INT AS spays,
    COUNT(DISTINCT ap.cat_id) FILTER (
        WHERE ap.is_neuter = true OR ap.service_is_neuter = true
    )::INT AS neuters,
    COUNT(DISTINCT ap.place_id)::INT AS places_served,
    NOW() AS refreshed_at
FROM ops.appointments ap
JOIN sot.places p ON p.place_id = ap.place_id
JOIN sot.addresses a ON a.address_id = p.sot_address_id
WHERE ap.appointment_date IS NOT NULL
  AND ap.cat_id IS NOT NULL
  AND a.city IS NOT NULL
  AND a.city != ''
GROUP BY a.city, EXTRACT(YEAR FROM ap.appointment_date), EXTRACT(MONTH FROM ap.appointment_date);

CREATE UNIQUE INDEX idx_mv_ffr_impact_city_year_month
    ON ops.mv_ffr_impact_summary(city, year, month);

CREATE INDEX idx_mv_ffr_impact_year
    ON ops.mv_ffr_impact_summary(year DESC, month DESC);

CREATE INDEX idx_mv_ffr_impact_cats_altered
    ON ops.mv_ffr_impact_summary(cats_altered DESC);

COMMENT ON MATERIALIZED VIEW ops.mv_ffr_impact_summary IS
'MIG_3006: Pre-computed FFR impact by city/year/month for Tippy.
Tracks alterations (spays/neuters), unique cats seen, places served.
Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ops.mv_ffr_impact_summary;';

\echo '  Done: ops.mv_ffr_impact_summary created'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=== Verification ==='

SELECT 'mv_city_stats' AS matview, COUNT(*)::INT AS row_count FROM ops.mv_city_stats
UNION ALL
SELECT 'mv_zip_coverage', COUNT(*)::INT FROM ops.mv_zip_coverage
UNION ALL
SELECT 'mv_ffr_impact_summary', COUNT(*)::INT FROM ops.mv_ffr_impact_summary;

-- Verify FFS-909 fix: coverage gap query should return results instantly
SELECT coverage_gap_type, COUNT(*)::INT AS zip_count
FROM ops.mv_zip_coverage
GROUP BY coverage_gap_type
ORDER BY zip_count DESC;

\echo ''
\echo '=== MIG_3006 complete ==='
