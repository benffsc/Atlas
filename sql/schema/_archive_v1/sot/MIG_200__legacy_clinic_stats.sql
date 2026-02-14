-- MIG_200: Legacy Request Clinic Stats & Alteration Rate
--
-- Purpose: Add clinic-derived statistics to requests (cats caught, alteration rate)
-- and provide an upgrade path from legacy Airtable requests to modern Atlas format.
--
-- Key Features:
-- 1. v_request_alteration_stats - Per-request clinic-derived stats
-- 2. v_place_alteration_history - Per-place colony management stats
-- 3. upgrade_legacy_request() - Creates new request, archives original
--
-- Matching Rules (User-Approved):
-- - Link cats if booking person matches requester OR has relationship to same place
-- - 12-month window centered on request date (±6 months)
-- - Confidence scoring: explicit_link (100%), place_match (85%), requester_match (80%)
--
-- Alteration Rate Formula:
-- alteration_rate = cats_altered / (cats_caught - already_altered_before) * 100
-- where:
--   cats_caught = cats with appointments in window
--   cats_altered = subset where procedure_date > request_date
--   already_altered_before = cats where procedure_date < request_date (not counted toward work)

-- ============================================================================
-- VIEW: v_request_alteration_stats
-- Per-request clinic-derived statistics with safe linking
-- ============================================================================

DROP VIEW IF EXISTS trapper.v_request_alteration_stats CASCADE;

CREATE OR REPLACE VIEW trapper.v_request_alteration_stats AS
WITH request_windows AS (
  -- Calculate the 6-month window around each request
  SELECT
    r.request_id,
    r.place_id,
    r.requester_person_id,
    r.source_system,
    r.source_record_id,
    r.status,
    r.summary,
    r.estimated_cat_count,
    COALESCE(r.source_created_at, r.created_at) AS effective_request_date,
    COALESCE(r.source_created_at, r.created_at) - INTERVAL '6 months' AS window_start,
    COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months' AS window_end
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

-- ============================================================================
-- VIEW: v_place_alteration_history
-- Per-place colony management statistics over time
-- ============================================================================

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

-- ============================================================================
-- FUNCTION: upgrade_legacy_request
-- Creates new Atlas request from legacy Airtable record
-- Archives the original with status=cancelled and link to new request
-- ============================================================================

CREATE OR REPLACE FUNCTION trapper.upgrade_legacy_request(
  p_request_id UUID,
  p_upgraded_by TEXT DEFAULT 'web_user',
  -- Questionnaire answers for missing fields
  p_permission_status TEXT DEFAULT NULL,
  p_access_notes TEXT DEFAULT NULL,
  p_traps_overnight_safe BOOLEAN DEFAULT NULL,
  p_access_without_contact BOOLEAN DEFAULT NULL,
  p_colony_duration TEXT DEFAULT NULL,
  p_count_confidence TEXT DEFAULT NULL,
  p_is_being_fed BOOLEAN DEFAULT NULL,
  p_feeding_schedule TEXT DEFAULT NULL,
  p_best_times_seen TEXT DEFAULT NULL,
  p_urgency_reasons TEXT[] DEFAULT NULL,
  p_urgency_notes TEXT DEFAULT NULL,
  -- Special cases
  p_kittens_already_taken BOOLEAN DEFAULT FALSE,
  p_already_assessed BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
  v_legacy RECORD;
  v_new_request_id UUID;
BEGIN
  -- Get the legacy request
  SELECT * INTO v_legacy
  FROM trapper.sot_requests
  WHERE request_id = p_request_id
    AND source_system = 'airtable';

  IF v_legacy IS NULL THEN
    RAISE EXCEPTION 'Request not found or not a legacy Airtable request: %', p_request_id;
  END IF;

  -- Check if already upgraded
  IF v_legacy.status = 'cancelled' AND v_legacy.resolution_notes LIKE 'Upgraded to Atlas request%' THEN
    RAISE EXCEPTION 'Request has already been upgraded';
  END IF;

  -- Generate new request ID
  v_new_request_id := gen_random_uuid();

  -- Create new Atlas request with original date as source_created_at
  INSERT INTO trapper.sot_requests (
    request_id,
    -- Preserve key fields
    place_id,
    requester_person_id,
    -- Use original Airtable date
    source_created_at,
    source_system,
    source_record_id,
    -- Copy existing data
    summary,
    estimated_cat_count,
    has_kittens,
    cats_are_friendly,
    notes,
    legacy_notes,
    internal_notes,
    -- New questionnaire fields
    permission_status,
    access_notes,
    traps_overnight_safe,
    access_without_contact,
    colony_duration,
    count_confidence,
    is_being_fed,
    feeding_schedule,
    best_times_seen,
    urgency_reasons,
    urgency_notes,
    -- Preserved operational fields
    priority,
    request_purpose,
    -- Metadata
    data_source,
    created_by,
    created_at
  ) VALUES (
    v_new_request_id,
    v_legacy.place_id,
    v_legacy.requester_person_id,
    COALESCE(v_legacy.source_created_at, v_legacy.created_at),
    'airtable_upgraded',
    v_legacy.source_record_id,
    v_legacy.summary,
    v_legacy.estimated_cat_count,
    CASE WHEN p_kittens_already_taken THEN FALSE ELSE v_legacy.has_kittens END,
    v_legacy.cats_are_friendly,
    v_legacy.notes,
    v_legacy.legacy_notes,
    COALESCE(v_legacy.internal_notes, '') ||
      CASE WHEN p_already_assessed THEN E'\n[Upgraded: Already assessed prior to upgrade]' ELSE '' END ||
      CASE WHEN p_kittens_already_taken THEN E'\n[Upgraded: Kittens already taken at time of upgrade]' ELSE '' END,
    COALESCE(p_permission_status, v_legacy.permission_status, 'unknown')::trapper.permission_status,
    COALESCE(p_access_notes, v_legacy.access_notes),
    COALESCE(p_traps_overnight_safe, v_legacy.traps_overnight_safe),
    COALESCE(p_access_without_contact, v_legacy.access_without_contact),
    COALESCE(p_colony_duration, v_legacy.colony_duration, 'unknown')::trapper.colony_duration,
    COALESCE(p_count_confidence, v_legacy.count_confidence, 'unknown')::trapper.count_confidence,
    COALESCE(p_is_being_fed, v_legacy.is_being_fed),
    COALESCE(p_feeding_schedule, v_legacy.feeding_schedule),
    COALESCE(p_best_times_seen, v_legacy.best_times_seen),
    COALESCE(p_urgency_reasons, v_legacy.urgency_reasons),
    COALESCE(p_urgency_notes, v_legacy.urgency_notes),
    COALESCE(v_legacy.priority, 'normal'),
    COALESCE(v_legacy.request_purpose, 'tnr'),
    'upgraded',
    p_upgraded_by,
    NOW()
  );

  -- Copy request_cat_links to new request
  INSERT INTO trapper.request_cat_links (
    request_id, cat_id, link_purpose, link_notes, linked_by
  )
  SELECT
    v_new_request_id,
    cat_id,
    link_purpose,
    COALESCE(link_notes, '') || ' [Copied from legacy request ' || p_request_id || ']',
    p_upgraded_by
  FROM trapper.request_cat_links
  WHERE request_id = p_request_id
  ON CONFLICT DO NOTHING;

  -- Archive the original legacy request
  UPDATE trapper.sot_requests
  SET status = 'cancelled'::trapper.request_status,
      resolution_notes = 'Upgraded to Atlas request: ' || v_new_request_id,
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE request_id = p_request_id;

  -- Log the upgrade to entity_edits
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name, old_value, new_value,
    reason, edited_by, edit_source
  ) VALUES (
    'request', v_new_request_id, 'create', NULL, NULL, NULL,
    'Upgraded from legacy Airtable request: ' || p_request_id,
    p_upgraded_by, 'upgrade_wizard'
  );

  -- Also log the archival of the old request
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name, old_value, new_value,
    reason, edited_by, edit_source
  ) VALUES (
    'request', p_request_id, 'update', 'status', v_legacy.status::TEXT, 'cancelled',
    'Archived: Upgraded to ' || v_new_request_id,
    p_upgraded_by, 'upgrade_wizard'
  );

  RETURN v_new_request_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DOCUMENTATION COMMENTS
