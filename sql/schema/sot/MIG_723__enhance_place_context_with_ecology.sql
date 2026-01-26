\echo '=== MIG_723: Enhance get_place_context with Ecological Data ==='

-- Enhance get_place_context to include ecological context
CREATE OR REPLACE FUNCTION trapper.get_place_context(p_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_result JSONB;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_address TEXT;
  v_service_zone TEXT;
BEGIN
  -- Get place location
  SELECT
    ST_Y(location::geometry),
    ST_X(location::geometry),
    formatted_address,
    service_zone
  INTO v_lat, v_lng, v_address, v_service_zone
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
    'service_zone', v_service_zone,
    'location', jsonb_build_object('lat', v_lat, 'lng', v_lng),

    -- ============================================================
    -- OPERATIONAL LAYER: Current state for staff workflows
    -- ============================================================

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
          )), '[]'::jsonb)
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
        'ai_meaning', g.ai_meaning,
        'classification', g.ai_classification,
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

    -- ============================================================
    -- ECOLOGICAL LAYER: Historical context for analysis
    -- ============================================================

    -- Historical conditions at this place
    'condition_history', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'condition_id', pch.condition_id,
        'condition_type', pch.condition_type,
        'display_label', pct.display_label,
        'severity', pch.severity,
        'valid_from', pch.valid_from,
        'valid_to', pch.valid_to,
        'is_ongoing', pch.valid_to IS NULL,
        'peak_cat_count', pch.peak_cat_count,
        'ecological_impact', pch.ecological_impact,
        'description', pch.description,
        'source_type', pch.source_type
      ) ORDER BY pch.valid_from DESC), '[]'::jsonb)
      FROM trapper.place_condition_history pch
      LEFT JOIN trapper.place_condition_types pct ON pct.condition_type = pch.condition_type
      WHERE pch.place_id = p_place_id
        AND pch.superseded_at IS NULL
    ),

    -- Colony timeline (population estimates over time)
    'colony_timeline', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'estimated_total', pct.estimated_total,
        'estimated_altered', pct.estimated_altered,
        'alteration_rate', pct.alteration_rate,
        'colony_status', pct.colony_status,
        'valid_from', pct.valid_from,
        'valid_to', pct.valid_to,
        'is_current', pct.valid_to IS NULL,
        'confidence', pct.confidence,
        'source_type', pct.source_type
      ) ORDER BY pct.valid_from DESC), '[]'::jsonb)
      FROM trapper.place_colony_timeline pct
      WHERE pct.place_id = p_place_id
      LIMIT 10
    ),

    -- Ecological relationships (where cats dispersed to/from)
    'dispersal_patterns', (
      SELECT jsonb_build_object(
        'as_source', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'sink_place_id', per.sink_place_id,
            'sink_address', sink.formatted_address,
            'relationship_type', per.relationship_type,
            'evidence_strength', per.evidence_strength,
            'estimated_cats_transferred', per.estimated_cats_transferred
          )), '[]'::jsonb)
          FROM trapper.place_ecological_relationships per
          JOIN trapper.places sink ON sink.place_id = per.sink_place_id
          WHERE per.source_place_id = p_place_id
        ),
        'as_sink', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'source_place_id', per.source_place_id,
            'source_address', src.formatted_address,
            'relationship_type', per.relationship_type,
            'evidence_strength', per.evidence_strength,
            'estimated_cats_transferred', per.estimated_cats_transferred
          )), '[]'::jsonb)
          FROM trapper.place_ecological_relationships per
          JOIN trapper.places src ON src.place_id = per.source_place_id
          WHERE per.sink_place_id = p_place_id
        )
      )
    ),

    -- Zone socioeconomic data (if available)
    'zone_demographics', (
      SELECT jsonb_build_object(
        'zone_name', g.area_name,
        'median_household_income', g.median_household_income,
        'pct_below_poverty', g.pct_below_poverty,
        'pct_renter_occupied', g.pct_renter_occupied,
        'pct_mobile_homes', g.pct_mobile_homes,
        'pet_ownership_index', g.pet_ownership_index,
        'tnr_priority_score', g.tnr_priority_score
      )
      FROM trapper.ref_sonoma_geography g
      WHERE g.area_type = 'zip'
        AND v_address LIKE '%' || g.area_code || '%'
      LIMIT 1
    ),

    -- ============================================================
    -- SUMMARY FLAGS for quick UI rendering
    -- ============================================================
    'context_flags', (
      SELECT jsonb_build_object(
        -- Operational flags
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
        ),
        -- Ecological flags
        'has_condition_history', EXISTS (
          SELECT 1 FROM trapper.place_condition_history pch
          WHERE pch.place_id = p_place_id AND pch.superseded_at IS NULL
        ),
        'has_ongoing_condition', EXISTS (
          SELECT 1 FROM trapper.place_condition_history pch
          WHERE pch.place_id = p_place_id
            AND pch.valid_to IS NULL
            AND pch.superseded_at IS NULL
        ),
        'has_disease_history', EXISTS (
          SELECT 1 FROM trapper.place_condition_history pch
          WHERE pch.place_id = p_place_id
            AND pch.condition_type = 'disease_outbreak'
            AND pch.superseded_at IS NULL
        ),
        'was_significant_source', EXISTS (
          SELECT 1 FROM trapper.place_condition_history pch
          WHERE pch.place_id = p_place_id
            AND pch.ecological_impact IN ('regional', 'significant')
            AND pch.superseded_at IS NULL
        )
      )
    ),

    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION trapper.get_place_context(uuid) IS
'Returns comprehensive context for a place including both operational state (active requests, clinic activity) and ecological history (condition history, colony timeline, dispersal patterns). Used by /api/places/[id]/context and PlaceContextPanel.';

\echo '=== MIG_723 Complete ==='
\echo 'Enhanced get_place_context with: condition_history, colony_timeline, dispersal_patterns, zone_demographics'
