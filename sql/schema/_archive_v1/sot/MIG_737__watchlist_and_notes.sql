\echo '=== MIG_737: Watchlist Management and Original Notes ===''
\echo 'Adds manual watchlist flag to places and light-redacted original notes'
\echo ''

-- ============================================================================
-- PART 1: Manual Watchlist Flag on Places
-- ============================================================================
-- This is separate from AI-detected watch_list from Google Maps notes.
-- Manual flag takes precedence in display logic.

\echo 'Adding watchlist columns to places...'

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS watch_list BOOLEAN DEFAULT FALSE;

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS watch_list_reason TEXT;

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS watch_list_set_at TIMESTAMPTZ;

ALTER TABLE trapper.places
  ADD COLUMN IF NOT EXISTS watch_list_set_by TEXT;

COMMENT ON COLUMN trapper.places.watch_list IS
'Manual watch list flag set by staff. Takes precedence over AI-detected watch_list from Google Maps notes.';

COMMENT ON COLUMN trapper.places.watch_list_reason IS
'Reason for adding to watch list. Required when setting watch_list = TRUE.';

-- ============================================================================
-- PART 2: Light-Redacted Original Notes
-- ============================================================================
-- Preserves original text with minimal redaction (profanity, SSN only).
-- Phone numbers, initials, informal language preserved.

\echo 'Adding original_redacted column to google_map_entries...'

ALTER TABLE trapper.google_map_entries
  ADD COLUMN IF NOT EXISTS original_redacted TEXT;

COMMENT ON COLUMN trapper.google_map_entries.original_redacted IS
'Original note with light redaction (profanity, SSN). Preserves phone numbers, initials, informal language for staff trust.';

-- ============================================================================
-- PART 3: Update v_map_atlas_pins View
-- ============================================================================
-- Include manual watchlist flag (takes precedence over AI-detected)

\echo 'Updating v_map_atlas_pins view...'

DROP VIEW IF EXISTS trapper.v_map_atlas_pins CASCADE;

CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  p.display_name,
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
  COALESCE(ppl.person_names, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (manual flag takes precedence, then check explicitly linked Google entries)
  COALESCE(
    p.disease_risk,
    gme.has_disease_risk,
    FALSE
  ) as disease_risk,
  p.disease_risk_notes,

  -- Watch list: MANUAL flag takes precedence over AI-detected
  COALESCE(p.watch_list, gme.has_watch_list, FALSE) as watch_list,
  p.watch_list_reason,

  -- Google Maps history - ONLY explicitly linked entries
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- TNR stats from pre-aggregated view
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style determination for frontend
  -- Disease is most severe, then watch_list, then active, then history
  CASE
    WHEN COALESCE(p.disease_risk, gme.has_disease_risk, FALSE) THEN 'disease'
    WHEN COALESCE(p.watch_list, gme.has_watch_list, FALSE) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 OR COALESCE(req.request_count, 0) > 0 THEN 'active'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Metadata
  p.created_at,
  p.last_activity_at

FROM trapper.places p

-- Cat counts from cat_place_relationships
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
) cc ON cc.place_id = p.place_id

-- People linked via person_place_relationships
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT per.display_name) FILTER (WHERE per.display_name IS NOT NULL) as person_names
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Google Maps entries: ONLY explicitly linked (place_id or linked_place_id set)
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

-- TNR stats from place alteration history
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
'Consolidated Atlas pins for map display. Includes:
- Place info (address, coordinates, service zone)
- Parent place info for clustering (parent_place_id, place_kind, unit_identifier)
- Cat counts from cat_place_relationships
- People from person_place_relationships
- Disease/watch list status (manual flags take precedence over AI-detected)
- Google Maps history (explicitly linked only)
- Request counts
- TNR statistics

Use parent_place_id and place_kind for zoom-based clustering of multi-unit places.
Watch list now uses purple color, disease uses orange.';

-- ============================================================================
-- PART 4: Function to Toggle Watchlist
-- ============================================================================

\echo 'Creating watchlist toggle function...'

CREATE OR REPLACE FUNCTION trapper.toggle_place_watchlist(
  p_place_id UUID,
  p_watch_list BOOLEAN,
  p_reason TEXT,
  p_set_by TEXT
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate reason required when adding
  IF p_watch_list AND (p_reason IS NULL OR TRIM(p_reason) = '') THEN
    RETURN QUERY SELECT FALSE, 'Reason is required when adding to watch list';
    RETURN;
  END IF;

  -- Update the place
  UPDATE trapper.places
  SET
    watch_list = p_watch_list,
    watch_list_reason = CASE WHEN p_watch_list THEN p_reason ELSE NULL END,
    watch_list_set_at = CASE WHEN p_watch_list THEN NOW() ELSE NULL END,
    watch_list_set_by = CASE WHEN p_watch_list THEN p_set_by ELSE NULL END
  WHERE place_id = p_place_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Place not found';
    RETURN;
  END IF;

  -- Log to entity_edits
  INSERT INTO trapper.entity_edits (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    edited_by,
    edit_reason
  ) VALUES (
    'place',
    p_place_id,
    'watch_list',
    CASE WHEN p_watch_list THEN 'false' ELSE 'true' END,
    CASE WHEN p_watch_list THEN 'true' ELSE 'false' END,
    p_set_by,
    CASE WHEN p_watch_list THEN 'Added to watch list: ' || p_reason ELSE 'Removed from watch list' END
  );

  RETURN QUERY SELECT TRUE,
    CASE WHEN p_watch_list
      THEN 'Added to watch list'
      ELSE 'Removed from watch list'
    END;
END;
$$;

COMMENT ON FUNCTION trapper.toggle_place_watchlist IS
'Toggle watch list status for a place. Requires reason when adding. Logs to entity_edits.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_737 Complete!'
\echo '=================================================='
\echo ''
\echo 'Added to places:'
\echo '  - watch_list (boolean, manual flag)'
\echo '  - watch_list_reason (text)'
\echo '  - watch_list_set_at (timestamp)'
\echo '  - watch_list_set_by (text)'
\echo ''
\echo 'Added to google_map_entries:'
\echo '  - original_redacted (text, light-redacted original)'
\echo ''
\echo 'Updated v_map_atlas_pins:'
\echo '  - watch_list now includes manual flag (takes precedence)'
\echo '  - Added watch_list_reason to output'
\echo ''
\echo 'Created function:'
\echo '  - toggle_place_watchlist(place_id, watch_list, reason, set_by)'
\echo ''