-- ============================================================================

COMMENT ON VIEW trapper.v_request_alteration_stats IS
'Per-request clinic-derived statistics including cats caught, altered, and alteration rate.

Matching Rules:
- explicit_link (100%): From request_cat_links table
- place_and_requester (95%): Cat at same place AND linked to requester
- place_match (85%): Cat has appointment history at request place
- requester_match (80%): Cat linked to requester via person_cat_relationships

Time Window: 12 months centered on request date (±6 months)

Alteration Rate = cats_altered / (cats_caught - already_altered_before) * 100';

COMMENT ON VIEW trapper.v_place_alteration_history IS
'Per-place colony management statistics aggregated across all requests at that location.
Includes yearly breakdown for tracking TNR progress over time.';

COMMENT ON FUNCTION trapper.upgrade_legacy_request IS
'Upgrades a legacy Airtable request to modern Atlas format.
- Creates new request with source_system="airtable_upgraded"
- Archives original with status="cancelled" and link to new request
- Copies request_cat_links to new request
- Logs both operations to entity_edits for audit trail';

-- ============================================================================
-- INDEXES for performance
-- ============================================================================

-- Index for faster window queries on procedure dates
CREATE INDEX IF NOT EXISTS idx_cat_procedures_date_spay_neuter
ON trapper.cat_procedures (procedure_date)
WHERE is_spay = TRUE OR is_neuter = TRUE;

-- Index for finding legacy requests
CREATE INDEX IF NOT EXISTS idx_sot_requests_source_system
ON trapper.sot_requests (source_system)
WHERE source_system = 'airtable';
