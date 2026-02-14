\echo '=== MIG_818: Tiered Pin System + Place Disease Extraction ==='

\echo '--- Recreating v_map_atlas_pins with pin_tier column ---'

DROP VIEW IF EXISTS trapper.v_map_atlas_pins;

CREATE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  COALESCE(org.org_display_name, p.display_name) as display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

  -- Parent place for clustering
  p.parent_place_id,
  p.place_kind,
  p.unit_identifier,

  -- Cat counts
  COALESCE(cc.cat_count, 0) as cat_count,

  -- People linked
  COALESCE(ppl.people, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (backward compat boolean)
  (COALESCE(p.disease_risk, FALSE)
   OR COALESCE(gme.has_disease_risk, FALSE)
   OR COALESCE(ds.has_any_disease, FALSE)) as disease_risk,
  p.disease_risk_notes,

  -- Per-disease badges
  COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
  COALESCE(ds.active_disease_count, 0) as disease_count,

  -- Watch list
  (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) as watch_list,
  p.watch_list_reason,

  -- Google Maps history
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- Intake submission counts
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'disease'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- NEW: Pin tier (active = full teardrop, reference = smaller muted pin)
  -- Auto-graduates when: disease flagged, cat data linked, request created,
  -- or an active volunteer/trapper/staff lives at the place.
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'active'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'active'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active'
    WHEN active_roles.place_id IS NOT NULL THEN 'active'
    ELSE 'reference'
  END as pin_tier,

  -- Metadata
  p.created_at,
  p.last_activity_at

FROM trapper.places p

-- Cat counts
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
) cc ON cc.place_id = p.place_id

-- People with role info (from MIG_811)
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
      'name', per.display_name,
      'roles', COALESCE((
        SELECT ARRAY_AGG(DISTINCT pr.role)
        FROM trapper.person_roles pr
        WHERE pr.person_id = per.person_id
          AND pr.role_status = 'active'
      ), ARRAY[]::TEXT[]),
      'is_staff', COALESCE(per.is_system_account, FALSE)
    )) FILTER (WHERE per.display_name IS NOT NULL) as people
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
    AND NOT trapper.is_organization_name(per.display_name)
    AND (
      COALESCE(per.is_system_account, FALSE) = FALSE
      OR ppr.source_system = 'volunteerhub'
    )
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Organization display name fallback
LEFT JOIN (
  SELECT DISTINCT ON (place_id) place_id, org_display_name
  FROM trapper.organization_place_mappings
  WHERE auto_link_enabled = TRUE AND org_display_name IS NOT NULL
  ORDER BY place_id, created_at DESC
) org ON org.place_id = p.place_id

-- Disease summary
LEFT JOIN trapper.v_place_disease_summary ds ON ds.place_id = p.place_id

-- Google Maps entries
LEFT JOIN (
  SELECT
    COALESCE(place_id, linked_place_id) as place_id,
    COUNT(*) as entry_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'summary', COALESCE(ai_summary, SUBSTRING(original_content FROM 1 FOR 200)),
        'meaning', ai_meaning,
        'date', parsed_date::text
      )
      ORDER BY imported_at DESC
    ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries,
    BOOL_OR(ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
    BOOL_OR(ai_meaning = 'watch_list') as has_watch_list
  FROM trapper.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count
  FROM trapper.sot_requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) req ON req.place_id = p.place_id

-- Intake submissions
LEFT JOIN (
  SELECT
    place_id,
    COUNT(DISTINCT submission_id) as intake_count
  FROM trapper.web_intake_submissions
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) intake ON intake.place_id = p.place_id

-- Active important roles at this place (for auto-graduation)
LEFT JOIN (
  SELECT DISTINCT ppr.place_id
  FROM trapper.person_place_relationships ppr
  JOIN trapper.person_roles pr ON pr.person_id = ppr.person_id
  WHERE pr.role_status = 'active'
    AND pr.role IN ('volunteer', 'trapper', 'coordinator', 'head_trapper',
                    'ffsc_trapper', 'community_trapper', 'foster')
) active_roles ON active_roles.place_id = p.place_id

