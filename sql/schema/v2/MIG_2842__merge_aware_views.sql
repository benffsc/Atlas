-- MIG_2842: Add merged_into_request_id IS NULL filter to request views
--
-- With MIG_2839 adding merged_into_request_id to ops.requests, all views that
-- list/aggregate requests must exclude merged records (INV-7).
--
-- Views updated:
-- 1. ops.v_request_list — main request list view
-- 2. ops.v_request_alteration_stats — attribution stats view

BEGIN;

-- =============================================================================
-- 1. ops.v_request_list — add WHERE r.merged_into_request_id IS NULL
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_request_list AS
SELECT
  r.request_id,
  r.status::TEXT,
  r.priority::TEXT,
  r.summary,
  r.estimated_cat_count,
  COALESCE(r.has_kittens, FALSE) AS has_kittens,
  NULL::TIMESTAMPTZ AS scheduled_date,
  NULL::TEXT AS assigned_to,
  r.created_at,
  r.updated_at,
  r.source_created_at,
  r.place_id,
  -- Place info
  COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1)) AS place_name,
  p.formatted_address AS place_address,
  sa.city AS place_city,
  -- Requester info
  r.requester_person_id,
  per.display_name AS requester_name,
  (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
   FROM sot.person_identifiers pi
   WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5
   LIMIT 1) AS requester_email,
  (SELECT COALESCE(pi.id_value_raw, pi.id_value_norm)
   FROM sot.person_identifiers pi
   WHERE pi.person_id = r.requester_person_id AND pi.id_type = 'phone' AND pi.confidence >= 0.5
   LIMIT 1) AS requester_phone,
  r.requester_role_at_submission,
  r.requester_is_site_contact,
  sc.display_name AS site_contact_name,
  -- Location
  CASE WHEN p.location IS NOT NULL THEN ST_Y(p.location::geometry) END AS latitude,
  CASE WHEN p.location IS NOT NULL THEN ST_X(p.location::geometry) END AS longitude,
  -- Stats
  (SELECT COUNT(*) FROM ops.request_cats rc WHERE rc.request_id = r.request_id)::INT AS linked_cat_count,
  -- Legacy flag
  r.source_system LIKE 'airtable%' AS is_legacy_request,
  -- Trapper info
  COALESCE((
    SELECT COUNT(*) FROM ops.request_trapper_assignments rta
    WHERE rta.request_id = r.request_id AND rta.status = 'active'
  ), 0)::INT AS active_trapper_count,
  p.location IS NOT NULL AS place_has_location,
  -- Data quality flags
  ARRAY_REMOVE(ARRAY[
    CASE WHEN r.assignment_status = 'pending' AND r.status NOT IN ('completed', 'cancelled') THEN 'no_trapper' END,
    CASE WHEN r.assignment_status = 'client_trapping' THEN 'client_trapping' END,
    CASE WHEN p.location IS NULL AND r.status NOT IN ('completed', 'cancelled') THEN 'no_geometry' END,
    CASE WHEN r.updated_at < NOW() - INTERVAL '30 days' AND r.status NOT IN ('completed', 'cancelled', 'on_hold') THEN 'stale_30d' END,
    CASE WHEN r.requester_person_id IS NULL THEN 'no_requester' END
  ], NULL) AS data_quality_flags,
  r.no_trapper_reason,
  -- Primary trapper name
  (SELECT per2.display_name
   FROM ops.request_trapper_assignments rta
   JOIN sot.people per2 ON per2.person_id = rta.trapper_person_id
   WHERE rta.request_id = r.request_id AND rta.status = 'active'
   ORDER BY (rta.assignment_type = 'primary') DESC, rta.assigned_at
   LIMIT 1) AS primary_trapper_name,
  r.assignment_status::TEXT,
  -- Map preview caching
  r.map_preview_url,
  r.map_preview_updated_at
FROM ops.requests r
LEFT JOIN sot.places p ON p.place_id = r.place_id AND p.merged_into_place_id IS NULL
LEFT JOIN sot.addresses sa ON sa.address_id = p.sot_address_id AND sa.merged_into_address_id IS NULL
LEFT JOIN sot.people per ON per.person_id = r.requester_person_id AND per.merged_into_person_id IS NULL
LEFT JOIN sot.people sc ON sc.person_id = r.site_contact_person_id AND sc.merged_into_person_id IS NULL
WHERE r.merged_into_request_id IS NULL;

