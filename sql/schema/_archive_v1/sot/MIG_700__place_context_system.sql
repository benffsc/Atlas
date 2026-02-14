-- ============================================================================
-- MIG_700: Place Context System for AI Data Guardian
-- ============================================================================
-- Purpose: Surfaces contextual information to staff during intake and request handling
--
-- Features:
-- 1. Materialized view for fast context lookups
-- 2. Function to get full context for a place (real-time)
-- 3. Support for active requests, clinic activity, Google Maps history, nearby activity
--
-- Key Principle: Each address remains its own place. This system provides
-- AWARENESS, not modification suggestions. Context is read-only.
-- ============================================================================

\echo '=== MIG_700: Place Context System ==='

-- ============================================================================
-- 1. Materialized View for Fast Context Lookups
-- ============================================================================
\echo 'Creating materialized view for place context summaries...'

DROP MATERIALIZED VIEW IF EXISTS trapper.mv_place_context_summary;

CREATE MATERIALIZED VIEW trapper.mv_place_context_summary AS
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,

  -- Active requests at this place
  COUNT(DISTINCT r.request_id) FILTER (
    WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
  ) as active_request_count,

  array_agg(DISTINCT r.request_id) FILTER (
    WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
  ) as active_request_ids,

  -- Clinic activity (last 6 months)
  COUNT(DISTINCT a.appointment_id) FILTER (
    WHERE a.appointment_date > NOW() - INTERVAL '6 months'
  ) as appointments_6mo,

  COUNT(DISTINCT cpr.cat_id) as total_linked_cats,

  MAX(a.appointment_date) as last_clinic_visit,

  -- Google Maps context (check for entries within 200m)
  EXISTS (
    SELECT 1 FROM trapper.google_map_entries g
    WHERE p.location IS NOT NULL
      AND g.lat IS NOT NULL
      AND g.lng IS NOT NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
        p.location::geography,
        200
      )
  ) as has_google_history,

  -- Computed flags for quick filtering
  CASE
    WHEN COUNT(DISTINCT r.request_id) FILTER (
      WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
    ) > 0 THEN true
    ELSE false
  END as has_active_request,

  CASE
    WHEN COUNT(DISTINCT a.appointment_id) FILTER (
      WHERE a.appointment_date > NOW() - INTERVAL '6 months'
    ) >= 3 THEN 'high'
    WHEN COUNT(DISTINCT a.appointment_id) FILTER (
      WHERE a.appointment_date > NOW() - INTERVAL '6 months'
    ) >= 1 THEN 'moderate'
    ELSE 'none'
  END as clinic_activity_level,

  NOW() as refreshed_at

FROM trapper.places p
LEFT JOIN trapper.sot_requests r ON r.place_id = p.place_id
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
LEFT JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL
GROUP BY p.place_id, p.formatted_address, p.service_zone;

-- Create unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_mv_place_context_place_id
ON trapper.mv_place_context_summary(place_id);

-- Additional indexes for common queries
CREATE INDEX idx_mv_place_context_active
ON trapper.mv_place_context_summary(has_active_request)
WHERE has_active_request = true;

CREATE INDEX idx_mv_place_context_clinic
ON trapper.mv_place_context_summary(clinic_activity_level)
WHERE clinic_activity_level != 'none';

CREATE INDEX idx_mv_place_context_zone
ON trapper.mv_place_context_summary(service_zone);

COMMENT ON MATERIALIZED VIEW trapper.mv_place_context_summary IS
'Pre-computed context summary for places. Refresh via: REFRESH MATERIALIZED VIEW CONCURRENTLY trapper.mv_place_context_summary';

-- ============================================================================
-- 2. Function to Get Full Context for a Place (Real-Time)
-- ============================================================================
\echo 'Creating get_place_context function...'

