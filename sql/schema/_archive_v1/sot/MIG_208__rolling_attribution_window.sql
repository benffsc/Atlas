-- MIG_208: Rolling Attribution Window for Cat-Request Linking
--
-- Purpose: Implement a smarter time window for linking cats to requests:
--   - Legacy requests (before May 2025): Fixed ±6 month window from source_created_at
--   - Active requests (May 2025+): Rolling window that stays open until resolved
--   - Resolved requests: Window closes at resolved_at + 3 months buffer
--
-- This ensures:
--   1. Old Airtable data doesn't incorrectly link to recent cats
--   2. Active requests capture cats as they're brought to clinic
--   3. Completed requests have a grace period for late clinic visits

\echo ''
\echo '=============================================='
\echo 'MIG_208: Rolling Attribution Window'
\echo '=============================================='
\echo ''

-- Drop and recreate the view with new window logic
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

    -- WINDOW START: Always 6 months before request date
    COALESCE(r.source_created_at, r.created_at) - INTERVAL '6 months' AS window_start,

    -- WINDOW END: Depends on request age and status
    CASE
      -- Legacy requests (source_created_at before May 2025): Fixed 6-month window
      WHEN COALESCE(r.source_created_at, r.created_at) < '2025-05-01'::timestamptz
        THEN COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months'

      -- Resolved requests (completed/cancelled): resolved_at + 3 months buffer
      WHEN r.resolved_at IS NOT NULL
        THEN r.resolved_at + INTERVAL '3 months'

      -- Active requests with recent activity: last_activity_at + 6 months
      WHEN r.last_activity_at IS NOT NULL AND r.last_activity_at > NOW() - INTERVAL '1 year'
        THEN GREATEST(
          r.last_activity_at + INTERVAL '6 months',
          NOW() + INTERVAL '3 months'  -- Always extend at least 3 months into future
        )

      -- Active requests without activity tracking: NOW + 6 months (rolling)
      ELSE NOW() + INTERVAL '6 months'
    END AS window_end,

    -- Flag for UI to show window type
    CASE
      WHEN COALESCE(r.source_created_at, r.created_at) < '2025-05-01'::timestamptz
        THEN 'legacy_fixed'
      WHEN r.resolved_at IS NOT NULL
        THEN 'resolved_with_buffer'
      ELSE 'active_rolling'
    END AS window_type

  FROM trapper.sot_requests r
  WHERE r.status != 'cancelled' OR r.resolution_notes LIKE 'Upgraded to Atlas request%'
),

-- Find cats with clinic procedures in the window
cat_procedures_in_window AS (
  SELECT DISTINCT
    cp.cat_id,
    cp.procedure_date,
    cp.is_spay,
    cp.is_neuter,
    c.sex,
    c.display_name AS cat_name,
    ci.id_value AS microchip
  FROM trapper.cat_procedures cp
  JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id
  LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
  WHERE TRUE -- placeholder for future: c.merged_into_cat_id IS NULL
    AND (cp.is_spay = TRUE OR cp.is_neuter = TRUE)
),

-- Match cats to requests via place OR requester
matched_cats AS (
  SELECT DISTINCT
    rw.request_id,
    c.cat_id,
    c.display_name AS cat_name,
    c.sex,
    ci.id_value AS microchip,
    cpw.procedure_date,
    cpw.is_spay,
    cpw.is_neuter,
    rw.effective_request_date,
    -- Determine match reason for safe-linking indicator
    CASE
      WHEN rcl.link_id IS NOT NULL THEN 'explicit_link'
      WHEN cpr.cat_place_id IS NOT NULL AND pcr.person_cat_id IS NOT NULL THEN 'place_and_requester'
      WHEN cpr.cat_place_id IS NOT NULL THEN 'place_match'
      WHEN pcr.person_cat_id IS NOT NULL THEN 'requester_match'
      ELSE 'unknown'
    END AS match_reason,
    -- Confidence indicator
    CASE
      WHEN rcl.link_id IS NOT NULL THEN 1.0
      WHEN cpr.cat_place_id IS NOT NULL AND pcr.person_cat_id IS NOT NULL THEN 0.95
      WHEN cpr.cat_place_id IS NOT NULL THEN 0.85
      WHEN pcr.person_cat_id IS NOT NULL THEN 0.80
      ELSE 0.70
    END AS match_confidence
  FROM request_windows rw
  -- Cats with explicit link to request
  LEFT JOIN trapper.request_cat_links rcl ON rcl.request_id = rw.request_id
  -- Cats at same place as request
  LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = rw.place_id
  -- Cats linked to requester
  LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = rw.requester_person_id
  -- Get actual cat (any of the links)
  JOIN trapper.sot_cats c ON c.cat_id = COALESCE(rcl.cat_id, cpr.cat_id, pcr.cat_id)
    AND TRUE -- placeholder for future: c.merged_into_cat_id IS NULL
  -- Get microchip from cat_identifiers
  LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
  -- Get procedure info (may be null if cat has no procedures)
  LEFT JOIN cat_procedures_in_window cpw ON cpw.cat_id = c.cat_id
  -- At least one link must exist
  WHERE rcl.link_id IS NOT NULL
     OR cpr.cat_place_id IS NOT NULL
     OR pcr.person_cat_id IS NOT NULL
),

