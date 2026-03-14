BEGIN;

-- MIG_2942: Smart Dispatch Scoring (FFS-566)
-- Scores trappers for a place based on territory, availability, workload, performance, and recency

CREATE OR REPLACE FUNCTION sot.score_trappers_for_place(
  p_place_id UUID,
  p_request_id UUID DEFAULT NULL
) RETURNS TABLE (
  person_id UUID,
  trapper_name TEXT,
  trapper_type TEXT,
  service_type TEXT,
  role TEXT,
  match_reason TEXT,
  availability_status TEXT,
  active_assignments INT,
  total_cats_caught INT,
  days_since_last_here INT,
  territory_score INT,
  availability_score INT,
  workload_score INT,
  performance_score INT,
  recency_score INT,
  total_score INT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_place_family UUID[];
  v_max_cats INT;
BEGIN
  -- Get place family for recency/territory checks
  v_place_family := sot.get_place_family(p_place_id);

  -- Get max cats caught among active trappers for percentile calc
  SELECT COALESCE(MAX(fs.total_cats_caught), 1)
  INTO v_max_cats
  FROM ops.v_trapper_full_stats fs
  JOIN sot.trapper_profiles tp ON tp.person_id = fs.person_id AND tp.is_active = TRUE;

  RETURN QUERY
  WITH base_trappers AS (
    -- Get candidates from find_trappers_for_place (backward-compatible)
    SELECT
      ft.person_id,
      ft.trapper_name,
      ft.trapper_type,
      ft.service_type,
      ft.role,
      ft.match_reason
    FROM sot.find_trappers_for_place(p_place_id) ft
  ),
  enriched AS (
    SELECT
      bt.person_id,
      bt.trapper_name,
      bt.trapper_type,
      bt.service_type,
      bt.role,
      bt.match_reason,
      COALESCE(tp.availability_status, 'available') AS availability_status,
      -- Count active assignments
      (
        SELECT COUNT(*)::int
        FROM ops.request_trapper_assignments rta
        WHERE rta.trapper_person_id = bt.person_id
          AND rta.status = 'active'
      ) AS active_assignments,
      -- Total cats caught
      COALESCE(fs.total_cats_caught, 0)::int AS total_cats_caught,
      -- Days since last assignment at this place family
      (
        SELECT COALESCE(
          (CURRENT_DATE - MAX(rta.assigned_at)::date)::int,
          999
        )
        FROM ops.request_trapper_assignments rta
        JOIN ops.requests r ON r.request_id = rta.request_id
        WHERE rta.trapper_person_id = bt.person_id
          AND (r.place_id = p_place_id OR r.place_id = ANY(v_place_family))
      ) AS days_since_last_here,
      -- Territory score (40 max)
      CASE bt.service_type
        WHEN 'primary_territory' THEN 40
        WHEN 'regular' THEN 30
        WHEN 'occasional' THEN 15
        WHEN 'home_rescue' THEN 10
        WHEN 'historical' THEN 5
        ELSE 5  -- previous_assignment match
      END AS territory_score,
      -- Availability score (20 max)
      CASE COALESCE(tp.availability_status, 'available')
        WHEN 'available' THEN 20
        WHEN 'busy' THEN 5
        WHEN 'on_leave' THEN 0
        ELSE 10
      END AS availability_score
    FROM base_trappers bt
    LEFT JOIN sot.trapper_profiles tp ON tp.person_id = bt.person_id
    LEFT JOIN ops.v_trapper_full_stats fs ON fs.person_id = bt.person_id
  )
  SELECT
    e.person_id,
    e.trapper_name,
    e.trapper_type,
    e.service_type,
    e.role,
    e.match_reason,
    e.availability_status,
    e.active_assignments,
    e.total_cats_caught,
    e.days_since_last_here,
    e.territory_score,
    e.availability_score,
    -- Workload score (15 max): fewer assignments = higher score
    GREATEST(0, 15 - e.active_assignments * 3)::int AS workload_score,
    -- Performance score (15 max): percentile of cats caught
    CASE
      WHEN v_max_cats > 0 THEN LEAST(15, (e.total_cats_caught::numeric / v_max_cats * 15)::int)
      ELSE 0
    END AS performance_score,
    -- Recency score (10 max): recent work at this place = higher
    CASE
      WHEN e.days_since_last_here <= 30 THEN 10
      WHEN e.days_since_last_here <= 90 THEN 7
      WHEN e.days_since_last_here <= 180 THEN 4
      WHEN e.days_since_last_here <= 365 THEN 2
      ELSE 0
    END AS recency_score,
    -- Total score
    (
      e.territory_score +
      e.availability_score +
      GREATEST(0, 15 - e.active_assignments * 3) +
      CASE WHEN v_max_cats > 0 THEN LEAST(15, (e.total_cats_caught::numeric / v_max_cats * 15)::int) ELSE 0 END +
      CASE
        WHEN e.days_since_last_here <= 30 THEN 10
        WHEN e.days_since_last_here <= 90 THEN 7
        WHEN e.days_since_last_here <= 180 THEN 4
        WHEN e.days_since_last_here <= 365 THEN 2
        ELSE 0
      END
    )::int AS total_score
  FROM enriched e
  ORDER BY (
    e.territory_score +
    e.availability_score +
    GREATEST(0, 15 - e.active_assignments * 3) +
    CASE WHEN v_max_cats > 0 THEN LEAST(15, (e.total_cats_caught::numeric / v_max_cats * 15)::int) ELSE 0 END +
    CASE
      WHEN e.days_since_last_here <= 30 THEN 10
      WHEN e.days_since_last_here <= 90 THEN 7
      WHEN e.days_since_last_here <= 180 THEN 4
      WHEN e.days_since_last_here <= 365 THEN 2
      ELSE 0
    END
  ) DESC;
END;
$$;

COMMIT;