-- =============================================================================
-- 2. ops.v_request_alteration_stats — add WHERE filter in request_windows CTE
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_request_alteration_stats AS
WITH request_windows AS (
    SELECT
        r.request_id,
        r.status,
        r.place_id,
        r.requester_person_id AS requester_id,
        r.created_at AS request_date,
        r.resolved_at,
        r.estimated_cat_count,
        GREATEST(
            r.created_at - INTERVAL '6 months',
            COALESCE(
                (SELECT MIN(a.appointment_date)::timestamptz
                 FROM ops.appointments a
                 WHERE a.place_id = r.place_id OR a.inferred_place_id = r.place_id),
                r.created_at - INTERVAL '6 months'
            )
        ) AS window_start,
        CASE
            WHEN r.status IN ('completed', 'cancelled')
            THEN COALESCE(r.resolved_at, r.updated_at) + INTERVAL '3 months'
            ELSE NOW() + INTERVAL '6 months'
        END AS window_end
    FROM ops.requests r
    WHERE r.merged_into_request_id IS NULL
),
place_appointments AS (
    SELECT
        COALESCE(a.place_id, a.inferred_place_id) AS place_id,
        a.appointment_id,
        a.cat_id,
        a.appointment_date,
        a.is_alteration,
        a.is_spay,
        a.is_neuter,
        c.altered_status,
        c.sex
    FROM ops.appointments a
    LEFT JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE COALESCE(a.place_id, a.inferred_place_id) IS NOT NULL
),
place_cats AS (
    SELECT
        cp.place_id,
        c.cat_id,
        c.altered_status,
        c.sex,
        (SELECT MIN(a.appointment_date) FROM ops.appointments a WHERE a.cat_id = c.cat_id AND a.is_alteration = TRUE) AS altered_date
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id
    WHERE c.merged_into_cat_id IS NULL
)
SELECT
    rw.request_id,
    rw.status,
    rw.place_id,
    rw.requester_id,
    rw.request_date,
    rw.resolved_at,
    rw.window_start,
    rw.window_end,
    rw.estimated_cat_count,
    (SELECT COUNT(DISTINCT pc2.cat_id) FROM place_cats pc2 WHERE pc2.place_id = rw.place_id) AS total_cats_at_place,
    COUNT(DISTINCT pa.cat_id) FILTER (WHERE pa.appointment_date::timestamptz >= rw.window_start AND pa.appointment_date::timestamptz <= rw.window_end) AS cats_seen_in_window,
    COUNT(DISTINCT pc.cat_id) FILTER (WHERE pc.altered_status IN ('spayed', 'neutered', 'altered')) AS cats_altered_total,
    COUNT(DISTINCT pc.cat_id) FILTER (WHERE pc.altered_status IN ('spayed', 'neutered', 'altered') AND pc.altered_date >= rw.window_start::date AND pc.altered_date <= rw.window_end::date) AS cats_altered_for_request,
    COUNT(DISTINCT pa.appointment_id) FILTER (WHERE pa.appointment_date::timestamptz >= rw.window_start AND pa.appointment_date::timestamptz <= rw.window_end) AS appointments_in_window,
    COUNT(DISTINCT pa.appointment_id) FILTER (WHERE pa.is_alteration = TRUE AND pa.appointment_date::timestamptz >= rw.window_start AND pa.appointment_date::timestamptz <= rw.window_end) AS alterations_in_window,
    CASE
        WHEN COALESCE(rw.estimated_cat_count, 0) > 0
        THEN ROUND(
            COUNT(DISTINCT pc.cat_id) FILTER (WHERE pc.altered_status IN ('spayed', 'neutered', 'altered') AND pc.altered_date >= rw.window_start::date AND pc.altered_date <= rw.window_end::date)::numeric
            / rw.estimated_cat_count::numeric * 100, 1
        )
        ELSE NULL
    END AS progress_pct,
    EXTRACT(DAY FROM NOW() - rw.request_date)::INT AS days_since_request,
    EXTRACT(DAY FROM rw.window_end - NOW())::INT AS days_until_window_closes
FROM request_windows rw
LEFT JOIN place_appointments pa ON pa.place_id = rw.place_id
LEFT JOIN place_cats pc ON pc.place_id = rw.place_id
GROUP BY rw.request_id, rw.status, rw.place_id, rw.requester_id, rw.request_date, rw.resolved_at, rw.window_start, rw.window_end, rw.estimated_cat_count;

COMMIT;
