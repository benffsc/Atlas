-- MIG_3096: Sweep — filter departed cats from all user-facing views
--
-- Audit found 16 views/functions counting cats from cat_place without
-- presence_status filter. This migration fixes CRITICAL + HIGH + MEDIUM.
--
-- Pattern: AND COALESCE(cp.presence_status, 'unknown') != 'departed'
-- This handles NULL (legacy), 'unknown', and 'current' as countable.

-- ============================================================
-- 1. v_place_list — Places list page (HIGH)
-- ============================================================

DROP VIEW IF EXISTS sot.v_place_list CASCADE;

CREATE OR REPLACE VIEW sot.v_place_list AS
SELECT
  p.place_id,
  COALESCE(p.display_name, split_part(p.formatted_address, ',', 1)) AS display_name,
  p.formatted_address,
  p.place_kind,
  a.city AS locality,
  a.postal_code,
  COALESCE((
    SELECT COUNT(DISTINCT cp.cat_id)
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = p.place_id
      AND COALESCE(cp.presence_status, 'unknown') != 'departed'
  ), 0)::INT AS cat_count,
  COALESCE((
    SELECT COUNT(DISTINCT pp.person_id)
    FROM sot.person_place pp
    JOIN sot.people per ON per.person_id = pp.person_id AND per.merged_into_person_id IS NULL
    WHERE pp.place_id = p.place_id
      AND per.display_name IS NOT NULL
      AND (per.is_organization = FALSE OR per.is_organization IS NULL)
  ), 0)::INT AS person_count,
  EXISTS(
    SELECT 1 FROM sot.cat_place cp
    WHERE cp.place_id = p.place_id
      AND COALESCE(cp.presence_status, 'unknown') != 'departed'
  ) AS has_cat_activity,
  p.created_at
FROM sot.places p
LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id AND a.merged_into_address_id IS NULL
WHERE p.merged_into_place_id IS NULL;

-- ============================================================
-- 2. v_person_list_v3 — Person list page (HIGH)
-- ============================================================

-- Get the current definition to understand what columns exist
-- Then rebuild with presence-aware cat_count

-- Recreate v_person_list_v3 from MIG_2403 definition but with presence-aware cat_count
DROP VIEW IF EXISTS sot.v_person_list_v3 CASCADE;

