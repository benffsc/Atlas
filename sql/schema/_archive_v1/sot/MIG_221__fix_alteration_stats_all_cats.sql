-- MIG_221: Fix Alteration Stats to Show ALL Cats at Place
--
-- Problem: The v_request_alteration_stats view only shows cats with procedures
-- within a time window (6 months before/after request). This causes issues when:
--   - Request was entered AFTER work already started (common for Airtable imports)
--   - Work at a place spans multiple years
--
-- Solution: Show ALL altered cats at the place (cats_total_at_place) in addition
-- to the windowed stats. The UI can then show both:
--   - "Cats done at this place: 14" (total)
--   - "Cats altered since request: 4" (window-based, for attribution)
--
-- Also fixes: Legacy detection should use source_system, not just date

\echo ''
\echo '=============================================='
\echo 'MIG_221: Fix Alteration Stats - Show All Cats'
\echo '=============================================='
\echo ''

-- Drop and recreate the view with improved logic
DROP VIEW IF EXISTS trapper.v_request_alteration_stats CASCADE;

CREATE OR REPLACE VIEW trapper.v_request_alteration_stats AS
WITH request_windows AS (
  -- Calculate time windows based on request age and status
  SELECT
    r.request_id,
    r.place_id,
    r.requester_person_id,
    r.source_system,
    r.source_record_id,
    r.status,
    r.summary,
    r.estimated_cat_count,
    r.resolved_at,
    r.last_activity_at,
    COALESCE(r.source_created_at, r.created_at) AS effective_request_date,

    -- WINDOW START: Either 6 months before request OR earliest procedure at place
    COALESCE(r.source_created_at, r.created_at) - INTERVAL '6 months' AS window_start,

    -- WINDOW END: Depends on request status
    CASE
      -- Resolved requests: resolved_at + 3 months buffer
      WHEN r.resolved_at IS NOT NULL
        THEN r.resolved_at + INTERVAL '3 months'

      -- Active requests with recent activity: last_activity_at + 6 months
      WHEN r.last_activity_at IS NOT NULL AND r.last_activity_at > NOW() - INTERVAL '1 year'
        THEN GREATEST(
          r.last_activity_at + INTERVAL '6 months',
          NOW() + INTERVAL '3 months'
        )

      -- Active requests: NOW + 6 months (rolling)
      ELSE NOW() + INTERVAL '6 months'
    END AS window_end,

    -- Flag for UI to show window type
    CASE
      WHEN r.source_system = 'airtable' THEN 'legacy_fixed'
      WHEN r.resolved_at IS NOT NULL THEN 'resolved_with_buffer'
      ELSE 'active_rolling'
    END AS window_type,

    -- Is this a legacy request? (by source_system, not date)
    r.source_system = 'airtable' AS is_legacy

  FROM trapper.sot_requests r
  WHERE r.status != 'cancelled' OR r.resolution_notes LIKE 'Upgraded to Atlas request%'
),

-- ALL cats linked to the place (regardless of time window)
all_place_cats AS (
  SELECT DISTINCT
    rw.request_id,
    c.cat_id,
    c.display_name AS cat_name,
    c.sex,
    ci.id_value AS microchip,
    cp.procedure_date,
    cp.is_spay,
    cp.is_neuter,
    rw.effective_request_date,
    cpr.relationship_type AS match_reason,
    CASE
      WHEN cpr.confidence = 'high' THEN 0.95
      WHEN cpr.confidence = 'medium' THEN 0.80
      WHEN cpr.confidence = 'low' THEN 0.60
      ELSE 0.85  -- default for appointment_site
    END AS match_confidence
  FROM request_windows rw
  JOIN trapper.cat_place_relationships cpr ON cpr.place_id = rw.place_id
  JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
  LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
  LEFT JOIN trapper.cat_procedures cp
    ON cp.cat_id = c.cat_id
    AND (cp.is_spay = TRUE OR cp.is_neuter = TRUE)
  WHERE rw.place_id IS NOT NULL
),

-- Filter to cats with actual procedures (for stats calculation)
cats_with_procedures AS (
  SELECT DISTINCT ON (request_id, cat_id)
    apc.*,
    -- Is procedure within the attribution window?
    CASE
      WHEN apc.procedure_date IS NOT NULL
        AND apc.procedure_date >= (SELECT window_start FROM request_windows WHERE request_id = apc.request_id)
        AND apc.procedure_date <= (SELECT window_end FROM request_windows WHERE request_id = apc.request_id)
      THEN TRUE
      ELSE FALSE
    END AS in_window,
    -- Was altered after request date?
    CASE
      WHEN apc.procedure_date IS NOT NULL AND apc.procedure_date >= apc.effective_request_date
      THEN TRUE
      ELSE FALSE
    END AS altered_after_request
  FROM all_place_cats apc
  WHERE apc.procedure_date IS NOT NULL
  ORDER BY apc.request_id, apc.cat_id, apc.procedure_date DESC
),

