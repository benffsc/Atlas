-- MIG_2956: Add onboarding + assignment details to trapper view
-- FFS-XXX: Trapper Roster UX Overhaul
-- Date: 2026-03-16
--
-- Adds contract_signed_date, profile_created_at, and assigned_request_summaries
-- to ops.v_trapper_full_stats for the enhanced trapper card UI.

BEGIN;

\echo 'MIG_2956: Adding onboarding + assignment fields to v_trapper_full_stats'

-- Drop dependent view first
DROP VIEW IF EXISTS ops.v_trapper_aggregate_stats;
DROP VIEW IF EXISTS ops.v_trapper_full_stats;

CREATE VIEW ops.v_trapper_full_stats AS
WITH trapper_roles AS (
  SELECT DISTINCT ON (pr.person_id)
    pr.person_id,
    pr.trapper_type,
    pr.role_status
  FROM sot.person_roles pr
  WHERE pr.role = 'trapper'
  ORDER BY pr.person_id,
    CASE pr.role_status WHEN 'active' THEN 0 ELSE 1 END,
    pr.created_at DESC
),
assignment_stats AS (
  SELECT
    rta.trapper_person_id AS person_id,
    COUNT(*) FILTER (WHERE rta.status = 'active') AS active_assignments,
    COUNT(*) FILTER (WHERE rta.status = 'completed') AS completed_assignments
  FROM ops.request_trapper_assignments rta
  GROUP BY rta.trapper_person_id
),
clinic_stats AS (
  SELECT
    COALESCE(a.resolved_person_id, a.person_id) AS person_id,
    COUNT(*) AS total_clinic_cats,
    COUNT(DISTINCT a.appointment_date) AS unique_clinic_days,
    COUNT(*) FILTER (WHERE a.is_spay) AS spayed_count,
    COUNT(*) FILTER (WHERE a.is_neuter) AS neutered_count,
    COUNT(*) FILTER (WHERE a.is_alteration) AS total_altered,
    MIN(a.appointment_date) AS first_clinic_date,
    MAX(a.appointment_date) AS last_clinic_date
  FROM ops.appointments a
  WHERE COALESCE(a.resolved_person_id, a.person_id) IS NOT NULL
  GROUP BY COALESCE(a.resolved_person_id, a.person_id)
),
-- Active request assignments with address for card display
active_request_summaries AS (
  SELECT
    rta.trapper_person_id AS person_id,
    jsonb_agg(
      jsonb_build_object(
        'request_id', r.request_id,
        'address', COALESCE(pl.formatted_address, pl.display_name, 'Unknown location'),
        'status', r.status
      ) ORDER BY rta.assigned_at DESC
    ) AS assigned_request_summaries
  FROM ops.request_trapper_assignments rta
  JOIN ops.requests r ON r.request_id = rta.request_id
  LEFT JOIN sot.places pl ON pl.place_id = r.place_id
  WHERE rta.status IN ('pending', 'accepted', 'active')
  GROUP BY rta.trapper_person_id
)
SELECT
  p.person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) AS display_name,
  COALESCE(tr.trapper_type, 'community_trapper') AS trapper_type,
  COALESCE(tr.role_status, 'inactive') AS role_status,
  COALESCE(tr.trapper_type IN ('ffsc_trapper', 'head_trapper', 'coordinator'), FALSE) AS is_ffsc_trapper,
  COALESCE(ast.active_assignments, 0)::int AS active_assignments,
  COALESCE(ast.completed_assignments, 0)::int AS completed_assignments,
  0::int AS total_site_visits,
  0::int AS assessment_visits,
  NULL::numeric AS first_visit_success_rate_pct,
  0::int AS cats_from_visits,
  0::int AS cats_from_assignments,
  0::int AS cats_altered_from_assignments,
  0::int AS manual_catches,
  COALESCE(cs.total_clinic_cats, 0)::int AS total_cats_caught,
  COALESCE(cs.total_clinic_cats, 0)::int AS total_clinic_cats,
  COALESCE(cs.unique_clinic_days, 0)::int AS unique_clinic_days,
  CASE WHEN COALESCE(cs.unique_clinic_days, 0) > 0
    THEN ROUND(cs.total_clinic_cats::numeric / cs.unique_clinic_days, 1)
    ELSE NULL
  END AS avg_cats_per_day,
  COALESCE(cs.spayed_count, 0)::int AS spayed_count,
  COALESCE(cs.neutered_count, 0)::int AS neutered_count,
  COALESCE(cs.total_altered, 0)::int AS total_altered,
  0::int AS felv_tested_count,
  0::int AS felv_positive_count,
  NULL::numeric AS felv_positive_rate_pct,
  cs.first_clinic_date,
  cs.last_clinic_date,
  LEAST(cs.first_clinic_date, p.created_at::date) AS first_activity_date,
  GREATEST(cs.last_clinic_date, p.updated_at::date) AS last_activity_date,
  sot.get_email(p.person_id) AS email,
  sot.get_phone(p.person_id) AS phone,
  COALESCE(tp.availability_status, 'available') AS availability_status,
  -- New onboarding fields (MIG_2956)
  tp.contract_signed_date,
  tp.created_at AS profile_created_at,
  ars.assigned_request_summaries
FROM sot.people p
JOIN trapper_roles tr ON tr.person_id = p.person_id
LEFT JOIN assignment_stats ast ON ast.person_id = p.person_id
LEFT JOIN clinic_stats cs ON cs.person_id = p.person_id
LEFT JOIN sot.trapper_profiles tp ON tp.person_id = p.person_id
LEFT JOIN active_request_summaries ars ON ars.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL;

-- Recreate aggregate view
CREATE VIEW ops.v_trapper_aggregate_stats AS
SELECT
  COUNT(*) FILTER (WHERE role_status = 'active')::int AS total_active_trappers,
  COUNT(*) FILTER (WHERE is_ffsc_trapper)::int AS ffsc_trappers,
  COUNT(*) FILTER (WHERE NOT is_ffsc_trapper)::int AS community_trappers,
  COUNT(*) FILTER (WHERE role_status != 'active')::int AS inactive_trappers,
  SUM(total_clinic_cats)::int AS all_clinic_cats,
  SUM(unique_clinic_days)::int AS all_clinic_days,
  CASE WHEN SUM(unique_clinic_days) > 0
    THEN ROUND(SUM(total_clinic_cats)::numeric / SUM(unique_clinic_days), 1)
    ELSE NULL
  END AS avg_cats_per_day_all,
  NULL::numeric AS felv_positive_rate_pct_all,
  SUM(total_site_visits)::int AS all_site_visits,
  NULL::numeric AS first_visit_success_rate_pct_all,
  SUM(total_cats_caught)::int AS all_cats_caught,
  COUNT(*) FILTER (WHERE role_status = 'active' AND availability_status = 'available')::int AS available_trappers,
  COUNT(*) FILTER (WHERE role_status = 'active' AND availability_status = 'busy')::int AS busy_trappers,
  COUNT(*) FILTER (WHERE role_status = 'active' AND availability_status = 'on_leave')::int AS on_leave_trappers
FROM ops.v_trapper_full_stats;

\echo 'MIG_2956: Onboarding + assignment fields added to v_trapper_full_stats'

-- Verify new columns exist
SELECT
  contract_signed_date,
  profile_created_at,
  assigned_request_summaries
FROM ops.v_trapper_full_stats
LIMIT 3;

COMMIT;