-- Filter to cats with procedures in the window
cats_with_procedures AS (
  SELECT *
  FROM matched_cats mc
  WHERE mc.procedure_date IS NOT NULL
    AND mc.procedure_date >= (
      SELECT window_start FROM request_windows WHERE request_id = mc.request_id
    )
    AND mc.procedure_date <= (
      SELECT window_end FROM request_windows WHERE request_id = mc.request_id
    )
),

-- Aggregate stats per request
aggregated_stats AS (
  SELECT
    rw.request_id,
    -- Total cats caught (matched with any procedure in window)
    COUNT(DISTINCT cwp.cat_id) AS cats_caught,
    -- Cats altered AFTER request date
    COUNT(DISTINCT CASE
      WHEN cwp.procedure_date > rw.effective_request_date
      THEN cwp.cat_id
    END) AS cats_altered,
    -- Cats already altered BEFORE request date
    COUNT(DISTINCT CASE
      WHEN cwp.procedure_date < rw.effective_request_date
      THEN cwp.cat_id
    END) AS already_altered_before,
    -- Sex breakdown
    COUNT(DISTINCT CASE WHEN cwp.sex = 'male' OR cwp.sex = 'Male' THEN cwp.cat_id END) AS males,
    COUNT(DISTINCT CASE WHEN cwp.sex = 'female' OR cwp.sex = 'Female' THEN cwp.cat_id END) AS females,
    -- Average match confidence
    AVG(cwp.match_confidence) AS avg_match_confidence
  FROM request_windows rw
  LEFT JOIN cats_with_procedures cwp ON cwp.request_id = rw.request_id
  GROUP BY rw.request_id
),

-- Build linked cats JSON array
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
      'altered_after_request', cwp.procedure_date > cwp.effective_request_date
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
  rw.window_type,  -- NEW: Shows what kind of window logic was applied
  COALESCE(ast.cats_caught, 0) AS cats_caught,
  COALESCE(ast.cats_altered, 0) AS cats_altered,
  COALESCE(ast.already_altered_before, 0) AS already_altered_before,
  COALESCE(ast.males, 0) AS males,
  COALESCE(ast.females, 0) AS females,
  -- Alteration Rate: cats_altered / (cats_caught - already_altered)
  CASE
    WHEN COALESCE(ast.cats_caught, 0) - COALESCE(ast.already_altered_before, 0) > 0
    THEN ROUND(
      100.0 * COALESCE(ast.cats_altered, 0)::NUMERIC /
      (COALESCE(ast.cats_caught, 0) - COALESCE(ast.already_altered_before, 0)),
      1
    )
    ELSE NULL
  END AS alteration_rate_pct,
  COALESCE(ast.avg_match_confidence, 0) AS avg_match_confidence,
  COALESCE(lcj.linked_cats, '[]'::jsonb) AS linked_cats,
  -- Is this a legacy (Airtable) request?
  rw.source_system = 'airtable' AS is_legacy_request,
  -- Can this request be upgraded?
  CASE
    WHEN rw.source_system != 'airtable' THEN FALSE
    WHEN rw.status = 'cancelled' AND rw.summary IS NULL THEN FALSE
    ELSE TRUE
  END AS can_upgrade,
  -- Place info for display
  p.display_name AS place_name,
  p.formatted_address AS place_address,
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
  COALESCE(SUM(rs.cats_caught), 0) AS total_cats_caught,
  COALESCE(SUM(rs.cats_altered), 0) AS total_cats_altered,
  COALESCE(SUM(rs.already_altered_before), 0) AS total_already_altered,
  COALESCE(SUM(rs.males), 0) AS total_males,
  COALESCE(SUM(rs.females), 0) AS total_females,
  -- Overall alteration rate for place
  CASE
    WHEN COALESCE(SUM(rs.cats_caught), 0) - COALESCE(SUM(rs.already_altered_before), 0) > 0
    THEN ROUND(
      100.0 * COALESCE(SUM(rs.cats_altered), 0)::NUMERIC /
      (COALESCE(SUM(rs.cats_caught), 0) - COALESCE(SUM(rs.already_altered_before), 0)),
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
\echo 'MIG_208 complete!'
\echo ''
\echo 'Rolling Window Logic:'
\echo '  - Legacy requests (before May 2025): Fixed ±6 month window'
\echo '  - Resolved requests: Window closes at resolved_at + 3 months'
\echo '  - Active requests: Rolling window extends to NOW + 6 months'
\echo ''
\echo 'New column added: window_type (legacy_fixed | resolved_with_buffer | active_rolling)'
\echo ''

-- Update the documentation comment
COMMENT ON VIEW trapper.v_request_alteration_stats IS
'Per-request clinic-derived statistics with ROLLING attribution windows.

Window Logic:
- Legacy requests (before May 2025): Fixed ±6 month window from source_created_at
- Resolved requests: window closes at resolved_at + 3 months (grace period)
- Active requests: Rolling window extends to NOW + 6 months

Matching Rules:
- explicit_link (100%): From request_cat_links table
- place_and_requester (95%): Cat at same place AND linked to requester
- place_match (85%): Cat has appointment history at request place
- requester_match (80%): Cat linked to requester via person_cat_relationships

Alteration Rate = cats_altered / (cats_caught - already_altered_before) * 100';