-- Aggregate stats per request
aggregated_stats AS (
  SELECT
    rw.request_id,

    -- TOTAL cats at place (all time) - this is the key fix!
    COUNT(DISTINCT cwp.cat_id) AS cats_total_at_place,

    -- Cats with procedures in window (for attribution)
    COUNT(DISTINCT CASE WHEN cwp.in_window THEN cwp.cat_id END) AS cats_in_window,

    -- Cats altered AFTER request date (within window)
    COUNT(DISTINCT CASE WHEN cwp.in_window AND cwp.altered_after_request THEN cwp.cat_id END) AS cats_altered_after_request,

    -- Cats already altered BEFORE request date (within window)
    COUNT(DISTINCT CASE WHEN cwp.in_window AND NOT cwp.altered_after_request THEN cwp.cat_id END) AS cats_altered_before_request,

    -- Sex breakdown (all cats at place)
    COUNT(DISTINCT CASE WHEN LOWER(cwp.sex) = 'male' THEN cwp.cat_id END) AS males,
    COUNT(DISTINCT CASE WHEN LOWER(cwp.sex) = 'female' THEN cwp.cat_id END) AS females,

    -- Average match confidence
    AVG(cwp.match_confidence) AS avg_match_confidence
  FROM request_windows rw
  LEFT JOIN cats_with_procedures cwp ON cwp.request_id = rw.request_id
  GROUP BY rw.request_id
),

-- Build linked cats JSON array (all cats at place)
linked_cats_json AS (
  SELECT
    cwp.request_id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'cat_id', cwp.cat_id,
      'cat_name', cwp.cat_name,
      'microchip', cwp.microchip,
      'sex', cwp.sex,
      'match_reason', cwp.match_reason,
      'confidence', cwp.match_confidence,
      'procedure_date', cwp.procedure_date,
      'is_spay', cwp.is_spay,
      'is_neuter', cwp.is_neuter,
      'altered_after_request', cwp.altered_after_request,
      'in_window', cwp.in_window
    )) FILTER (WHERE cwp.cat_id IS NOT NULL) AS linked_cats
  FROM cats_with_procedures cwp
  GROUP BY cwp.request_id
)

SELECT
  rw.request_id,
  rw.source_system,
  rw.source_record_id,
  rw.status,
  rw.summary,
  rw.estimated_cat_count,
  rw.effective_request_date,
  rw.window_start,
  rw.window_end,
  rw.window_type,

  -- KEY NEW STATS: Total cats done at this place (all time)
  COALESCE(ast.cats_total_at_place, 0) AS cats_caught,

  -- Cats in the attribution window (caught FOR this request)
  COALESCE(ast.cats_in_window, 0) AS cats_for_request,

  -- Cats altered after request was made (for attribution)
  COALESCE(ast.cats_altered_after_request, 0) AS cats_altered,

  -- Cats that were already done before request
  COALESCE(ast.cats_total_at_place, 0) - COALESCE(ast.cats_in_window, 0) AS already_altered_before,

  -- Sex breakdown
  COALESCE(ast.males, 0) AS males,
  COALESCE(ast.females, 0) AS females,

  -- Alteration Rate: Now based on ALL cats at place vs estimated
  CASE
    WHEN rw.estimated_cat_count IS NOT NULL AND rw.estimated_cat_count > 0
    THEN ROUND(
      100.0 * COALESCE(ast.cats_total_at_place, 0)::NUMERIC / rw.estimated_cat_count,
      1
    )
    ELSE NULL
  END AS alteration_rate_pct,

  COALESCE(ast.avg_match_confidence, 0) * 100 AS avg_match_confidence,
  COALESCE(lcj.linked_cats, '[]'::jsonb) AS linked_cats,

  -- Is this a legacy (Airtable) request?
  rw.is_legacy AS is_legacy_request,

  -- Can this request be upgraded?
  CASE
    WHEN NOT rw.is_legacy THEN FALSE
    WHEN rw.status = 'cancelled' AND rw.summary IS NULL THEN FALSE
    ELSE TRUE
  END AS can_upgrade,

  -- Place info for display (use address if place name == requester name)
  CASE
    WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
      AND LOWER(TRIM(p.display_name)) = LOWER(TRIM(per.display_name))
    THEN COALESCE(
      -- Try to get a short address (street only)
      SPLIT_PART(p.formatted_address, ',', 1),
      p.formatted_address
    )
    ELSE COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1))
  END AS place_name,
  p.formatted_address AS place_address,
  -- Flag if place name is derived from address (vs custom name)
  CASE
    WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
      AND LOWER(TRIM(p.display_name)) = LOWER(TRIM(per.display_name))
    THEN TRUE
    ELSE FALSE
  END AS place_name_is_address,
  -- Requester info
  per.display_name AS requester_name

