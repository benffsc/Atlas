\echo '=== MIG_724: Tippy Spatial Context Functions ==='

-- ============================================================
-- Tippy Spatial Context
-- Enables Tippy to answer "What's going on near X address?"
-- by combining multiple data sources spatially
-- ============================================================

-- Function to get nearby activity for any address/coordinates
CREATE OR REPLACE FUNCTION trapper.tippy_nearby_activity(
  p_address TEXT DEFAULT NULL,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_radius_m INT DEFAULT 1000
)
RETURNS TABLE (
  category TEXT,
  name TEXT,
  address TEXT,
  distance_m INT,
  status TEXT,
  last_activity DATE,
  details JSONB
) AS $$
DECLARE
  v_point GEOGRAPHY;
  v_place_id UUID;
BEGIN
  -- Resolve coordinates from address if not provided
  IF p_lat IS NULL OR p_lng IS NULL THEN
    IF p_address IS NOT NULL THEN
      -- Try to find the place by address
      SELECT place_id, ST_Y(location::geometry), ST_X(location::geometry)
      INTO v_place_id, p_lat, p_lng
      FROM trapper.places
      WHERE formatted_address ILIKE '%' || p_address || '%'
        AND location IS NOT NULL
      ORDER BY
        CASE WHEN formatted_address ILIKE p_address THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1;

      IF p_lat IS NULL THEN
        RAISE NOTICE 'Address not found: %', p_address;
        RETURN;
      END IF;
    ELSE
      RAISE NOTICE 'Must provide either address or lat/lng';
      RETURN;
    END IF;
  END IF;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- 1. Nearby Requests
  RETURN QUERY
  SELECT
    'request'::TEXT as category,
    COALESCE(p.display_name, 'Request') as name,
    p.formatted_address as address,
    ROUND(ST_Distance(p.location, v_point))::INT as distance_m,
    r.status::TEXT,
    COALESCE(r.resolved_at, r.created_at)::DATE as last_activity,
    jsonb_build_object(
      'request_id', r.request_id,
      'created', r.created_at::DATE,
      'resolved', r.resolved_at::DATE,
      'cats_reported', r.estimated_cat_count
    ) as details
  FROM trapper.sot_requests r
  JOIN trapper.places p ON p.place_id = r.place_id
  WHERE p.location IS NOT NULL
    AND ST_DWithin(p.location, v_point, p_radius_m)
  ORDER BY ST_Distance(p.location, v_point);

  -- 2. Nearby Google Maps entries (historical context)
  RETURN QUERY
  SELECT
    'google_maps'::TEXT as category,
    g.kml_name as name,
    NULL::TEXT as address,
    ROUND((
      111111 * SQRT(
        POWER(g.lat - p_lat, 2) +
        POWER((g.lng - p_lng) * COS(RADIANS(p_lat)), 2)
      )
    ))::INT as distance_m,
    COALESCE(g.ai_meaning, 'unclassified')::TEXT as status,
    g.synced_at::DATE as last_activity,
    jsonb_build_object(
      'entry_id', g.entry_id,
      'classification', g.ai_meaning,
      'notes_preview', LEFT(COALESCE(g.ai_summary, g.original_content), 200),
      'staff_alert', COALESCE(
        (SELECT ct.staff_alert FROM trapper.google_map_classification_types ct
         WHERE ct.classification_type = g.ai_meaning), false
      )
    ) as details
  FROM trapper.google_map_entries g
  WHERE g.lat IS NOT NULL
    AND ABS(g.lat - p_lat) < (p_radius_m::FLOAT / 111111)
    AND ABS(g.lng - p_lng) < (p_radius_m::FLOAT / (111111 * COS(RADIANS(p_lat))))
  ORDER BY SQRT(POWER(g.lat - p_lat, 2) + POWER(g.lng - p_lng, 2));

  -- 3. Nearby Places with cat activity
  RETURN QUERY
  SELECT
    'place'::TEXT as category,
    COALESCE(p.display_name, 'Place') as name,
    p.formatted_address as address,
    ROUND(ST_Distance(p.location, v_point))::INT as distance_m,
    CASE
      WHEN EXISTS (SELECT 1 FROM trapper.sot_requests r WHERE r.place_id = p.place_id AND r.status NOT IN ('completed', 'cancelled'))
      THEN 'active_request'
      ELSE 'no_active_request'
    END::TEXT as status,
    (SELECT MAX(a.appointment_date) FROM trapper.sot_appointments a
     JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
     WHERE cpr.place_id = p.place_id) as last_activity,
    jsonb_build_object(
      'place_id', p.place_id,
      'cats_linked', (SELECT COUNT(*) FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id),
      'people_linked', (SELECT COUNT(*) FROM trapper.person_place_relationships ppr WHERE ppr.place_id = p.place_id),
      'service_zone', p.service_zone
    ) as details
  FROM trapper.places p
  WHERE p.location IS NOT NULL
    AND p.merged_into_place_id IS NULL
    AND ST_DWithin(p.location, v_point, p_radius_m)
    AND p.place_id != v_place_id  -- exclude the search location itself
    AND (
      EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = p.place_id)
      OR EXISTS (SELECT 1 FROM trapper.sot_requests r WHERE r.place_id = p.place_id)
    )
  ORDER BY ST_Distance(p.location, v_point);

  -- 4. Nearby Clinic appointments (recent activity)
  RETURN QUERY
  SELECT
    'clinic_visit'::TEXT as category,
    'Clinic Visit' as name,
    p.formatted_address as address,
    ROUND(ST_Distance(p.location, v_point))::INT as distance_m,
    CASE WHEN a.is_spay OR a.is_neuter THEN 'spay_neuter' ELSE 'other_service' END::TEXT as status,
    a.appointment_date as last_activity,
    jsonb_build_object(
      'appointment_id', a.appointment_id,
      'service_type', a.service_type,
      'is_spay', a.is_spay,
      'is_neuter', a.is_neuter
    ) as details
  FROM trapper.sot_appointments a
  JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
  JOIN trapper.places p ON p.place_id = cpr.place_id
  WHERE p.location IS NOT NULL
    AND ST_DWithin(p.location, v_point, p_radius_m)
    AND a.appointment_date >= CURRENT_DATE - INTERVAL '2 years'
  ORDER BY a.appointment_date DESC
  LIMIT 20;

