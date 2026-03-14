-- MIG_2937: Service Zone Summary View
-- FFS-538: City-level TNR stats for Beacon dashboard
--
-- Staff think in terms of cities (Santa Rosa, Petaluma, etc.), not DBSCAN clusters.
-- This view provides city-level rollups that are more intuitive for daily use.

BEGIN;

\echo 'MIG_2937: Creating service zone summary view'

CREATE OR REPLACE VIEW beacon.v_service_zone_summary AS
WITH zone_cats AS (
  SELECT
    p.service_zone,
    COUNT(DISTINCT cp.cat_id) AS total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status IN ('spayed', 'neutered')
    ) AS altered_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status = 'intact'
    ) AS intact_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE c.altered_status = 'unknown' OR c.altered_status IS NULL
    ) AS unknown_status_cats
  FROM sot.places p
  JOIN sot.cat_place cp ON cp.place_id = p.place_id
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE p.merged_into_place_id IS NULL
    AND p.service_zone IS NOT NULL
  GROUP BY p.service_zone
),
zone_places AS (
  SELECT
    p.service_zone,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE p.location IS NOT NULL) AS geocoded_places,
    -- Geographic center
    ST_Y(ST_Centroid(ST_Collect(p.location::geometry))) AS centroid_lat,
    ST_X(ST_Centroid(ST_Collect(p.location::geometry))) AS centroid_lng
  FROM sot.places p
  WHERE p.merged_into_place_id IS NULL
    AND p.service_zone IS NOT NULL
  GROUP BY p.service_zone
),
zone_activity AS (
  SELECT
    p.service_zone,
    COUNT(DISTINCT r.request_id) AS total_requests,
    COUNT(DISTINCT r.request_id) FILTER (
      WHERE r.status NOT IN ('completed', 'cancelled', 'closed')
    ) AS active_requests,
    COUNT(DISTINCT a.appointment_id) AS total_appointments,
    MAX(a.appointment_date) AS last_appointment_date,
    COUNT(DISTINCT a.appointment_id) FILTER (
      WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
    ) AS appointments_last_90d,
    COUNT(DISTINCT a.appointment_id) FILTER (
      WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '90 days'
        AND (a.is_spay = true OR a.is_neuter = true)
    ) AS alterations_last_90d,
    COUNT(DISTINCT pp.person_id) AS people_count
  FROM sot.places p
  LEFT JOIN ops.requests r ON r.place_id = p.place_id
    AND r.merged_into_request_id IS NULL
  LEFT JOIN ops.appointments a ON (a.place_id = p.place_id OR a.inferred_place_id = p.place_id)
    AND a.cat_id IS NOT NULL
  LEFT JOIN sot.person_place pp ON pp.place_id = p.place_id
  WHERE p.merged_into_place_id IS NULL
    AND p.service_zone IS NOT NULL
  GROUP BY p.service_zone
)
SELECT
  zp.service_zone,
  zp.total_places::INT,
  zp.geocoded_places::INT,
  zp.centroid_lat,
  zp.centroid_lng,
  COALESCE(zc.total_cats, 0)::INT AS total_cats,
  COALESCE(zc.altered_cats, 0)::INT AS altered_cats,
  COALESCE(zc.intact_cats, 0)::INT AS intact_cats,
  COALESCE(zc.unknown_status_cats, 0)::INT AS unknown_status_cats,
  -- Alteration rate (known-status denominator)
  CASE
    WHEN COALESCE(zc.altered_cats, 0) + COALESCE(zc.intact_cats, 0) > 0 THEN
      ROUND(100.0 * zc.altered_cats / (zc.altered_cats + zc.intact_cats), 1)
    ELSE NULL
  END AS alteration_rate_pct,
  -- Status
  CASE
    WHEN COALESCE(zc.altered_cats, 0) + COALESCE(zc.intact_cats, 0) = 0 THEN 'no_data'
    WHEN 100.0 * zc.altered_cats / (zc.altered_cats + zc.intact_cats) >= 75 THEN 'managed'
    WHEN 100.0 * zc.altered_cats / (zc.altered_cats + zc.intact_cats) >= 50 THEN 'in_progress'
    WHEN 100.0 * zc.altered_cats / (zc.altered_cats + zc.intact_cats) >= 25 THEN 'needs_work'
    ELSE 'needs_attention'
  END AS zone_status,
  COALESCE(za.total_requests, 0)::INT AS total_requests,
  COALESCE(za.active_requests, 0)::INT AS active_requests,
  COALESCE(za.total_appointments, 0)::INT AS total_appointments,
  za.last_appointment_date,
  COALESCE(za.appointments_last_90d, 0)::INT AS appointments_last_90d,
  COALESCE(za.alterations_last_90d, 0)::INT AS alterations_last_90d,
  COALESCE(za.people_count, 0)::INT AS people_count
FROM zone_places zp
LEFT JOIN zone_cats zc ON zc.service_zone = zp.service_zone
LEFT JOIN zone_activity za ON za.service_zone = zp.service_zone
ORDER BY COALESCE(zc.total_cats, 0) DESC;

COMMENT ON VIEW beacon.v_service_zone_summary IS
'City-level TNR statistics rollup by service_zone. More intuitive than observation zones
for staff use. Service zones are extracted from place addresses (see sot.extract_service_zone).';

\echo ''
\echo 'MIG_2937: Service zone summary view created'

-- Verify
SELECT service_zone, total_places, total_cats, altered_cats, alteration_rate_pct, zone_status
FROM beacon.v_service_zone_summary
LIMIT 10;

COMMIT;