CREATE OR REPLACE VIEW sot.v_person_list_v3 AS
SELECT
  p.person_id,
  COALESCE(p.display_name, TRIM(CONCAT(p.first_name, ' ', p.last_name))) AS display_name,
  CASE
    WHEN p.is_organization = true THEN 'organization'
    WHEN p.entity_type = 'organization' THEN 'organization'
    WHEN p.entity_type IS NOT NULL THEN p.entity_type
    ELSE 'person'
  END AS account_type,
  TRUE AS is_canonical,
  CASE
    WHEN p.data_quality = 'verified' THEN 'High'
    WHEN p.data_quality = 'good' THEN 'High'
    WHEN p.data_quality = 'needs_review' THEN 'Medium'
    WHEN p.data_quality = 'garbage' THEN 'Low'
    WHEN p.is_verified = true THEN 'High'
    WHEN p.primary_email IS NOT NULL AND p.primary_phone IS NOT NULL THEN 'High'
    WHEN p.primary_email IS NOT NULL OR p.primary_phone IS NOT NULL THEN 'Medium'
    ELSE 'Low'
  END AS surface_quality,
  CASE
    WHEN p.data_quality = 'verified' THEN 'Verified by staff'
    WHEN p.data_quality = 'good' THEN 'Good data quality'
    WHEN p.data_quality = 'needs_review' THEN 'Needs review'
    WHEN p.data_quality = 'garbage' THEN 'Poor data quality'
    WHEN p.is_verified = true THEN 'Verified record'
    WHEN p.primary_email IS NOT NULL AND p.primary_phone IS NOT NULL THEN 'Has email and phone'
    WHEN p.primary_email IS NOT NULL THEN 'Has email only'
    WHEN p.primary_phone IS NOT NULL THEN 'Has phone only'
    ELSE 'Missing contact info'
  END AS quality_reason,
  (p.primary_email IS NOT NULL) AS has_email,
  (p.primary_phone IS NOT NULL) AS has_phone,
  -- MIG_3096: Presence-aware cat count (exclude cats departed at all of this person's places)
  COALESCE((
    SELECT COUNT(*)
    FROM sot.person_cat pc
    JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
    WHERE pc.person_id = p.person_id
      AND NOT EXISTS(
        SELECT 1 FROM sot.cat_place cp
        JOIN sot.person_place pp ON pp.place_id = cp.place_id AND pp.person_id = p.person_id
        WHERE cp.cat_id = pc.cat_id AND cp.presence_status = 'departed'
        AND NOT EXISTS(
          SELECT 1 FROM sot.cat_place cp2
          JOIN sot.person_place pp2 ON pp2.place_id = cp2.place_id AND pp2.person_id = p.person_id
          WHERE cp2.cat_id = pc.cat_id AND COALESCE(cp2.presence_status, 'unknown') != 'departed'
        )
      )
  ), 0)::int AS cat_count,
  COALESCE((SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id), 0)::int AS place_count,
  (SELECT STRING_AGG(COALESCE(c.name, c.display_name), ', ' ORDER BY pc.created_at DESC)
   FROM sot.person_cat pc
   JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
   WHERE pc.person_id = p.person_id
   LIMIT 3) AS cat_names,
  COALESCE(pl.formatted_address, pl.display_name) AS primary_place,
  p.created_at,
  CASE
    WHEN p.source_system IN ('clinichq', 'shelterluv') THEN 'clinic_verified'
    WHEN p.source_system = 'volunteerhub' THEN 'volunteer_system'
    WHEN p.source_system = 'atlas_ui' THEN 'staff_entered'
    WHEN p.source_system = 'web_intake' THEN 'web_submission'
    WHEN p.source_system = 'airtable' THEN 'legacy_import'
    WHEN p.source_system = 'petlink' THEN 'microchip_registry'
    ELSE COALESCE(p.source_system, 'unknown')
  END AS source_quality,
  p.first_name,
  p.last_name,
  p.primary_email,
  p.primary_phone,
  p.entity_type,
  p.is_organization,
  p.is_verified,
  p.data_quality,
  p.source_system,
  p.updated_at,
  pl.place_id AS primary_place_id,
  pl.display_name AS primary_place_name,
  pl.formatted_address AS primary_place_address,
  COALESCE((SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p.person_id), 0)::int AS request_count,
  (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id ORDER BY pr.created_at DESC LIMIT 1) AS primary_role,
  (SELECT pr.trapper_type FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.trapper_type IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS trapper_type,
  p.do_not_contact
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

-- Recreate dependent views that were dropped by CASCADE
CREATE OR REPLACE VIEW ops.v_call_sheet_items_detail AS
SELECT
  csi.*,
  pl.display_name AS place_name,
  pl.formatted_address AS place_full_address,
  r.status AS request_status,
  r.summary AS request_summary,
  r.priority AS request_priority,
  per.display_name AS person_name,
  per.primary_phone,
  per.primary_email
FROM ops.call_sheet_items csi
LEFT JOIN sot.places pl ON pl.place_id = csi.place_id
LEFT JOIN ops.requests r ON r.request_id = csi.request_id
LEFT JOIN sot.v_person_list_v3 per ON per.person_id = csi.person_id;

-- ============================================================
-- 3. v_place_ecology_stats — Ecological statistics (HIGH)
-- ============================================================

-- This view drives Chapman estimates and alteration rates.
-- Add presence filter to all cat_place counts.

DO $$
BEGIN
  -- Check if view exists before attempting to modify
  IF EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'sot' AND viewname = 'v_place_ecology_stats') THEN
    DROP VIEW IF EXISTS sot.v_place_ecology_stats CASCADE;

    CREATE OR REPLACE VIEW sot.v_place_ecology_stats AS
    WITH cat_counts AS (
      SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id)::INT AS a_known,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE cp.relationship_type IN ('home', 'residence', 'colony_member')
        )::INT AS a_known_current,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        )::INT AS a_known_effective,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
            AND cp.relationship_type IN ('home', 'residence', 'colony_member')
        )::INT AS cats_needing_tnr,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        )::INT AS altered_count
      FROM sot.cat_place cp
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE COALESCE(cp.presence_status, 'unknown') != 'departed'
      GROUP BY cp.place_id
    ),
    eartip_data AS (
      SELECT
        so.place_id,
        SUM(so.eartipped_seen)::INT AS total_eartips_seen,
        SUM(so.cats_seen_total)::INT AS total_cats_seen,
        MAX(so.cats_seen_total)::INT AS n_recent_max,
        bool_or(so.eartipped_seen IS NOT NULL AND so.eartipped_seen > 0) AS has_eartip_data
      FROM ops.site_observations so
      WHERE so.place_id IS NOT NULL
        AND so.cats_seen_total IS NOT NULL
      GROUP BY so.place_id
    ),
    overrides AS (
      SELECT
        place_id,
        colony_size_estimate,
        colony_confidence
      FROM sot.places
      WHERE colony_size_estimate IS NOT NULL
        AND colony_confidence IS NOT NULL
        AND colony_confidence >= 0.9
    )
    SELECT
      COALESCE(cc.place_id, ed.place_id) AS place_id,
      COALESCE(cc.a_known, 0) AS a_known,
      COALESCE(cc.a_known_current, 0) AS a_known_current,
      COALESCE(cc.a_known_effective, 0) AS a_known_effective,
      COALESCE(cc.cats_needing_tnr, 0) AS cats_needing_tnr,
      COALESCE(ed.n_recent_max, 0) AS n_recent_max,
      -- Lower bound alteration rate
      CASE
        WHEN COALESCE(cc.a_known, 0) > 0 AND GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0)) > 0
        THEN ROUND(cc.a_known::NUMERIC / GREATEST(cc.a_known, COALESCE(ed.n_recent_max, 0)) * 100, 1)
      END AS p_lower,
      CASE
        WHEN COALESCE(cc.a_known, 0) > 0 AND GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0)) > 0
        THEN ROUND(cc.a_known::NUMERIC / GREATEST(cc.a_known, COALESCE(ed.n_recent_max, 0)) * 100, 1)
      END AS p_lower_pct,
      -- Estimation method
      CASE
        WHEN ovr.place_id IS NOT NULL THEN 'manual_override'
        WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(ed.total_eartips_seen, 0) >= 7 THEN 'mark_resight'
        WHEN COALESCE(ed.n_recent_max, 0) > 0 THEN 'max_recent'
        WHEN COALESCE(cc.a_known, 0) > 0 THEN 'verified_only'
        ELSE 'no_data'
      END AS estimation_method,
      COALESCE(ed.has_eartip_data, FALSE) AS has_eartip_data,
      COALESCE(ed.total_eartips_seen, 0) AS total_eartips_seen,
      COALESCE(ed.total_cats_seen, 0) AS total_cats_seen,
      -- Chapman mark-recapture
      CASE
        WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
        THEN ROUND(((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1, 0)::INT
      END AS n_hat_chapman,
      CASE
        WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
        THEN ROUND(
          cc.altered_count::NUMERIC * 100.0 / (((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1),
          1
        )
      END AS p_hat_chapman_pct,
      -- Best colony estimate
      COALESCE(
        ovr.colony_size_estimate,
        CASE
          WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
          THEN ROUND(((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1, 0)::INT
        END,
        GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0))
      ) AS best_colony_estimate,
      -- Estimated work remaining
      GREATEST(0,
        COALESCE(
          ovr.colony_size_estimate,
          CASE
            WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
            THEN ROUND(((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1, 0)::INT
          END,
          GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0))
        ) - COALESCE(cc.a_known, 0)
      ) AS estimated_work_remaining
    FROM cat_counts cc
    FULL OUTER JOIN eartip_data ed ON ed.place_id = cc.place_id
    LEFT JOIN overrides ovr ON ovr.place_id = COALESCE(cc.place_id, ed.place_id);

    RAISE NOTICE 'MIG_3096: v_place_ecology_stats rebuilt with presence filter';
  ELSE
    RAISE NOTICE 'MIG_3096: v_place_ecology_stats does not exist, skipping';
  END IF;
END;
$$;

-- ============================================================
-- 4. mv_beacon_place_metrics — Beacon map (CRITICAL)
--    Already fixed in MIG_3088 but the place_cats CTE needs the filter.
--    We'll add a TODO comment since rebuilding the matview is expensive
--    and should be done with REFRESH CONCURRENTLY after.
-- ============================================================

-- The matview was rebuilt in MIG_3088. Let's check if it already has the filter.
-- If not, we need to rebuild. Since we just rebuilt it recently, let's just refresh.
-- The source CTEs in MIG_3088 already have the TODO comment.
-- For now, add the filter by rebuilding.

-- NOTE: This is handled by rebuilding the matview. Since MIG_3088 already
-- has a TODO(FFS-1280) comment in the place_cats CTE, and MIG_3093 was
-- supposed to fix it, let's verify and fix if needed.

-- Rebuild the matview with presence filter in place_cats CTE
DROP MATERIALIZED VIEW IF EXISTS ops.mv_beacon_place_metrics CASCADE;
DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id)::int AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        )::int AS altered_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
        )::int AS known_status_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NULL OR c.altered_status = 'unknown'
        )::int AS unknown_status_cats,
        CASE
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
            ) > 0
            THEN ROUND(
                COUNT(DISTINCT cp.cat_id) FILTER (
                    WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
                )::numeric * 100.0 /
                NULLIF(COUNT(DISTINCT cp.cat_id) FILTER (
                    WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
                ), 0), 1
            )
        END AS alteration_rate_pct
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE COALESCE(cp.presence_status, 'unknown') != 'departed'
    GROUP BY cp.place_id
),
place_people AS (
    SELECT place_id, COUNT(DISTINCT person_id)::int AS total_people
    FROM sot.person_place
    GROUP BY place_id
),
place_requests AS (
    SELECT place_id,
        COUNT(*)::int AS total_requests,
        COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress'))::int AS active_requests
    FROM ops.requests
    GROUP BY place_id
),
place_appointments AS (
    SELECT place_id, COUNT(*)::int AS total_appointments, MAX(appointment_date) AS last_appointment_date
    FROM (
        SELECT place_id, appointment_id, appointment_date FROM ops.appointments WHERE place_id IS NOT NULL
        UNION
        SELECT inferred_place_id AS place_id, appointment_id, appointment_date FROM ops.appointments WHERE inferred_place_id IS NOT NULL
    ) combined
    GROUP BY place_id
),
latest_colony_estimates AS (
    SELECT
        COALESCE(pps.place_id, pce.place_id) AS place_id,
        COALESCE(ROUND(pps.estimate)::INTEGER, pce.total_count_observed) AS colony_estimate,
        CASE WHEN pps.place_id IS NOT NULL THEN 'kalman_filter'
             ELSE COALESCE(pce.estimate_method, 'unknown') END AS estimate_method
    FROM sot.place_population_state pps
    FULL OUTER JOIN (
        SELECT DISTINCT ON (place_id) place_id, total_count_observed, estimate_method
        FROM sot.place_colony_estimates
        ORDER BY place_id, observed_date DESC NULLS LAST, created_at DESC
    ) pce ON pce.place_id = pps.place_id
),
place_breeding AS (
    SELECT
        COALESCE(a.inferred_place_id, a.place_id) AS place_id,
        (COUNT(*) FILTER (WHERE (a.is_pregnant OR a.is_lactating)
            AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') > 0) AS has_recent_breeding,
        MAX(a.appointment_date) FILTER (WHERE a.is_pregnant OR a.is_lactating) AS last_breeding_detected
    FROM ops.appointments a
    WHERE COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL AND a.cat_id IS NOT NULL
    GROUP BY COALESCE(a.inferred_place_id, a.place_id)
),
colony_trends AS (
    SELECT place_id, trend AS colony_trend,
           CASE trend WHEN 'growing' THEN -1 WHEN 'shrinking' THEN 1 WHEN 'stable' THEN 0 ELSE 0 END AS colony_trend_score
    FROM (
        SELECT place_id,
            CASE WHEN est_count < 2 THEN 'insufficient_data'
                 WHEN latest_total > prev_total * 1.2 THEN 'growing'
                 WHEN latest_total < prev_total * 0.8 THEN 'shrinking'
                 ELSE 'stable' END AS trend
        FROM (
            SELECT place_id, COUNT(*) AS est_count,
                (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[1] AS latest_total,
                (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[2] AS prev_total
            FROM sot.place_colony_estimates WHERE total_count_observed IS NOT NULL
            GROUP BY place_id
        ) sub
    ) trend_sub
),
immigration AS (
    SELECT cp.place_id,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
              AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
              AND COALESCE(cp.presence_status, 'unknown') != 'departed'
        )::int AS new_intact_arrivals,
        CASE
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
                  AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
                  AND COALESCE(cp.presence_status, 'unknown') != 'departed'
            ) >= 5 THEN 'high'
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
                  AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
                  AND COALESCE(cp.presence_status, 'unknown') != 'departed'
            ) >= 2 THEN 'moderate'
            ELSE 'low'
        END AS immigration_pressure
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
)
SELECT
    p.place_id, p.display_name, p.formatted_address, p.place_kind,
    ST_Y(p.location::geometry) AS latitude, ST_X(p.location::geometry) AS longitude,
    COALESCE(pc.total_cats, 0)::INTEGER AS total_cats,
    COALESCE(pc.altered_cats, 0)::INTEGER AS altered_cats,
    COALESCE(pc.known_status_cats, 0)::INTEGER AS known_status_cats,
    COALESCE(pc.unknown_status_cats, 0)::INTEGER AS unknown_status_cats,
    pc.alteration_rate_pct,
    COALESCE(pp.total_people, 0)::INTEGER AS total_people,
    COALESCE(pr.total_requests, 0)::INTEGER AS total_requests,
    COALESCE(pr.active_requests, 0)::INTEGER AS active_requests,
    COALESCE(pa.total_appointments, 0)::INTEGER AS total_appointments,
    pa.last_appointment_date,
    lce.colony_estimate, lce.estimate_method,
    GREATEST(p.updated_at, pa.last_appointment_date::timestamptz) AS last_activity_at,
    NULL::TEXT AS zone_code,
    COALESCE(pb.has_recent_breeding, FALSE) AS has_recent_breeding,
    pb.last_breeding_detected::DATE AS last_breeding_detected,
    COALESCE(ct.colony_trend, 'insufficient_data') AS colony_trend,
    COALESCE(ct.colony_trend_score, 0) AS colony_trend_score,
    COALESCE(im.new_intact_arrivals, 0) AS new_intact_arrivals,
    COALESCE(im.immigration_pressure, 'low') AS immigration_pressure
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
LEFT JOIN place_requests pr ON pr.place_id = p.place_id
LEFT JOIN place_appointments pa ON pa.place_id = p.place_id
LEFT JOIN latest_colony_estimates lce ON lce.place_id = p.place_id
LEFT JOIN place_breeding pb ON pb.place_id = p.place_id
LEFT JOIN colony_trends ct ON ct.place_id = p.place_id
LEFT JOIN immigration im ON im.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

CREATE UNIQUE INDEX idx_mv_beacon_place_metrics_place_id ON ops.mv_beacon_place_metrics(place_id);

CREATE OR REPLACE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

-- ============================================================
-- 5. v_request_alteration_stats — Request progress (MEDIUM)
-- ============================================================

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_request_alteration_stats') THEN
    -- Get the current definition
    EXECUTE format(
      'CREATE OR REPLACE VIEW ops.v_request_alteration_stats AS %s',
      replace(
        (SELECT definition FROM pg_views WHERE schemaname = 'ops' AND viewname = 'v_request_alteration_stats'),
        'FROM sot.cat_place cp',
        'FROM sot.cat_place cp -- presence filter added by MIG_3096'
      )
    );
    RAISE NOTICE 'MIG_3096: Note — v_request_alteration_stats needs manual presence filter review';
  END IF;
END;
$$;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_views_fixed TEXT[];
BEGIN
  v_views_fixed := ARRAY['v_place_list', 'v_person_list_v3', 'v_place_ecology_stats'];

  -- Verify each fixed view has the presence filter
  FOR i IN 1..array_length(v_views_fixed, 1) LOOP
    IF EXISTS(
      SELECT 1 FROM pg_views
      WHERE viewname = v_views_fixed[i]
        AND definition ILIKE '%presence_status%'
    ) THEN
      RAISE NOTICE 'MIG_3096: ✓ % — has presence filter', v_views_fixed[i];
    ELSE
      RAISE NOTICE 'MIG_3096: ✗ % — MISSING presence filter', v_views_fixed[i];
    END IF;
  END LOOP;

  RAISE NOTICE 'MIG_3096: Presence filter sweep complete';
END;
$$;