END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.tippy_nearby_activity IS
'Returns nearby activity from multiple sources (requests, Google Maps, places, clinic visits) within a given radius of an address or coordinates. Used by Tippy to answer spatial context questions like "What activity is near X address?"';


-- Simplified view for Tippy to query specific address
CREATE OR REPLACE FUNCTION trapper.tippy_address_context(p_address TEXT)
RETURNS TABLE (
  address_found TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  place_id UUID,
  cats_at_address INT,
  people_at_address INT,
  requests_at_address INT,
  last_clinic_visit DATE,
  nearby_requests_500m INT,
  nearby_colonies_500m INT,
  nearby_activity JSONB
) AS $$
DECLARE
  v_place_id UUID;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_address TEXT;
BEGIN
  -- Find the place
  SELECT p.place_id, p.formatted_address,
         ST_Y(p.location::geometry), ST_X(p.location::geometry)
  INTO v_place_id, v_address, v_lat, v_lng
  FROM trapper.places p
  WHERE p.formatted_address ILIKE '%' || p_address || '%'
    AND p.location IS NOT NULL
    AND p.merged_into_place_id IS NULL
  ORDER BY
    CASE WHEN p.formatted_address ILIKE p_address THEN 0 ELSE 1 END,
    LENGTH(p.formatted_address)
  LIMIT 1;

  IF v_place_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_address,
    v_lat,
    v_lng,
    v_place_id,
    (SELECT COUNT(*)::INT FROM trapper.cat_place_relationships cpr WHERE cpr.place_id = v_place_id),
    (SELECT COUNT(*)::INT FROM trapper.person_place_relationships ppr WHERE ppr.place_id = v_place_id),
    (SELECT COUNT(*)::INT FROM trapper.sot_requests r WHERE r.place_id = v_place_id),
    (SELECT MAX(a.appointment_date) FROM trapper.sot_appointments a
     JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
     WHERE cpr.place_id = v_place_id),
    (SELECT COUNT(*)::INT FROM trapper.sot_requests r
     JOIN trapper.places p ON p.place_id = r.place_id
     WHERE p.location IS NOT NULL
       AND ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography, 500)
       AND r.place_id != v_place_id),
    (SELECT COUNT(*)::INT FROM trapper.google_map_entries g
     WHERE g.ai_meaning IN ('active_colony', 'historical_colony')
       AND ABS(g.lat - v_lat) < 0.0045  -- ~500m
       AND ABS(g.lng - v_lng) < 0.006),
    (SELECT jsonb_agg(
       jsonb_build_object(
         'category', na.category,
         'name', na.name,
         'distance_m', na.distance_m,
         'status', na.status,
         'details', na.details
       ) ORDER BY na.distance_m
     )
     FROM trapper.tippy_nearby_activity(NULL, v_lat, v_lng, 500) na
     LIMIT 10
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.tippy_address_context IS
'Returns comprehensive context for an address including cats, people, requests at the address, plus nearby activity summary. Tippy can use this to answer "What do we have going on at X address?"';


-- Register in Tippy view catalog
INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
  ('tippy_nearby_activity', 'spatial',
   'Returns nearby activity from multiple sources (requests, Google Maps history, places, clinic visits) within a radius. Call with address or lat/lng and radius_m.',
   ARRAY['category', 'name', 'address', 'distance_m'],
   ARRAY['p_address', 'p_lat', 'p_lng', 'p_radius_m'],
   ARRAY[
     'What trapping activity is near 123 Main St?',
     'Are there any colonies within 500m of this address?',
     'What recent activity has happened near this location?',
     'Has anyone been trapping nearby?'
   ]),
  ('tippy_address_context', 'spatial',
   'Returns comprehensive context for a specific address including cats, people, requests at that address, plus summary of nearby activity.',
   ARRAY['address_found', 'cats_at_address', 'people_at_address', 'nearby_colonies_500m'],
   ARRAY['p_address'],
   ARRAY[
     'What do we have going on at 2360 Becker Blvd?',
     'Tell me about this address',
     'Any history at 555 Oak Street?',
     'What do we know about this location?'
   ])
ON CONFLICT (view_name) DO UPDATE SET
  description = EXCLUDED.description,
  example_questions = EXCLUDED.example_questions;


\echo 'Created tippy_nearby_activity() and tippy_address_context() functions'
\echo 'Tippy can now answer spatial context questions like:'
\echo '  - "What activity is near 2360 Becker Blvd?"'
\echo '  - "Are there colonies nearby this address?"'
\echo '  - "What do we have going on at X?"'