CREATE OR REPLACE FUNCTION trapper.get_place_context(p_place_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_address TEXT;
BEGIN
  -- Get place location
  SELECT
    ST_Y(location::geometry),
    ST_X(location::geometry),
    formatted_address
  INTO v_lat, v_lng, v_address
  FROM trapper.places
  WHERE place_id = p_place_id;

  -- Return null if place not found or no location
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN jsonb_build_object(
      'place_id', p_place_id,
      'error', 'Place not found or has no location'
    );
  END IF;

  SELECT jsonb_build_object(
    'place_id', p_place_id,
    'address', v_address,
    'location', jsonb_build_object('lat', v_lat, 'lng', v_lng),

    -- Active requests at this place
    'active_requests', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'request_id', r.request_id,
        'summary', r.summary,
        'status', r.status,
        'estimated_cat_count', r.estimated_cat_count,
        'created_at', r.created_at,
        'assigned_trapper', (
          SELECT tp.display_name
          FROM trapper.sot_people tp
          JOIN trapper.request_trapper_assignments rta ON rta.trapper_person_id = tp.person_id
          WHERE rta.request_id = r.request_id
            AND rta.unassigned_at IS NULL
          LIMIT 1
        )
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM trapper.sot_requests r
      WHERE r.place_id = p_place_id
        AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
    ),

    -- Recent clinic activity (last 6 months)
    'clinic_activity', (
      SELECT jsonb_build_object(
        'total_cats_6mo', COUNT(DISTINCT a.cat_id),
        'total_appointments_6mo', COUNT(DISTINCT a.appointment_id),
        'last_visit_date', MAX(a.appointment_date),
        'recent_cats', (
          SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
            'cat_id', c.cat_id,
            'name', c.display_name,
            'altered_status', c.altered_status,
            'last_appointment', a2.appointment_date
          ) ORDER BY a2.appointment_date DESC), '[]'::jsonb)
          FROM trapper.cat_place_relationships cpr2
          JOIN trapper.sot_cats c ON c.cat_id = cpr2.cat_id
          JOIN trapper.sot_appointments a2 ON a2.cat_id = c.cat_id
          WHERE cpr2.place_id = p_place_id
            AND a2.appointment_date > NOW() - INTERVAL '6 months'
          LIMIT 10
        )
      )
      FROM trapper.cat_place_relationships cpr
      JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
      WHERE cpr.place_id = p_place_id
        AND a.appointment_date > NOW() - INTERVAL '6 months'
    ),

    -- Google Maps context (within 200m)
    'google_context', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'entry_id', g.entry_id,
        'name', g.kml_name,
        'notes', LEFT(g.original_content, 500),
        'ai_summary', g.ai_summary,
        'signals', g.parsed_signals->'signals',
        'cat_count', g.parsed_cat_count,
        'distance_m', ST_Distance(
          ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
        )::INT
      ) ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography
      )), '[]'::jsonb)
      FROM trapper.google_map_entries g
      WHERE g.lat IS NOT NULL
        AND g.lng IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
          200
        )
    ),

    -- Nearby requests (within 200m, excluding same place)
    'nearby_requests', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'request_id', r.request_id,
        'summary', r.summary,
        'status', r.status,
        'cat_count', r.estimated_cat_count,
        'address', p2.formatted_address,
        'distance_m', ST_Distance(
          p2.location::geography,
          (SELECT location::geography FROM trapper.places WHERE place_id = p_place_id)
        )::INT
      ) ORDER BY ST_Distance(
        p2.location::geography,
        (SELECT location::geography FROM trapper.places WHERE place_id = p_place_id)
      )), '[]'::jsonb)
      FROM trapper.sot_requests r
      JOIN trapper.places p2 ON p2.place_id = r.place_id
      WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
        AND r.place_id <> p_place_id
        AND p2.location IS NOT NULL
        AND ST_DWithin(
          p2.location::geography,
          (SELECT location::geography FROM trapper.places WHERE place_id = p_place_id),
          200
        )
    ),

    -- Summary flags for quick UI rendering
    'context_flags', (
      SELECT jsonb_build_object(
        'has_active_request', EXISTS (
          SELECT 1 FROM trapper.sot_requests r
          WHERE r.place_id = p_place_id
            AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
        ),
        'has_recent_clinic', EXISTS (
          SELECT 1 FROM trapper.cat_place_relationships cpr
          JOIN trapper.sot_appointments a ON a.cat_id = cpr.cat_id
          WHERE cpr.place_id = p_place_id
            AND a.appointment_date > NOW() - INTERVAL '6 months'
        ),
        'has_google_history', EXISTS (
          SELECT 1 FROM trapper.google_map_entries g
          WHERE g.lat IS NOT NULL
            AND g.lng IS NOT NULL
            AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
              200
            )
        ),
        'has_nearby_activity', EXISTS (
          SELECT 1 FROM trapper.sot_requests r
          JOIN trapper.places p2 ON p2.place_id = r.place_id
          WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
            AND r.place_id <> p_place_id
            AND p2.location IS NOT NULL
            AND ST_DWithin(
              p2.location::geography,
              ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
              200
            )
        )
      )
    ),

    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_place_context(UUID) IS