FROM request_windows rw
LEFT JOIN aggregated_stats ast ON ast.request_id = rw.request_id
LEFT JOIN linked_cats_json lcj ON lcj.request_id = rw.request_id
LEFT JOIN trapper.places p ON p.place_id = rw.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = rw.requester_person_id;

-- Recreate dependent view: v_place_alteration_history
DROP VIEW IF EXISTS trapper.v_place_alteration_history CASCADE;

CREATE OR REPLACE VIEW trapper.v_place_alteration_history AS
WITH request_stats AS (
  SELECT
    r.place_id,
    r.request_id,
    vas.effective_request_date,
    vas.cats_caught,
    vas.cats_altered,
    vas.already_altered_before,
    vas.males,
    vas.females,
    vas.alteration_rate_pct,
    EXTRACT(YEAR FROM vas.effective_request_date) AS request_year
  FROM trapper.sot_requests r
  JOIN trapper.v_request_alteration_stats vas ON vas.request_id = r.request_id
  WHERE r.place_id IS NOT NULL
    AND r.status != 'cancelled'
),
yearly_stats AS (
  SELECT
    place_id,
    request_year::INTEGER,
    COUNT(DISTINCT request_id) AS requests,
    SUM(cats_caught) AS caught,
    SUM(cats_altered) AS altered
  FROM request_stats
  GROUP BY place_id, request_year
)
SELECT
  p.place_id,
  p.display_name AS place_name,
  p.formatted_address,
  p.service_zone,
  -- Aggregate across all requests at this place
  COUNT(DISTINCT rs.request_id) AS total_requests,
  COALESCE(MAX(rs.cats_caught), 0) AS total_cats_caught,  -- Use MAX since cats are shared across requests
  COALESCE(SUM(rs.cats_altered), 0) AS total_cats_altered,
  COALESCE(MAX(rs.already_altered_before), 0) AS total_already_altered,
  COALESCE(MAX(rs.males), 0) AS total_males,
  COALESCE(MAX(rs.females), 0) AS total_females,
  -- Overall alteration rate for place
  CASE
    WHEN COALESCE(MAX(rs.cats_caught), 0) > 0
    THEN ROUND(
      100.0 * COALESCE(MAX(rs.cats_caught), 0)::NUMERIC /
      GREATEST(COALESCE(MAX(rs.cats_caught), 0), 1),
      1
    )
    ELSE NULL
  END AS place_alteration_rate_pct,
  -- Date range
  MIN(rs.effective_request_date) AS first_request_date,
  MAX(rs.effective_request_date) AS latest_request_date,
  -- Year-over-year breakdown
  (
    SELECT jsonb_object_agg(
      ys.request_year::TEXT,
      jsonb_build_object(
        'requests', ys.requests,
        'caught', ys.caught,
        'altered', ys.altered
      )
    )
    FROM yearly_stats ys
    WHERE ys.place_id = p.place_id
  ) AS yearly_breakdown
FROM trapper.places p
LEFT JOIN request_stats rs ON rs.place_id = p.place_id
GROUP BY p.place_id, p.display_name, p.formatted_address, p.service_zone
HAVING COUNT(DISTINCT rs.request_id) > 0;

\echo ''
\echo 'MIG_221 complete!'
\echo ''
\echo 'Key changes:'
\echo '  - cats_caught now shows ALL altered cats at the place (all time)'
\echo '  - cats_altered shows cats done AFTER request was created'
\echo '  - already_altered_before = cats_caught - cats_altered'
\echo '  - alteration_rate_pct = cats_caught / estimated_cat_count'
\echo '  - Legacy detection now uses source_system = airtable, not date'
\echo ''

COMMENT ON VIEW trapper.v_request_alteration_stats IS
'Per-request clinic-derived statistics showing ALL cats at place.

Key columns:
- cats_caught: Total altered cats linked to this place (ALL TIME)
- cats_altered: Cats altered AFTER request was created (for attribution)
- already_altered_before: Cats that were done before request
- alteration_rate_pct: cats_caught / estimated_cat_count (progress %)

Matching is via cat_place_relationships (appointment history).
Each cat includes in_window and altered_after_request flags for attribution.';