-- TNR stats
LEFT JOIN (
  SELECT
    place_id,
    total_cats_altered as total_altered,
    latest_request_date as last_alteration_at
  FROM trapper.v_place_alteration_history
) tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL;

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'MIG_818: Added pin_tier column (active/reference) for tiered map display.
Active: disease, watch_list, cat data, requests/intakes, or active volunteer/trapper/staff at place.
Reference: has_history (Google Maps only), minimal (no data).
Auto-graduates when person becomes active volunteer, cat data linked, request created, etc.';

-- ============================================================
-- Part 2: process_disease_extraction_for_place()
-- ============================================================

\echo '--- Creating process_disease_extraction_for_place() ---'

CREATE OR REPLACE FUNCTION trapper.process_disease_extraction_for_place(
  p_place_id UUID,
  p_disease_key TEXT,
  p_evidence_source TEXT DEFAULT 'google_maps',
  p_notes TEXT DEFAULT NULL,
  p_approximate_date DATE DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_decay_months INT;
  v_effective_status TEXT := 'suspected';
BEGIN
  -- Validate disease_key
  IF NOT EXISTS (SELECT 1 FROM trapper.disease_types WHERE disease_key = p_disease_key AND is_active = TRUE) THEN
    RAISE NOTICE 'Unknown or inactive disease_key: %', p_disease_key;
    RETURN 0;
  END IF;

  -- Validate place exists
  IF NOT EXISTS (SELECT 1 FROM trapper.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL) THEN
    RAISE NOTICE 'Place not found or merged: %', p_place_id;
    RETURN 0;
  END IF;

  -- Auto-determine status based on date and decay window
  SELECT decay_window_months INTO v_decay_months
  FROM trapper.disease_types WHERE disease_key = p_disease_key;

  IF p_approximate_date IS NOT NULL
     AND p_approximate_date < (CURRENT_DATE - (v_decay_months || ' months')::INTERVAL)::DATE THEN
    v_effective_status := 'historical';
  END IF;

  -- Insert or update place_disease_status
  INSERT INTO trapper.place_disease_status (
    place_id, disease_type_key, status, evidence_source,
    first_positive_date, last_positive_date,
    positive_cat_count, notes, set_by, set_at
  ) VALUES (
    p_place_id, p_disease_key, v_effective_status, p_evidence_source,
    COALESCE(p_approximate_date, CURRENT_DATE),
    COALESCE(p_approximate_date, CURRENT_DATE),
    0, COALESCE(p_notes, 'Extracted from Google Maps entry'),
    'ai_extraction', NOW()
  )
  ON CONFLICT (place_id, disease_type_key)
  DO UPDATE SET
    -- Don't override manual statuses
    status = CASE
      WHEN place_disease_status.status IN ('perpetual', 'false_flag', 'cleared', 'confirmed_active')
      THEN place_disease_status.status
      ELSE v_effective_status
    END,
    last_positive_date = CASE
      WHEN place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
      THEN place_disease_status.last_positive_date
      ELSE GREATEST(place_disease_status.last_positive_date, COALESCE(p_approximate_date, CURRENT_DATE))
    END,
    first_positive_date = CASE
      WHEN place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
      THEN place_disease_status.first_positive_date
      ELSE LEAST(place_disease_status.first_positive_date, COALESCE(p_approximate_date, CURRENT_DATE))
    END,
    notes = CASE
      WHEN place_disease_status.notes IS NULL THEN COALESCE(p_notes, 'Extracted from Google Maps entry')
      ELSE place_disease_status.notes
    END,
    updated_at = NOW()
  WHERE place_disease_status.status NOT IN ('perpetual', 'false_flag', 'cleared');

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Update backward-compat disease_risk boolean on places
  UPDATE trapper.places
  SET disease_risk = TRUE
  WHERE place_id = p_place_id
    AND COALESCE(disease_risk, FALSE) = FALSE;

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION trapper.process_disease_extraction_for_place IS
'MIG_818: Directly flags a place with disease status from AI extraction (Google Maps, etc).
Unlike process_disease_extraction() which takes a cat_id, this takes a place_id directly.
Auto-determines status: historical if approximate_date beyond decay window, else suspected.
Respects manual overrides (perpetual, false_flag, cleared, confirmed_active).';

\echo ''
\echo '=============================================='
\echo 'MIG_818 Complete'
\echo '=============================================='
\echo 'Changes:'
\echo '  - v_map_atlas_pins: Added pin_tier column (active/reference)'
\echo '  - process_disease_extraction_for_place(): Direct place flagging for Google Maps extraction'
\echo ''