'Returns comprehensive context for a place including active requests, clinic activity, Google Maps history, and nearby activity. Used by the AI Data Guardian to surface relevant information during intake.';

-- ============================================================================
-- 3. Helper Function: Get Context by Address (for intake matching)
-- ============================================================================
\echo 'Creating get_place_context_by_address function...'

CREATE OR REPLACE FUNCTION trapper.get_place_context_by_address(p_address TEXT)
RETURNS JSONB AS $$
DECLARE
  v_place_id UUID;
BEGIN
  -- Try exact match first
  SELECT place_id INTO v_place_id
  FROM trapper.places
  WHERE formatted_address ILIKE p_address
    AND merged_into_place_id IS NULL
  LIMIT 1;

  -- If no exact match, try partial match
  IF v_place_id IS NULL THEN
    SELECT place_id INTO v_place_id
    FROM trapper.places
    WHERE formatted_address ILIKE '%' || p_address || '%'
      AND merged_into_place_id IS NULL
    ORDER BY LENGTH(formatted_address)
    LIMIT 1;
  END IF;

  IF v_place_id IS NULL THEN
    RETURN jsonb_build_object(
      'address', p_address,
      'error', 'No matching place found',
      'context_flags', jsonb_build_object(
        'has_active_request', false,
        'has_recent_clinic', false,
        'has_google_history', false,
        'has_nearby_activity', false
      )
    );
  END IF;

  RETURN trapper.get_place_context(v_place_id);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_place_context_by_address(TEXT) IS
'Finds a place by address and returns its context. Useful for intake form matching.';

-- ============================================================================
-- 4. View for Quick Context Summary (for list views)
-- ============================================================================
\echo 'Creating quick context summary view...'

CREATE OR REPLACE VIEW trapper.v_place_quick_context AS
SELECT
  p.place_id,
  p.formatted_address,
  p.service_zone,
  mc.has_active_request,
  mc.active_request_count,
  mc.clinic_activity_level,
  mc.appointments_6mo,
  mc.total_linked_cats,
  mc.has_google_history,
  mc.last_clinic_visit,
  mc.refreshed_at
FROM trapper.places p
LEFT JOIN trapper.mv_place_context_summary mc ON mc.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_quick_context IS
'Quick access to place context from the materialized view. Use for list displays.';

-- ============================================================================
-- 5. Add to Tippy View Catalog
-- ============================================================================
\echo 'Adding to Tippy view catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('mv_place_context_summary', 'stats',
   'Pre-computed context for places including active requests, clinic activity, and Google Maps history',
   ARRAY['place_id', 'formatted_address', 'service_zone'],
   ARRAY['service_zone', 'has_active_request', 'clinic_activity_level'],
   ARRAY['Which places have active requests?', 'Where is there recent clinic activity?', 'Which places have Google Maps history?']),
  ('v_place_quick_context', 'stats',
   'Quick access view for place context (joins places with materialized view)',
   ARRAY['place_id', 'formatted_address'],
   ARRAY['service_zone', 'has_active_request', 'clinic_activity_level'],
   ARRAY['Show me places with both active requests and clinic activity', 'List places in Santa Rosa with Google Maps history'])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  key_columns = EXCLUDED.key_columns,
  filter_columns = EXCLUDED.filter_columns,
  example_questions = EXCLUDED.example_questions;

-- ============================================================================
-- 6. Initial Refresh
-- ============================================================================
\echo 'Performing initial materialized view refresh...'

REFRESH MATERIALIZED VIEW trapper.mv_place_context_summary;

-- ============================================================================
-- Summary
-- ============================================================================
\echo ''
\echo '=== MIG_700 Complete ==='
\echo 'Created:'
\echo '  - mv_place_context_summary (materialized view)'
\echo '  - get_place_context(place_id) (real-time context function)'
\echo '  - get_place_context_by_address(address) (address lookup + context)'
\echo '  - v_place_quick_context (quick access view)'
\echo ''
\echo 'Usage:'
\echo '  -- Get full context for a place'
\echo '  SELECT trapper.get_place_context(''some-place-uuid'');'
\echo ''
\echo '  -- Get context by address'
\echo '  SELECT trapper.get_place_context_by_address(''123 Main St, Santa Rosa'');'
\echo ''
\echo '  -- Refresh materialized view (run daily via cron)'
\echo '  REFRESH MATERIALIZED VIEW CONCURRENTLY trapper.mv_place_context_summary;'
\echo ''
\echo '  -- Query places with active requests'
\echo '  SELECT * FROM trapper.mv_place_context_summary WHERE has_active_request = true;'
