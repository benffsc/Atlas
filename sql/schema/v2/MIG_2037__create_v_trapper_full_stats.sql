-- MIG_2037: Create ops.v_trapper_full_stats view for Trapper dashboard
-- Date: 2026-02-13
-- Issue: Trapper dashboard needs full stats view

CREATE OR REPLACE VIEW ops.v_trapper_full_stats AS
WITH trapper_roles AS (
  SELECT DISTINCT ON (pr.person_id)
    pr.person_id,
    pr.trapper_type,
    pr.role_status,
    pr.role = 'trapper' OR pr.trapper_type IS NOT NULL AS is_trapper
  FROM sot.person_roles pr
  WHERE pr.role IN ('trapper', 'staff', 'coordinator')
     OR pr.trapper_type IS NOT NULL
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
)
SELECT
  p.person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) AS display_name,
  COALESCE(tr.trapper_type, 'community_trapper') AS trapper_type,
  COALESCE(tr.role_status, 'inactive') AS role_status,
  COALESCE(tr.trapper_type IN ('ffsc_trapper', 'head_trapper', 'coordinator'), FALSE) AS is_ffsc_trapper,
  COALESCE(ast.active_assignments, 0)::int AS active_assignments,
  COALESCE(ast.completed_assignments, 0)::int AS completed_assignments,
  -- Site visit stats (placeholder - no site_visits table in V2 yet)
  0::int AS total_site_visits,
  0::int AS assessment_visits,
  NULL::numeric AS first_visit_success_rate_pct,
  0::int AS cats_from_visits,
  -- Assignment-based cats
  0::int AS cats_from_assignments,
  0::int AS cats_altered_from_assignments,
  0::int AS manual_catches,
  -- Combined stats
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
  -- FeLV stats (placeholder - need cat_test_results join)
  0::int AS felv_tested_count,
  0::int AS felv_positive_count,
  NULL::numeric AS felv_positive_rate_pct,
  -- Activity dates
  cs.first_clinic_date,
  cs.last_clinic_date,
  LEAST(cs.first_clinic_date, p.created_at::date) AS first_activity_date,
  GREATEST(cs.last_clinic_date, p.updated_at::date) AS last_activity_date
FROM sot.people p
JOIN trapper_roles tr ON tr.person_id = p.person_id
LEFT JOIN assignment_stats ast ON ast.person_id = p.person_id
LEFT JOIN clinic_stats cs ON cs.person_id = p.person_id
WHERE p.merged_into_person_id IS NULL
  AND tr.is_trapper;

-- Aggregate stats for dashboard header
CREATE OR REPLACE VIEW ops.v_trapper_aggregate_stats AS
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
  SUM(total_cats_caught)::int AS all_cats_caught
FROM ops.v_trapper_full_stats;
